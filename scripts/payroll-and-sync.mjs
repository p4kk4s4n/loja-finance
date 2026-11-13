/**
 * Headless GitHub Actions Daily Cron:
 * 1) Executes Automated Payroll against Firestore with atomic duplicate guard.
 * 2) Optionally mirrors Firestore data back to Google Sheets for archival backup.
 */
import fs from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { doesMemberMatchPayday } from '../js/utils.js';

function loadJsonEnv(envName) {
  const val = process.env[envName];
  if (!val) return null;
  return val.trim().startsWith('{') ? JSON.parse(val) : JSON.parse(fs.readFileSync(val, 'utf8'));
}

function getSaoPauloDateInfo() {
  const tz = process.env.PAYROLL_TIMEZONE || 'America/Sao_Paulo';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const isoDate = `${map.year}-${map.month}-${map.day}`;
  const localMidnight = new Date(Number(map.year), Number(map.month) - 1, Number(map.day));
  return { isoDate, localDateObj: localMidnight, nowIso: now.toISOString() };
}

async function runPayroll(db) {
  const { isoDate, localDateObj, nowIso } = getSaoPauloDateInfo();
  const teamSnap = await db.collection('teamMembers').get();
  let logged = 0;

  for (const docSnap of teamSnap.docs) {
    const member = { id: docSnap.id, ...docSnap.data() };
    if (!doesMemberMatchPayday(member, localDateObj)) continue;

    const store = member.storeAssignment || 'All Stores';
    const safeKey = `${isoDate}_${member.id}_${store}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const runRef = db.collection('payrollRuns').doc(safeKey);
    const existing = await runRef.get();
    if (existing.exists) {
      console.log(`Skipping duplicate payroll for ${member.name} (${isoDate})`);
      continue;
    }

    const batch = db.batch();
    const expRef = db.collection('expenses').doc();
    batch.set(expRef, {
      groupId: `autopay_${safeKey}`,
      timestamp: nowIso,
      date: isoDate,
      store,
      submitter: member.name,
      category: 'Salaries',
      amount: Number(member.salary) || 0,
      paymentMethod: 'Bank Transfer',
      description: `Auto-Pay (${member.payFrequency}): ${member.name}`,
      receiptId: '',
      legacyLink: ''
    });
    batch.set(runRef, {
      date: isoDate,
      memberId: member.id,
      memberName: member.name,
      expenseId: expRef.id,
      createdAt: nowIso
    });
    await batch.commit();
    logged++;
  }

  console.log(`Automated Payroll complete for ${isoDate}: ${logged} entry/entries logged.`);
}

async function syncToGoogleSheets(db) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const gsCred = loadJsonEnv('GOOGLE_SHEETS_CREDENTIALS') || loadJsonEnv('FIREBASE_SERVICE_ACCOUNT');
  if (!spreadsheetId || !gsCred) {
    console.log('Google Sheets sync skipped (SPREADSHEET_ID not configured).');
    return;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: gsCred,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const [storesDoc, teamSnap, subsSnap, expSnap] = await Promise.all([
    db.collection('config').doc('stores').get(),
    db.collection('teamMembers').get(),
    db.collection('dailySubmissions').orderBy('date', 'asc').get(),
    db.collection('expenses').orderBy('date', 'asc').get()
  ]);

  const stores = storesDoc.exists ? storesDoc.data().items || [] : [];
  const bizValues = [['Name', 'PaymentStreams'], ...stores.map((b) => [b.name, b.streams])];

  const teamValues = [
    ['Name', 'Role', 'Equity Matrix', 'StoreAssignment', 'PIN Hash', 'Salary', 'Pay Frequency', 'Pay Day'],
    ...teamSnap.docs.map((d) => {
      const m = d.data();
      return [
        m.name || '',
        m.role || '',
        JSON.stringify(m.equity || {}),
        m.storeAssignment || 'All Stores',
        m.pinHash ? '[HASHED]' : '',
        m.salary || 0,
        m.payFrequency || 'None',
        m.payDay ?? ''
      ];
    })
  ];

  const dailyValues = [
    ['Timestamp', 'Date', 'Store', 'Submitter', 'Entry Type', 'Amount (R$)', 'Receipt Link', 'Notes / Expenses'],
    ...subsSnap.docs.map((d) => {
      const r = d.data();
      return [
        r.timestamp || '',
        r.date || '',
        r.store || '',
        r.submitter || '',
        r.entryType || '',
        r.amount || 0,
        r.legacyLink || (r.receiptId ? `firestore:receipts/${r.receiptId}` : ''),
        r.notes || ''
      ];
    })
  ];

  const expValues = [
    ['Date', 'Store', 'Submitter', 'Category', 'Amount (R$)', 'Payment Method', 'Description', 'Receipt Link', 'Timestamp'],
    ...expSnap.docs.map((d) => {
      const e = d.data();
      return [
        e.date || '',
        e.store || '',
        e.submitter || '',
        e.category || '',
        e.amount || 0,
        e.paymentMethod || '',
        e.description || '',
        e.legacyLink || (e.receiptId ? `firestore:receipts/${e.receiptId}` : ''),
        e.timestamp || ''
      ];
    })
  ];

  const overwriteTab = async (range, values) => {
    await sheets.spreadsheets.values.clear({ spreadsheetId, range });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });
  };

  await Promise.all([
    overwriteTab('Businesses!A:B', bizValues),
    overwriteTab('TeamMembers!A:H', teamValues),
    overwriteTab('DailySubmissions!A:H', dailyValues),
    overwriteTab('Expenses!A:I', expValues)
  ]);

  console.log('Google Sheets snapshot backup complete.');
}

async function main() {
  const fbCred = loadJsonEnv('FIREBASE_SERVICE_ACCOUNT');
  if (!fbCred) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is required.');
  }
  initializeApp({ credential: cert(fbCred) });
  const db = getFirestore();

  await runPayroll(db);
  await syncToGoogleSheets(db);
}

main().catch((err) => {
  console.error('Cron failed:', err);
  process.exit(1);
});
