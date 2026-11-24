// Firestore real-time database layer (replaces Code.gs spreadsheet/Drive operations)
import {
  initFirebase,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  writeBatch,
  runTransaction,
  increment,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp
} from './firebase-config.js';
import { state } from './state.js';
import {
  formatMemberNameWithRole,
  parseFlexibleNumber,
  sha256Hex,
  toIsoTimestamp,
  groupExpenseDocs,
  makeTallyDayId,
  normalizeBarcode,
  round2
} from './utils.js';

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
  if (typeof state.tallyDayUnsub === 'function') {
    try { state.tallyDayUnsub(); } catch (_) {}
  }
  state.tallyDayUnsub = null;
  state.activeTallyDayId = '';
  state.activeTallyLines = [];
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

  const uMenu = onSnapshot(collection(db, 'menuItems'), (snap) => {
    const items = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      createdAt: toIsoTimestamp(d.data().createdAt),
      updatedAt: toIsoTimestamp(d.data().updatedAt)
    }));
    items.sort((a, b) => {
      const cCmp = (a.category || '').localeCompare(b.category || '');
      return cCmp !== 0 ? cCmp : (a.name || '').localeCompare(b.name || '');
    });
    state.menuItems = items;
    callbacks.onMenuItemsUpdated?.(items);
  });

  const qTallyDays = query(collection(db, 'tallyDays'), orderBy('date', 'desc'));
  const uTallyDays = onSnapshot(qTallyDays, (snap) => {
    state.tallyDays = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      updatedAt: toIsoTimestamp(d.data().updatedAt)
    }));
    callbacks.onTallyDaysUpdated?.(state.tallyDays);
  });

  const uBranding = onSnapshot(collection(db, 'config'), (snap) => {
    let changed = false;
    const nextMap = { ...(state.storeBranding || {}) };
    snap.docs.forEach((d) => {
      if (!d.id.startsWith('logo_')) return;
      const data = d.data();
      const storeId = (data.storeId || decodeURIComponent(d.id.slice(5))).trim();
      if (!storeId) return;
      nextMap[storeId] = {
        storeId,
        logoDataUrl: data.logoDataUrl || '',
        menuSubtitle: data.menuSubtitle || '',
        updatedAt: toIsoTimestamp(data.updatedAt)
      };
      changed = true;
    });
    if (changed) {
      state.storeBranding = nextMap;
      callbacks.onStoreBrandingUpdated?.(state.storeBranding);
    }
  });

  state.unsubscribes.push(uStores, uCats, uAi, uTeam, uSubs, uExp, uMenu, uTallyDays, uBranding);
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

/* ==================== CATALOG & TALLY OPERATIONS ==================== */

export async function saveMenuItemToDb(item) {
  const { db } = await initFirebase();
  const nowIso = new Date().toISOString();
  const isNew = !item.id;
  const ref = isNew ? doc(collection(db, 'menuItems')) : doc(db, 'menuItems', item.id);
  const payload = {
    storeId: (item.storeId || '').toString().trim(),
    name: (item.name || '').toString().trim(),
    price: round2(parseFlexibleNumber(item.price) || 0),
    barcode: normalizeBarcode(item.barcode || ''),
    category: (item.category || '').toString().trim(),
    active: item.active !== false,
    updatedAt: nowIso
  };
  if (isNew) {
    payload.createdAt = nowIso;
    await setDoc(ref, payload);
  } else {
    await setDoc(ref, payload, { merge: true });
  }
  return ref.id;
}

export async function archiveMenuItemInDb(itemId, active = false) {
  if (!itemId) return;
  const { db } = await initFirebase();
  await updateDoc(doc(db, 'menuItems', itemId), {
    active: Boolean(active),
    updatedAt: new Date().toISOString()
  });
}

