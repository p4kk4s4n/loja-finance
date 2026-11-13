// Firestore real-time database layer (replaces Code.gs spreadsheet/Drive operations)
import {
  initFirebase,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  writeBatch,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from './firebase-config.js';
import { state } from './state.js';
import { formatMemberNameWithRole, parseFlexibleNumber, sha256Hex, toIsoTimestamp, groupExpenseDocs } from './utils.js';

const DEFAULT_STORES = [
  { name: 'Store 1', streams: 'Stone, Rede' },
  { name: 'Store 2', streams: 'GetNet' }
];

const DEFAULT_CATEGORIES = ['Supplies', 'Rent', 'Utilities', 'Salaries', 'Marketing', 'Other'];

export { groupExpenseDocs };

export async function fetchInitialConfigAndRoster() {
  const { db } = await initFirebase();

  const [storesSnap, catsSnap, teamSnap, aiSnap] = await Promise.all([
    getDoc(doc(db, 'config', 'stores')),
    getDoc(doc(db, 'config', 'categories')),
    getDocs(collection(db, 'teamMembers')),
    getDoc(doc(db, 'config', 'ai'))
  ]);

  const businesses = storesSnap.exists() && Array.isArray(storesSnap.data().items)
    ? storesSnap.data().items
    : DEFAULT_STORES;

  const categories = catsSnap.exists() && Array.isArray(catsSnap.data().items)
    ? catsSnap.data().items
    : DEFAULT_CATEGORIES;

  const roster = teamSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (aiSnap.exists()) {
    const aiData = aiSnap.data();
    state.aiApiKey = aiData.geminiApiKey || '';
    state.sheetsConfig = {
      spreadsheetId: aiData.spreadsheetId || '',
      googleClientId: aiData.googleClientId || ''
    };
  }

  state.businesses = businesses;
  state.globalExpenseCategories = categories;
  state.teamRoster = roster;

  return { businesses, categories, roster };
}

export async function bootstrapFirstAdmin(adminName, rawPin) {
  const { db } = await initFirebase();
  const pinHash = await sha256Hex(rawPin.trim());
  const fullName = formatMemberNameWithRole(adminName, 'Admin');

  const batch = writeBatch(db);
  batch.set(doc(db, 'config', 'stores'), { items: DEFAULT_STORES });
  batch.set(doc(db, 'config', 'categories'), { items: DEFAULT_CATEGORIES });

  const adminRef = doc(collection(db, 'teamMembers'));
  const adminMember = {
    name: fullName,
    role: 'Admin',
    equity: {},
    storeAssignment: 'All Stores',
    pinHash,
    salary: 0,
    payFrequency: 'None',
    payDay: null,
    updatedAt: new Date().toISOString()
  };
  batch.set(adminRef, adminMember);
  await batch.commit();

  state.businesses = [...DEFAULT_STORES];
  state.globalExpenseCategories = [...DEFAULT_CATEGORIES];
  state.teamRoster = [{ id: adminRef.id, ...adminMember }];
  return state.teamRoster[0];
}

export function stopRealtimeListeners() {
  for (const unsub of state.unsubscribes) {
    try { unsub(); } catch (_) {}
  }
  state.unsubscribes = [];
  state.listenersReady = false;
}

export async function subscribeRealtimeData(callbacks = {}) {
  stopRealtimeListeners();
  const { db } = await initFirebase();

  const uStores = onSnapshot(doc(db, 'config', 'stores'), (snap) => {
    if (snap.exists() && Array.isArray(snap.data().items)) {
      state.businesses = snap.data().items;
      callbacks.onStoresUpdated?.(state.businesses);
    }
  });

  const uCats = onSnapshot(doc(db, 'config', 'categories'), (snap) => {
    if (snap.exists() && Array.isArray(snap.data().items)) {
      state.globalExpenseCategories = snap.data().items;
      callbacks.onCategoriesUpdated?.(state.globalExpenseCategories);
    }
  });

  const uAi = onSnapshot(doc(db, 'config', 'ai'), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      state.aiApiKey = data.geminiApiKey || '';
      state.sheetsConfig = {
        spreadsheetId: data.spreadsheetId || '',
        googleClientId: data.googleClientId || ''
      };
      callbacks.onConfigUpdated?.();
    }
  });

  const uTeam = onSnapshot(collection(db, 'teamMembers'), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    state.teamRoster = list;
    callbacks.onRosterUpdated?.(list);
  });

  const qSubs = query(collection(db, 'dailySubmissions'), orderBy('date', 'desc'));
  const uSubs = onSnapshot(qSubs, (snap) => {
    state.rawSubmissions = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        timestamp: toIsoTimestamp(data.timestamp)
      };
    });
    callbacks.onLedgerUpdated?.();
  });

  const qExp = query(collection(db, 'expenses'), orderBy('date', 'desc'));
  const uExp = onSnapshot(qExp, (snap) => {
    state.rawExpenses = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        timestamp: toIsoTimestamp(data.timestamp)
      };
    });
    state.groupedExpenses = groupExpenseDocs(state.rawExpenses);
    callbacks.onLedgerUpdated?.();
  });

  state.unsubscribes.push(uStores, uCats, uAi, uTeam, uSubs, uExp);
  state.listenersReady = true;
}

