import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCurrency,
  parseFlexibleNumber,
  getSignedSubmissionAmount,
  stripRoleSuffix,
  formatMemberNameWithRole,
  computePartnerEquityValidation,
  doesMemberMatchPayday,
  groupExpenseDocs,
  normalizeUserRole,
  getEffectiveStoreFilter,
  getScopedLedgerData,
  resolveScanCode,
  getEffectiveDaySales,
  computeTallyLinesSummary,
  reconcileLedgerRevenue,
  createOpenOrder,
  addItemToOpenOrders,
  removeOpenOrderById,
  computeOpenOrderTotal
} from '../js/utils.js';
import { isNewerVersion, detectGithubRepoFromUrl } from '../js/updater.js';
import {
  computeEan13CheckDigit,
  isValidEan13,
  generateInStoreEan13,
  encodeEan13Bits,
  encodeCode128BBits,
  renderBarcodeSvg
} from '../js/barcode-svg.js';

test('parseFlexibleNumber handles pt-BR and US decimal formats', () => {
  assert.equal(parseFlexibleNumber('2.345,67'), 2345.67);
  assert.equal(parseFlexibleNumber('2,345.67'), 2345.67);
  assert.equal(parseFlexibleNumber('2,345'), 2345);
  assert.equal(parseFlexibleNumber('1,000,000'), 1000000);
  assert.equal(parseFlexibleNumber('1.000.000'), 1000000);
  assert.equal(parseFlexibleNumber('R$ 150,50'), 150.5);
  assert.equal(parseFlexibleNumber(42.5), 42.5);
});

test('getSignedSubmissionAmount handles Cash Out and Fee negatively', () => {
  assert.equal(getSignedSubmissionAmount('Stone', '1.200,50'), 1200.5);
  assert.equal(getSignedSubmissionAmount('Cash In', 300), 300);
  assert.equal(getSignedSubmissionAmount('Cash Out', 75), -75);
  assert.equal(getSignedSubmissionAmount('Fee', '12,30'), -12.3);
});

test('stripRoleSuffix and formatMemberNameWithRole preserve role tags cleanly', () => {
  assert.equal(stripRoleSuffix('Thais (Partner)'), 'Thais');
  assert.equal(stripRoleSuffix('Leiliane (Sócio)'), 'Leiliane');
  assert.equal(formatMemberNameWithRole('Thais (Sócio)', 'Partner'), 'Thais (Partner)');
  assert.equal(formatMemberNameWithRole('Joseph', 'Admin'), 'Joseph (Admin)');
});

test('computePartnerEquityValidation requires 100% split per business', () => {
  const businesses = [{ name: 'Porteira Velho' }, { name: 'Sua Loja' }];
  const validRoster = [
    { name: 'Thais (Partner)', role: 'Partner', equity: { 'Porteira Velho': 0.45, 'Sua Loja': 0.45 } },
    { name: 'Leiliane (Partner)', role: 'Partner', equity: { 'Porteira Velho': 0.45 } },
    { name: 'Bruna (Partner)', role: 'Partner', equity: { 'Sua Loja': 0.5 } },
    { name: 'Dizimo (Partner)', role: 'Partner', equity: { 'Porteira Velho': 0.1, 'Sua Loja': 0.05 } }
  ];
  assert.equal(computePartnerEquityValidation(validRoster, businesses).valid, true);

  const invalidRoster = [
    { name: 'Thais (Partner)', role: 'Partner', equity: { 'Porteira Velho': 0.5, 'Sua Loja': 0.5 } }
  ];
  const res = computePartnerEquityValidation(invalidRoster, businesses);
  assert.equal(res.valid, false);
  assert.equal(res.invalidBizName, 'Porteira Velho');
  assert.equal(res.invalidBizTotal, 50);
});