export async function copyMenuItemsToStoreInDb(sourceStoreId, targetStoreId, allItems = state.menuItems) {
  const src = (sourceStoreId || '').trim();
  const dst = (targetStoreId || '').trim();
  if (!src || !dst || src === dst) return { copiedCount: 0, skippedCount: 0 };

  const { db } = await initFirebase();
  const nowIso = new Date().toISOString();
  const srcItems = (allItems || []).filter((i) => (i.storeId || '').trim() === src && i.active !== false);
  const dstItems = (allItems || []).filter((i) => (i.storeId || '').trim() === dst && i.active !== false);

  const dstNames = new Set(dstItems.map((i) => (i.name || '').trim().toLowerCase()));
  const dstBarcodes = new Set(dstItems.map((i) => normalizeBarcode(i.barcode)).filter(Boolean));

  const batch = writeBatch(db);
  let copiedCount = 0;
  let skippedCount = 0;

  for (const item of srcItems) {
    const cleanName = (item.name || '').trim();
    const cleanCode = normalizeBarcode(item.barcode);
    if (!cleanName || dstNames.has(cleanName.toLowerCase()) || (cleanCode && dstBarcodes.has(cleanCode))) {
      skippedCount += 1;
      continue;
    }
    const ref = doc(collection(db, 'menuItems'));
    batch.set(ref, {
      storeId: dst,
      name: cleanName,
      price: round2(Number(item.price) || 0),
      barcode: cleanCode,
      category: (item.category || '').trim(),
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso
    });
    dstNames.add(cleanName.toLowerCase());
    if (cleanCode) dstBarcodes.add(cleanCode);
    copiedCount += 1;
  }

  if (copiedCount > 0) {
    await batch.commit();
  }
  return { copiedCount, skippedCount };
}

export function makeStoreBrandingDocId(storeId) {
  return 'logo_' + encodeURIComponent((storeId || 'Store 1').toString().trim());
}

export async function fetchStoreBrandingFromDb(storeId) {
  const cleanStore = (storeId || '').toString().trim();
  if (!cleanStore) return { storeId: '', logoDataUrl: '', menuSubtitle: '' };
  const { db } = await initFirebase();
  const snap = await getDoc(doc(db, 'config', makeStoreBrandingDocId(cleanStore)));
  const data = snap.exists() ? snap.data() : {};
  const branding = {
    storeId: cleanStore,
    logoDataUrl: data.logoDataUrl || '',
    menuSubtitle: data.menuSubtitle || '',
    updatedAt: toIsoTimestamp(data.updatedAt)
  };
  state.storeBranding[cleanStore] = branding;
  return branding;
}

export async function saveStoreBrandingToDb(storeId, updates = {}) {
  const cleanStore = (storeId || '').toString().trim();
  if (!cleanStore) return;
  const { db } = await initFirebase();
  const prev = state.storeBranding?.[cleanStore] || {};
  const nowIso = new Date().toISOString();
  const payload = {
    storeId: cleanStore,
    logoDataUrl: updates.logoDataUrl !== undefined ? updates.logoDataUrl || '' : prev.logoDataUrl || '',
    menuSubtitle:
      updates.menuSubtitle !== undefined
        ? (updates.menuSubtitle || '').toString().trim()
        : prev.menuSubtitle || '',
    updatedAt: nowIso
  };
  await setDoc(doc(db, 'config', makeStoreBrandingDocId(cleanStore)), payload, { merge: true });
  state.storeBranding[cleanStore] = payload;
  return payload;
}

export async function bulkAssignBarcodesInDb(updates = []) {
  const valid = (updates || []).filter((u) => u && u.id && normalizeBarcode(u.barcode));
  if (valid.length === 0) return 0;
  const { db } = await initFirebase();
  const nowIso = new Date().toISOString();
  for (let i = 0; i < valid.length; i += 400) {
    const chunk = valid.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const u of chunk) {
      batch.update(doc(db, 'menuItems', u.id), {
        barcode: normalizeBarcode(u.barcode),
        updatedAt: nowIso
      });
    }
    await batch.commit();
  }
  return valid.length;
}

export async function subscribeTallyDayLines(storeId, dateIso, onUpdate) {
  if (typeof state.tallyDayUnsub === 'function') {
    try { state.tallyDayUnsub(); } catch (_) {}
    state.tallyDayUnsub = null;
  }
  if (!storeId || !dateIso) {
    state.activeTallyDayId = '';
    state.activeTallyLines = [];
    onUpdate?.([], '');
    return () => {};
  }

  const { db } = await initFirebase();
  const dayId = makeTallyDayId(storeId, dateIso);
  state.activeTallyDayId = dayId;
  const qLines = query(collection(db, 'tallyDays', dayId, 'lines'), orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(qLines, (snap) => {
    const lines = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      createdAt: toIsoTimestamp(d.data().createdAt),
      editedAt: toIsoTimestamp(d.data().editedAt),
      voidedAt: toIsoTimestamp(d.data().voidedAt)
    }));
    state.activeTallyLines = lines;
    onUpdate?.(lines, dayId);
  });
  state.tallyDayUnsub = unsub;
  return unsub;
}

