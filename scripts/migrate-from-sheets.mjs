/**
 * One-time migration from legacy Google Sheets database to Firebase Firestore.
 * Usage:
 *   SPREADSHEET_ID="1G-TFhcsMCb6v4g19IjGIV6wMccDVXUyjgYJvwi3fO9Q" \
 *   FIREBASE_SERVICE_ACCOUNT="./firebase-service-account.json" \
 *   GOOGLE_SHEETS_CREDENTIALS="./google-credentials.json" \
 *   node scripts/migrate-from-sheets.mjs [--dry-run]
 *
 * (If Firebase and Sheets share the same GCP Service Account JSON, omit GOOGLE_SHEETS_CREDENTIALS.)
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { parseFlexibleNumber } from '../js/utils.js';

const dryRun = process.argv.includes('--dry-run');
const spreadsheetId =
  process.env.SPREADSHEET_ID || '1G-TFhcsMCb6v4g19IjGIV6wMccDVXUyjgYJvwi3fO9Q';

function loadCredential(envVal, fallbackPath) {
  const source = envVal || (fs.existsSync(fallbackPath) ? fallbackPath : '');
  if (!source) throw new Error(`Missing credential (${fallbackPath})`);
  return source.trim().startsWith('{')
    ? JSON.parse(source)
    : JSON.parse(fs.readFileSync(source, 'utf8'));
}

function sha256Hex(val) {
  return crypto.createHash('sha256').update(String(val)).digest('hex');
}

function parseSafeDate(val) {
  if (!val) return new Date().toISOString().slice(0, 10);
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const brMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

async function readSheet(sheets, range) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return res.data.values || [];
  } catch (err) {
    console.warn(`Skipping range ${range}: ${err.message}`);
    return [];
  }
}

async function commitBatches(db, collectionName, items, docIdFn = null) {
  if (dryRun || items.length === 0) return;
  for (let i = 0; i < items.length; i += 400) {
    const chunk = items.slice(i, i + 400);
    const batch = db.batch();
    for (const item of chunk) {
      const ref = docIdFn
        ? db.collection(collectionName).doc(docIdFn(item))
        : db.collection(collectionName).doc();
      batch.set(ref, item);
    }
    await batch.commit();
  }
}

async function run() {
  const fbCred = loadCredential(process.env.FIREBASE_SERVICE_ACCOUNT, './firebase-service-account.json');
  const gsCred = process.env.GOOGLE_SHEETS_CREDENTIALS
    ? loadCredential(process.env.GOOGLE_SHEETS_CREDENTIALS, './google-credentials.json')
    : fbCred;

  initializeApp({ credential: cert(fbCred) });
  const db = getFirestore();

  const auth = new google.auth.GoogleAuth({
    credentials: gsCred,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const [bizRows, teamRows, dailyRows, expRows] = await Promise.all([
    readSheet(sheets, 'Businesses!A2:B'),
    readSheet(sheets, 'TeamMembers!A2:H'),
    readSheet(sheets, 'DailySubmissions!A2:H'),
    readSheet(sheets, 'Expenses!A2:I')
  ]);

  const businesses = bizRows
    .filter((r) => r[0])
    .map((r) => ({ name: String(r[0]).trim(), streams: String(r[1] || '').trim() }));

  const teamMembers = teamRows
    .filter((r) => r[0])
    .map((r) => {
      let equity = {};
      try { equity = JSON.parse(r[2] || '{}'); } catch (_) {}
      const rawPin = String(r[4] || '').trim();
      return {
        name: String(r[0]).trim(),
        role: String(r[1] || 'Employee').trim(),
        equity,
        storeAssignment: String(r[3] || 'All Stores').trim(),
        pinHash: rawPin ? sha256Hex(rawPin) : '',
        salary: parseFlexibleNumber(r[5]) || 0,
        payFrequency: String(r[6] || 'None').trim(),
        payDay: r[7] !== undefined && r[7] !== '' ? parseInt(r[7], 10) : null,
        updatedAt: new Date().toISOString()
      };
    });

  const submissions = dailyRows
    .filter((r) => r.join('').trim() !== '')
    .map((r) => ({
      timestamp: r[0] ? String(r[0]) : new Date().toISOString(),
      date: parseSafeDate(r[1]),
      store: String(r[2] || 'Store 1').trim(),
      submitter: String(r[3] || '').trim(),
      entryType: String(r[4] || '').trim(),
      amount: parseFlexibleNumber(r[5]) || 0,
      receiptId: '',
      legacyLink: String(r[6] || '').trim(),
      notes: String(r[7] || '').trim()
    }));

  const expenses = expRows
    .filter((r) => r.join('').trim() !== '')
    .map((r) => {
      const date = parseSafeDate(r[0]);
      const store = String(r[1] || 'Store 1').trim();
      const submitter = String(r[2] || '').trim();
      const method = String(r[5] || '').trim();
      const ts = r[8] ? String(r[8]) : '';
      const groupId = ts ? `mig_${ts.replace(/[^a-zA-Z0-9]/g, '_')}` : `mig_${date}_${store}_${submitter}_${method}`;
      return {
        groupId,
        timestamp: ts || new Date(date).toISOString(),
        date,
        store,
        submitter,
        category: String(r[3] || 'Other').trim(),
        amount: parseFlexibleNumber(r[4]) || 0,
        paymentMethod: method,
        description: String(r[6] || '').trim(),
        receiptId: '',
        legacyLink: String(r[7] || '').trim()
      };
    });

  console.log(`Parsed from Spreadsheet (${dryRun ? 'DRY RUN' : 'LIVE'}):`);
  console.log(`- Businesses: ${businesses.length}`);
  console.log(`- TeamMembers: ${teamMembers.length}`);
  console.log(`- DailySubmissions: ${submissions.length}`);
  console.log(`- Expenses: ${expenses.length}`);

  if (!dryRun) {
    if (businesses.length > 0) {
      await db.collection('config').doc('stores').set({ items: businesses });
    }
    await db.collection('config').doc('categories').set(
      { items: ['Supplies', 'Rent', 'Utilities', 'Salaries', 'Marketing', 'Other'] },
      { merge: true }
    );
    await commitBatches(db, 'teamMembers', teamMembers);
    await commitBatches(db, 'dailySubmissions', submissions);
    await commitBatches(db, 'expenses', expenses);
    console.log('Migration committed cleanly to Firestore!');
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