test('doesMemberMatchPayday evaluates Daily, Weekly, and Monthly schedules', () => {
  const friday = new Date(2026, 10, 13); // 2026-11-13 is Friday (getDay() === 5)
  const firstOfMonth = new Date(2026, 10, 1);

  assert.equal(doesMemberMatchPayday({ salary: 100, payFrequency: 'Daily' }, friday), true);
  assert.equal(doesMemberMatchPayday({ salary: 500, payFrequency: 'Weekly', payDay: 5 }, friday), true);
  assert.equal(doesMemberMatchPayday({ salary: 500, payFrequency: 'Weekly', payDay: 1 }, friday), false);
  assert.equal(doesMemberMatchPayday({ salary: 2000, payFrequency: 'Monthly', payDay: 1 }, firstOfMonth), true);
  assert.equal(doesMemberMatchPayday({ salary: 0, payFrequency: 'Daily' }, friday), false);
});

test('isNewerVersion and detectGithubRepoFromUrl parse GitHub Releases and Pages URLs', () => {
  assert.equal(isNewerVersion('v2.1.0', '2.0.0'), true);
  assert.equal(isNewerVersion('v.2.1.0', '2.0.0'), true);
  assert.equal(isNewerVersion('2.0.1', '2.0.0'), true);
  assert.equal(isNewerVersion('2.0.0', '2.0.0'), false);
  assert.equal(isNewerVersion('1.9.9', '2.0.0'), false);
  assert.equal(detectGithubRepoFromUrl('alice.github.io', '/Loja_Finance/'), 'alice/Loja_Finance');
});

test('groupExpenseDocs aggregates multi-line items sharing a groupId', () => {
  const grouped = groupExpenseDocs([
    { id: '1', groupId: 'g1', date: '2026-11-10', store: 'Sua Loja', submitter: 'Thais', category: 'Supplies', amount: 50, paymentMethod: 'Card', description: 'Paper', timestamp: '2026-11-10T10:00:00Z' },
    { id: '2', groupId: 'g1', date: '2026-11-10', store: 'Sua Loja', submitter: 'Thais', category: 'Marketing', amount: 120, paymentMethod: 'Card', description: 'Flyers', timestamp: '2026-11-10T10:00:00Z' }
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].amount, 170);
  assert.equal(grouped[0].category, 'Supplies, Marketing');
  assert.equal(grouped[0].description, 'Paper | Flyers');
});

test('normalizeUserRole and getEffectiveStoreFilter enforce role and store assignments', () => {
  assert.equal(normalizeUserRole('Administrador'), 'admin');
  assert.equal(normalizeUserRole('Admin'), 'admin');
  assert.equal(normalizeUserRole('Sócio'), 'partner');
  assert.equal(normalizeUserRole('Partner'), 'partner');
  assert.equal(normalizeUserRole('Funcionário'), 'employee');
  assert.equal(normalizeUserRole(''), 'employee');

  assert.equal(getEffectiveStoreFilter({ storeAssignment: 'Porteira Velho' }, 'All Stores'), 'Porteira Velho');
  assert.equal(getEffectiveStoreFilter({ storeAssignment: 'Porteira Velho' }, 'Sua Loja'), 'Porteira Velho');
  assert.equal(getEffectiveStoreFilter({ storeAssignment: 'All Stores' }, 'Sua Loja'), 'Sua Loja');
  assert.equal(getEffectiveStoreFilter({ storeAssignment: 'All Stores' }, 'All Stores'), 'All Stores');
});