export async function addTallyOrderToDb({
  storeId,
  date,
  orderId,
  payment = '',
  lines = [],
  userId = '',
  userName = '',
  checkIdempotent = false
}) {
  if (!storeId || !date || !Array.isArray(lines) || lines.length === 0) {
    return { skippedDuplicate: false };
  }
  const { db } = await initFirebase();
  const dayId = makeTallyDayId(storeId, date);
  const dayRef = doc(db, 'tallyDays', dayId);
  const nowIso = new Date().toISOString();

  if (checkIdempotent && orderId) {
    const firstSnap = await getDoc(doc(db, 'tallyDays', dayId, 'lines', `${orderId}_0`));
    if (firstSnap.exists()) {
      return { skippedDuplicate: true };
    }
  }

  let orderTotal = 0;
  let orderQty = 0;
  const batch = writeBatch(db);

  lines.forEach((line, idx) => {
    const qty = Math.max(1, Math.round(Number(line.qty) || 1));
    const price = round2(Number(line.price) || 0);
    orderTotal = round2(orderTotal + price * qty);
    orderQty += qty;

    const lineId = orderId ? `${orderId}_${idx}` : doc(collection(db, 'tallyDays', dayId, 'lines')).id;
    const lineRef = doc(db, 'tallyDays', dayId, 'lines', lineId);
    batch.set(lineRef, {
      itemId: line.itemId || '',
      name: line.name || '',
      barcode: normalizeBarcode(line.barcode || ''),
      category: line.category || '',
      price,
      qty,
      orderId: orderId || lineId,
      payment: payment || '',
      userId: userId || '',
      userName: userName || '',
      createdAt: nowIso,
      voided: false
    });
  });

  const cardPixDelta = payment === 'Card' || payment === 'PIX' ? orderTotal : 0;
  batch.set(
    dayRef,
    {
      storeId,
      date,
      total: increment(orderTotal),
      itemCount: increment(orderQty),
      cardPixTotal: increment(cardPixDelta),
      updatedAt: nowIso
    },
    { merge: true }
  );

  await batch.commit();
  return { skippedDuplicate: false, orderTotal, orderQty };
}

export async function addRetroactiveTallyLineToDb({
  storeId,
  date,
  item,
  qty = 1,
  payment = '',
  userId = '',
  userName = ''
}) {
  if (!storeId || !date || !item) return;
  const { db } = await initFirebase();
  const dayId = makeTallyDayId(storeId, date);
  const dayRef = doc(db, 'tallyDays', dayId);
  const lineRef = doc(collection(db, 'tallyDays', dayId, 'lines'));
  const editRef = doc(collection(db, 'tallyEdits'));
  const nowIso = new Date().toISOString();

  const cleanQty = Math.max(1, Math.round(Number(qty) || 1));
  const price = round2(Number(item.price) || 0);
  const deltaTotal = round2(price * cleanQty);
  const cardPixDelta = payment === 'Card' || payment === 'PIX' ? deltaTotal : 0;

  const batch = writeBatch(db);
  batch.set(lineRef, {
    itemId: item.id || '',
    name: item.name || '',
    barcode: normalizeBarcode(item.barcode || ''),
    category: item.category || '',
    price,
    qty: cleanQty,
    orderId: `retro_${Date.now()}`,
    payment: payment || '',
    userId: userId || '',
    userName: userName || '',
    createdAt: nowIso,
    voided: false,
    retroactive: true
  });

  batch.set(
    dayRef,
    {
      storeId,
      date,
      total: increment(deltaTotal),
      itemCount: increment(cleanQty),
      cardPixTotal: increment(cardPixDelta),
      updatedAt: nowIso
    },
    { merge: true }
  );

  batch.set(editRef, {
    dayId,
    storeId,
    date,
    lineId: lineRef.id,
    itemName: item.name || '',
    action: 'add_line',
    before: null,
    after: { qty: cleanQty, price, payment: payment || '', voided: false },
    userId: userId || '',
    userName: userName || '',
    at: nowIso
  });

  await batch.commit();
}