async function uploadReceiptDoc(db, fileData, label) {
  if (!fileData || !fileData.base64) return '';
  const ref = await addDoc(collection(db, 'receipts'), {
    dataUrl: fileData.base64,
    mimeType: fileData.mimeType || 'image/jpeg',
    fileName: fileData.name || `${label}_${Date.now()}.jpg`,
    createdBy: state.currentUser?.name || '',
    createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function getReceiptDataUrl(receiptId) {
  const { db } = await initFirebase();
  const snap = await getDoc(doc(db, 'receipts', receiptId));
  return snap.exists() ? snap.data().dataUrl : null;
}

export async function saveSubmissionToDb(payload) {
  const { db } = await initFirebase();
  const batch = writeBatch(db);
  const nowIso = new Date().toISOString();

  for (const stream of payload.streams) {
    const amt = parseFlexibleNumber(stream.amount) || 0;
    let receiptId = '';
    if (stream.photo && stream.photo.base64) {
      receiptId = await uploadReceiptDoc(db, stream.photo, `${payload.date}_${stream.name}`);
    }
    const ref = doc(collection(db, 'dailySubmissions'));
    batch.set(ref, {
      timestamp: nowIso,
      date: payload.date,
      store: payload.store || 'Store 1',
      submitter: payload.submitter,
      entryType: stream.name,
      amount: amt,
      receiptId,
      legacyLink: '',
      notes: payload.notes || ''
    });
  }

  await batch.commit();
}

export async function saveExpenseToDb(payload) {
  const { db } = await initFirebase();
  const batch = writeBatch(db);
  const nowIso = new Date().toISOString();
  const groupId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  let receiptId = '';
  if (payload.receiptPhoto && payload.receiptPhoto.base64) {
    receiptId = await uploadReceiptDoc(db, payload.receiptPhoto, `${payload.date}_Expense`);
  }

  for (const item of payload.items) {
    const amount = parseFlexibleNumber(item.amount) || 0;
    if (amount <= 0) continue;
    const ref = doc(collection(db, 'expenses'));
    batch.set(ref, {
      groupId,
      timestamp: nowIso,
      date: payload.date,
      store: payload.store || 'Store 1',
      submitter: payload.submitter,
      category: item.category,
      amount,
      paymentMethod: payload.paymentMethod,
      description: item.description || '',
      receiptId,
      legacyLink: ''
    });
  }

  await batch.commit();
}

export async function saveBusinessesToDb(businesses) {
  const { db } = await initFirebase();
  await setDoc(doc(db, 'config', 'stores'), { items: businesses });
}

export async function saveCategoriesToDb(categories) {
  const { db } = await initFirebase();
  await setDoc(doc(db, 'config', 'categories'), { items: categories });
}

export async function saveIntegrationConfigToDb({ geminiApiKey, spreadsheetId, googleClientId }) {
  const { db } = await initFirebase();
  await setDoc(
    doc(db, 'config', 'ai'),
    {
      geminiApiKey: geminiApiKey || '',
      spreadsheetId: spreadsheetId || '',
      googleClientId: googleClientId || '',
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
}

export async function saveTeamRosterToDb(roster) {
  const { db } = await initFirebase();
  const existingSnap = await getDocs(collection(db, 'teamMembers'));
  const incomingIds = new Set(roster.map((m) => m.id).filter(Boolean));
  const batch = writeBatch(db);

  // Delete removed members
  for (const existingDoc of existingSnap.docs) {
    if (!incomingIds.has(existingDoc.id)) {
      batch.delete(existingDoc.ref);
    }
  }

  // Upsert current roster members (preserving existing pinHash unless a new PIN was entered)
  for (const m of roster) {
    const docRef = m.id ? doc(db, 'teamMembers', m.id) : doc(collection(db, 'teamMembers'));
    let pinHash = m.pinHash || '';
    if (m.newPin && m.newPin.trim() !== '') {
      pinHash = await sha256Hex(m.newPin.trim());
    }
    batch.set(docRef, {
      name: m.name || '',
      role: m.role || 'Employee',
      equity: m.role === 'Partner' ? m.equity || {} : {},
      storeAssignment: m.storeAssignment || 'All Stores',
      pinHash,
      salary: Number(m.salary) || 0,
      payFrequency: m.payFrequency || 'None',
      payDay: m.payDay !== null && m.payDay !== undefined ? m.payDay : null,
      updatedAt: new Date().toISOString()
    });
  }

  await batch.commit();
}