test('getScopedLedgerData locks Funcionário to self and single-store Sócio to assigned store', () => {
  const businesses = [{ name: 'Porteira Velho' }, { name: 'Sua Loja' }];
  const teamRoster = [
    { name: 'Thais (Partner)', role: 'Partner', storeAssignment: 'All Stores', equity: { 'Porteira Velho': 0.45, 'Sua Loja': 0.45 } },
    { name: 'Leiliane (Partner)', role: 'Sócio', storeAssignment: 'Porteira Velho', equity: { 'Porteira Velho': 0.45 } },
    { name: 'Bruna (Partner)', role: 'Partner', storeAssignment: 'Sua Loja', equity: { 'Sua Loja': 0.5 } },
    { name: 'Sonya (Employee)', role: 'Employee', storeAssignment: 'Porteira Velho', equity: {} }
  ];
  const rawSubmissions = [
    { id: 's1', store: 'Porteira Velho', submitter: 'Sonya (Employee)', amount: 100 },
    { id: 's2', store: 'Porteira Velho', submitter: 'Leiliane (Partner)', amount: 250 },
    { id: 's3', store: 'Sua Loja', submitter: 'Bruna (Partner)', amount: 400 }
  ];
  const groupedExpenses = [
    { id: 'e1', store: 'Porteira Velho', submitter: 'Sonya', amount: 20 },
    { id: 'e2', store: 'Porteira Velho', submitter: 'Leiliane', amount: 50 },
    { id: 'e3', store: 'Sua Loja', submitter: 'Bruna', amount: 80 }
  ];

  const empScope = getScopedLedgerData({
    rawSubmissions,
    groupedExpenses,
    teamRoster,
    businesses,
    currentUser: { name: 'Sonya (Employee)', role: 'Funcionário', storeAssignment: 'Porteira Velho' },
    selectedStore: 'All Stores'
  });
  assert.equal(empScope.roleKind, 'employee');
  assert.equal(empScope.effectiveStore, 'Porteira Velho');
  assert.deepEqual(empScope.scopedSubmissions.map((r) => r.id), ['s1']);
  assert.deepEqual(empScope.scopedExpenses.map((r) => r.id), ['e1']);
  assert.equal(empScope.visibleBusinesses.length, 0);
  assert.equal(empScope.visiblePartners.length, 0);

  const lockedPartnerScope = getScopedLedgerData({
    rawSubmissions,
    groupedExpenses,
    teamRoster,
    businesses,
    currentUser: { name: 'Leiliane (Partner)', role: 'Sócio', storeAssignment: 'Porteira Velho' },
    selectedStore: 'Sua Loja'
  });
  assert.equal(lockedPartnerScope.roleKind, 'partner');
  assert.equal(lockedPartnerScope.effectiveStore, 'Porteira Velho');
  assert.deepEqual(lockedPartnerScope.scopedSubmissions.map((r) => r.id), ['s1', 's2']);
  assert.deepEqual(lockedPartnerScope.scopedExpenses.map((r) => r.id), ['e1', 'e2']);
  assert.deepEqual(lockedPartnerScope.visibleBusinesses.map((b) => b.name), ['Porteira Velho']);
  assert.deepEqual(lockedPartnerScope.visiblePartners.map((p) => p.name), ['Thais (Partner)', 'Leiliane (Partner)']);
  assert.deepEqual(lockedPartnerScope.visiblePartners[0].equity, { 'Porteira Velho': 0.45 });

  const allStoresPartner = getScopedLedgerData({
    rawSubmissions,
    groupedExpenses,
    teamRoster,
    businesses,
    currentUser: { name: 'Thais (Partner)', role: 'Partner', storeAssignment: 'All Stores' },
    selectedStore: 'All Stores'
  });
  assert.equal(allStoresPartner.effectiveStore, 'All Stores');
  assert.equal(allStoresPartner.scopedSubmissions.length, 3);
  assert.equal(allStoresPartner.visibleBusinesses.length, 2);
  assert.equal(allStoresPartner.visiblePartners.length, 3);
});

test('formatCurrency formats Brazilian Real (R$) consistently', () => {
  const pos = formatCurrency(1234.5).replace(/\u00a0/g, ' ');
  const neg = formatCurrency(-50).replace(/\u00a0/g, ' ');
  assert.equal(pos, 'R$ 1.234,50');
  assert.equal(neg, '-R$ 50,00');
});