export async function voidTallyLineInDb({ storeId, date, lineId, userId = '', userName = '' }) {
  if (!storeId || !date || !lineId) return;
  const { db } = await initFirebase();
  const dayId = makeTallyDayId(storeId, date);
  const dayRef = doc(db, 'tallyDays', dayId);
  const lineRef = doc(db, 'tallyDays', dayId, 'lines', lineId);
  const editRef = doc(collection(db, 'tallyEdits'));
  const nowIso = new Date().toISOString();

  await runTransaction(db, async (tx) => {
    const [lineSnap, daySnap] = await Promise.all([tx.get(lineRef), tx.get(dayRef)]);
    if (!lineSnap.exists()) return;
    const lineData = lineSnap.data();
    if (lineData.voided === true) return;

    const qty = Number(lineData.qty) || 0;
    const price = Number(lineData.price) || 0;
    const lineAmount = round2(price * qty);
    const dayData = daySnap.exists() ? daySnap.data() : { total: 0, itemCount: 0, cardPixTotal: 0 };
    const isCardPix = lineData.payment === 'Card' || lineData.payment === 'PIX';

    tx.update(lineRef, {
      voided: true,
      voidedBy: userName || '',
      voidedAt: nowIso
    });

    tx.set(
      dayRef,
      {
        storeId,
        date,
        total: Math.max(0, round2((Number(dayData.total) || 0) - lineAmount)),
        itemCount: Math.max(0, (Number(dayData.itemCount) || 0) - qty),
        cardPixTotal: Math.max(
          0,
          round2((Number(dayData.cardPixTotal) || 0) - (isCardPix ? lineAmount : 0))
        ),
        updatedAt: nowIso
      },
      { merge: true }
    );

    tx.set(editRef, {
      dayId,
      storeId,
      date,
      lineId,
      itemName: lineData.name || '',
      action: 'void',
      before: { qty, price, voided: false },
      after: { qty, price, voided: true },
      userId: userId || '',
      userName: userName || '',
      at: nowIso
    });
  });
}

export async function editTallyLineInDb({ storeId, date, lineId, newQty, userId = '', userName = '' }) {
  const cleanQty = Math.max(1, Math.round(Number(newQty) || 0));
  if (!storeId || !date || !lineId || cleanQty < 1) return;

  const { db } = await initFirebase();
  const dayId = makeTallyDayId(storeId, date);
  const dayRef = doc(db, 'tallyDays', dayId);
  const lineRef = doc(db, 'tallyDays', dayId, 'lines', lineId);
  const editRef = doc(collection(db, 'tallyEdits'));
  const nowIso = new Date().toISOString();

  await runTransaction(db, async (tx) => {
    const [lineSnap, daySnap] = await Promise.all([tx.get(lineRef), tx.get(dayRef)]);
    if (!lineSnap.exists()) return;
    const lineData = lineSnap.data();
    if (lineData.voided === true) return;

    const oldQty = Number(lineData.qty) || 0;
    if (oldQty === cleanQty) return;

    const price = Number(lineData.price) || 0;
    const qtyDiff = cleanQty - oldQty;
    const totalDiff = round2(qtyDiff * price);
    const dayData = daySnap.exists() ? daySnap.data() : { total: 0, itemCount: 0, cardPixTotal: 0 };
    const isCardPix = lineData.payment === 'Card' || lineData.payment === 'PIX';

    tx.update(lineRef, {
      qty: cleanQty,
      editedBy: userName || '',
      editedAt: nowIso
    });

    tx.set(
      dayRef,
      {
        storeId,
        date,
        total: Math.max(0, round2((Number(dayData.total) || 0) + totalDiff)),
        itemCount: Math.max(0, (Number(dayData.itemCount) || 0) + qtyDiff),
        cardPixTotal: Math.max(
          0,
          round2((Number(dayData.cardPixTotal) || 0) + (isCardPix ? totalDiff : 0))
        ),
        updatedAt: nowIso
      },
      { merge: true }
    );

    tx.set(editRef, {
      dayId,
      storeId,
      date,
      lineId,
      itemName: lineData.name || '',
      action: 'edit_qty',
      before: { qty: oldQty, price },
      after: { qty: cleanQty, price },
      userId: userId || '',
      userName: userName || '',
      at: nowIso
    });
  });
}

export async function fetchTallyEditsFromDb(storeId, dateIso) {
  if (!storeId || !dateIso) return [];
  const { db } = await initFirebase();
  const dayId = makeTallyDayId(storeId, dateIso);
  const qEdits = query(collection(db, 'tallyEdits'), where('dayId', '==', dayId));
  const snap = await getDocs(qEdits);
  const list = snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    at: toIsoTimestamp(d.data().at)
  }));
  list.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return list;
}