test('getEffectiveDaySales reconciles tally and manual totals using max and unitemized diff', () => {
  const manualHigher = getEffectiveDaySales(1000, 800);
  assert.equal(manualHigher.reported, 1000);
  assert.equal(manualHigher.unitemized, 200);
  assert.equal(manualHigher.source, 'mixed');

  const tallyHigher = getEffectiveDaySales(650, 800);
  assert.equal(tallyHigher.reported, 800);
  assert.equal(tallyHigher.unitemized, 0);
  assert.equal(tallyHigher.source, 'tally');

  const onlyManual = getEffectiveDaySales(420, 0);
  assert.equal(onlyManual.reported, 420);
  assert.equal(onlyManual.unitemized, 0);
  assert.equal(onlyManual.source, 'manual');

  const onlyTally = getEffectiveDaySales(0, 310);
  assert.equal(onlyTally.reported, 310);
  assert.equal(onlyTally.unitemized, 0);
  assert.equal(onlyTally.source, 'tally');
});

test('resolveScanCode matches store catalog, strips control chars, ignores archived, handles UPC/EAN zero', () => {
  const items = [
    { id: '1', storeId: 'Porteira Velho', name: 'Heineken 600ml', barcode: '7891234567890', active: true },
    { id: '2', storeId: 'Porteira Velho', name: 'Old Beer', barcode: '111222333444', active: false },
    { id: '3', storeId: 'Sua Loja', name: 'Coca-Cola', barcode: '0123456789012', active: true }
  ];
  assert.equal(resolveScanCode(' 7891234567890\r\n', items, 'Porteira Velho')?.id, '1');
  assert.equal(resolveScanCode('7891234567890', items, 'Sua Loja'), null);
  assert.equal(resolveScanCode('111222333444', items, 'Porteira Velho'), null);
  assert.equal(resolveScanCode('123456789012', items, 'Sua Loja')?.id, '3');
});

test('computeTallyLinesSummary aggregates active lines and excludes voided lines', () => {
  const res = computeTallyLinesSummary([
    { itemId: 'a', name: 'Heineken', price: 15, qty: 2, payment: 'Card', voided: false },
    { itemId: 'a', name: 'Heineken', price: 15, qty: 1, payment: 'PIX', voided: false },
    { itemId: 'b', name: 'Prato Feito', price: 32, qty: 1, payment: 'Cash', voided: false },
    { itemId: 'c', name: 'Soda', price: 8, qty: 3, payment: 'PIX', voided: true }
  ]);
  assert.equal(res.total, 77);
  assert.equal(res.itemCount, 4);
  assert.equal(res.cardPixTotal, 45);
  assert.equal(res.byItem.length, 2);
  assert.equal(res.byItem[0].qty, 3);
});

test('reconcileLedgerRevenue and getScopedLedgerData enforce store/role scoping across tallies', () => {
  const subs = [
    { store: 'Porteira Velho', date: '2026-11-20', entryType: 'Stone', amount: 600 },
    { store: 'Porteira Velho', date: '2026-11-20', entryType: 'Cash In', amount: 400 }
  ];
  const tallies = [
    { storeId: 'Porteira Velho', date: '2026-11-20', total: 800, cardPixTotal: 500 },
    { storeId: 'Sua Loja', date: '2026-11-20', total: 350, cardPixTotal: 200 }
  ];
  const rec = reconcileLedgerRevenue(subs, tallies);
  assert.equal(rec.totalRevenue, 1350);
  assert.equal(rec.dailyBreakdown.length, 2);
  assert.equal(rec.dailyBreakdown[0].unitemized, 200);

  const emp = getScopedLedgerData({
    rawSubmissions: [],
    groupedExpenses: [],
    tallyDays: tallies,
    currentUser: { name: 'Ana', role: 'Employee', storeAssignment: 'Porteira Velho' }
  });
  assert.equal(emp.scopedTallyDays.length, 1);

  const socio = getScopedLedgerData({
    rawSubmissions: [],
    groupedExpenses: [],
    tallyDays: tallies,
    currentUser: { name: 'Leo', role: 'Sócio', storeAssignment: 'Porteira Velho' },
    selectedStore: 'Sua Loja'
  });
  assert.equal(socio.scopedTallyDays.length, 1);
  assert.equal(socio.scopedTallyDays[0].storeId, 'Porteira Velho');
});

test('computeEan13CheckDigit, isValidEan13, and generateInStoreEan13 produce valid collision-free codes', () => {
  assert.equal(computeEan13CheckDigit('789490001151'), '7');
  assert.equal(computeEan13CheckDigit('400638133393'), '1');
  assert.equal(isValidEan13('7894900011517'), true);
  assert.equal(isValidEan13('7894900011518'), false);

  const used = new Set();
  const c1 = generateInStoreEan13('Porteira Velho', used);
  used.add(c1);
  const c2 = generateInStoreEan13('Porteira Velho', used);
  assert.equal(c1.startsWith('20'), true);
  assert.equal(isValidEan13(c1), true);
  assert.equal(isValidEan13(c2), true);
  assert.notEqual(c1, c2);
});

test('encodeEan13Bits, encodeCode128BBits, and renderBarcodeSvg emit valid vector SVG barcodes', () => {
  const eanBits = encodeEan13Bits('7894900011517');
  assert.equal(eanBits.length, 95);
  assert.equal(eanBits.startsWith('101'), true);
  assert.equal(eanBits.slice(45, 50), '01010');
  assert.equal(eanBits.endsWith('101'), true);

  const c128Bits = encodeCode128BBits('PRATO-01');
  assert.equal(c128Bits.length, (1 + 8 + 1) * 11 + 13);
  assert.equal(c128Bits.startsWith('11010010000'), true); // Start B

  const svgEan = renderBarcodeSvg('7894900011517');
  assert.equal(svgEan.includes('<svg ') && svgEan.includes('<rect ') && svgEan.includes('7894900011517'), true);

  const svg128 = renderBarcodeSvg('PRATO-01');
  assert.equal(svg128.includes('<svg ') && svg128.includes('<rect ') && svg128.includes('PRATO-01'), true);
});

test('createOpenOrder, addItemToOpenOrders, removeOpenOrderById manage concurrent table orders', () => {
  const itemA = { id: 'a', name: 'Heineken', price: 15, barcode: '2000000000015', category: 'Cervejas' };
  const itemB = { id: 'b', name: 'Prato Feito', price: 30, barcode: '2000000000022', category: 'Pratos' };

  const first = addItemToOpenOrders([], '', itemA, { tableNumber: 'Mesa 4', createdBy: 'Ana' });
  assert.equal(first.orders.length, 1);
  assert.equal(first.orders[0].tableNumber, 'Mesa 4');
  assert.equal(computeOpenOrderTotal(first.orders[0]), 15);

  const secondEmpty = createOpenOrder({ tableNumber: 'Mesa 7', createdBy: 'Ana' });
  const withTwo = [...first.orders, secondEmpty];
  const afterSecondScan = addItemToOpenOrders(withTwo, secondEmpty.id, itemB);
  assert.equal(afterSecondScan.orders.length, 2);
  assert.equal(afterSecondScan.orders[0].items.length, 1);
  assert.equal(afterSecondScan.orders[1].items.length, 1);
  assert.equal(computeOpenOrderTotal(afterSecondScan.orders[1]), 30);

  const afterRemove = removeOpenOrderById(afterSecondScan.orders, first.orders[0].id);
  assert.equal(afterRemove.orders.length, 1);
  assert.equal(afterRemove.orders[0].tableNumber, 'Mesa 7');
  assert.equal(afterRemove.nextActiveOrderId, secondEmpty.id);
});
