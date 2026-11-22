// Comanda (Daily Order Tally): Bluetooth/Camera barcode scanning, tap tiles, offline cart, history & retroactive edits
import { state } from './state.js';
import {
  computeTallyLinesSummary,
  escapeHtml,
  formatCurrency,
  getEffectiveDaySales,
  getSignedSubmissionAmount,
  getTodayISO,
  hideLoadingScreen,
  makeTallyDayId,
  normalizeUserRole,
  parseFlexibleNumber,
  resolveScanCode,
  round2,
  showLoadingScreen,
  showToast,
  stripRoleSuffix
} from './utils.js';
import { t, getPaymentMethodTranslation } from './i18n.js';
import {
  addRetroactiveTallyLineToDb,
  addTallyOrderToDb,
  editTallyLineInDb,
  fetchTallyEditsFromDb,
  subscribeTallyDayLines,
  voidTallyLineInDb
} from './db.js';
import { createWedgeScanner, openCameraScanner, playScanFeedback } from './scanner.js';

const OFFLINE_QUEUE_KEY = 'loja_tally_offline_queue';

let cart = [];
let selectedCategory = 'ALL';
let searchQuery = '';
let selectedPayment = '';
let activeView = 'order'; // 'order' | 'history'
let btScannerMode = false;
let subscribedKey = '';
let wedgeScanner = null;
let editingLineTarget = null;
let switchTabCallback = null;

function isPt() {
  return state.currentLanguage === 'pt';
}

function getSelectedStoreId() {
  const locked =
    state.currentUser?.storeAssignment && state.currentUser.storeAssignment !== 'All Stores'
      ? state.currentUser.storeAssignment
      : '';
  if (locked) return locked;
  const sel = document.getElementById('tally-store-select');
  return sel?.value || state.businesses?.[0]?.name || '';
}

function getHistoryDate() {
  const el = document.getElementById('tally-history-date');
  return el?.value || getTodayISO();
}

function getActiveSubscriptionDate() {
  return activeView === 'history' ? getHistoryDate() : getTodayISO();
}

function getOfflineQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function saveOfflineQueue(queue) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue || []));
  } catch (_) {}
}

function shiftIsoDate(dateIso, deltaDays) {
  const [y, m, d] = (dateIso || getTodayISO()).split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, (d || 1) + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function bindTallyEvents(switchTab) {
  switchTabCallback = switchTab;

  const storeSelect = document.getElementById('tally-store-select');
  storeSelect?.addEventListener('change', () => {
    cart = [];
    selectedCategory = 'ALL';
    subscribedKey = '';
    refreshTallyUI();
  });

  document.getElementById('btn-tally-view-order')?.addEventListener('click', () => setActiveView('order'));
  document.getElementById('btn-tally-view-history')?.addEventListener('click', () => setActiveView('history'));

  const histDateEl = document.getElementById('tally-history-date');
  if (histDateEl && !histDateEl.value) histDateEl.value = getTodayISO();
  histDateEl?.addEventListener('change', () => {
    subscribedKey = '';
    refreshTallyUI();
  });

  document.getElementById('btn-tally-prev-day')?.addEventListener('click', () => {
    if (histDateEl) {
      histDateEl.value = shiftIsoDate(getHistoryDate(), -1);
      subscribedKey = '';
      refreshTallyUI();
    }
  });
  document.getElementById('btn-tally-next-day')?.addEventListener('click', () => {
    if (histDateEl) {
      histDateEl.value = shiftIsoDate(getHistoryDate(), 1);
      subscribedKey = '';
      refreshTallyUI();
    }
  });
  document.getElementById('btn-tally-today')?.addEventListener('click', () => {
    if (histDateEl) {
      histDateEl.value = getTodayISO();
      subscribedKey = '';
      refreshTallyUI();
    }
  });

  const scanInput = document.getElementById('tally-scan-input');
  scanInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value || '';
    renderMenuTiles();
  });

  wedgeScanner = createWedgeScanner({
    inputEl: scanInput,
    onScan: (code) => handleBarcodeScan(code),
    isActive: () =>
      Boolean(
        document.getElementById('tab-tally')?.classList.contains('active') &&
          activeView === 'order' &&
          !document.querySelector('dialog[open]')
      )
  });

  document.getElementById('btn-tally-bt-mode')?.addEventListener('click', () => {
    btScannerMode = !btScannerMode;
    const btn = document.getElementById('btn-tally-bt-mode');
    if (btn) btn.classList.toggle('active', btScannerMode);
    if (scanInput) {
      scanInput.setAttribute('inputmode', btScannerMode ? 'none' : 'search');
      if (btScannerMode) scanInput.focus();
    }
    showToast(
      btScannerMode
        ? isPt()
          ? 'Modo Scanner Bluetooth ativo (teclado virtual oculto).'
          : 'Bluetooth scanner focus active (soft keyboard hidden).'
        : isPt()
          ? 'Modo busca normal restaurado.'
          : 'Normal search mode restored.',
      false,
      true
    );
  });

  document.getElementById('btn-tally-camera')?.addEventListener('click', () => {
    openCameraScanner({
      continuous: true,
      title: isPt() ? 'Escanear Itens da Comanda' : 'Scan Order Items',
      onDetected: (code) => handleBarcodeScan(code)
    });
  });

  document.getElementById('tally-category-chips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tally-cat]');
    if (!chip) return;
    selectedCategory = chip.dataset.tallyCat || 'ALL';
    renderCategoryChips();
    renderMenuTiles();
  });

  document.getElementById('tally-tiles-grid')?.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-menu-item-id]');
    if (!tile) return;
    const item = (state.menuItems || []).find((m) => m.id === tile.dataset.menuItemId);
    if (!item) return;
    addItemToCart(item);
    try {
      navigator.vibrate?.(20);
    } catch (_) {}
  });

  document.getElementById('tally-cart-items')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cart-act]');
    if (!btn) return;
    const idx = Number(btn.dataset.cartIdx);
    if (Number.isNaN(idx) || !cart[idx]) return;
    const act = btn.dataset.cartAct;
    if (act === 'inc') cart[idx].qty += 1;
    else if (act === 'dec') {
      cart[idx].qty -= 1;
      if (cart[idx].qty <= 0) cart.splice(idx, 1);
    } else if (act === 'rem') {
      cart.splice(idx, 1);
    }
    renderCart();
    renderMenuTiles();
  });

  document.getElementById('tally-payment-pills')?.addEventListener('click', (e) => {
    const pill = e.target.closest('[data-tally-pay]');
    if (!pill) return;
    selectedPayment = pill.dataset.tallyPay || '';
    renderPaymentPills();
  });

  document.getElementById('btn-tally-clear-cart')?.addEventListener('click', () => {
    cart = [];
    renderCart();
    renderMenuTiles();
  });

  document.getElementById('btn-tally-confirm')?.addEventListener('click', confirmCartOrder);
  document.getElementById('tally-offline-badge')?.addEventListener('click', () => syncOfflineTallyQueue(false));
  document.getElementById('btn-tally-go-settings')?.addEventListener('click', () => switchTabCallback?.('settings'));

  // Retroactive History Add / Edit / Void / Log
  document.getElementById('btn-tally-retro-add')?.addEventListener('click', handleRetroAddLine);
  document.getElementById('tally-hist-lines-list')?.addEventListener('click', handleHistoryLineAction);
  document.getElementById('btn-tally-edit-log')?.addEventListener('click', openEditLogModal);

  const editModal = document.getElementById('tally-edit-line-modal');
  document.getElementById('btn-close-tally-edit')?.addEventListener('click', () => editModal?.close());
  document.getElementById('btn-tally-edit-save')?.addEventListener('click', saveEditedLineQty);
  editModal?.addEventListener('click', (e) => {
    if (e.target === editModal) editModal.close();
  });

  const logModal = document.getElementById('tally-edit-log-modal');
  document.getElementById('btn-close-tally-log')?.addEventListener('click', () => logModal?.close());
  logModal?.addEventListener('click', (e) => {
    if (e.target === logModal) logModal.close();
  });
}

function setActiveView(view) {
  activeView = view === 'history' ? 'history' : 'order';
  document.getElementById('btn-tally-view-order')?.classList.toggle('active', activeView === 'order');
  document.getElementById('btn-tally-view-history')?.classList.toggle('active', activeView === 'history');

  const orderView = document.getElementById('tally-view-order');
  const histView = document.getElementById('tally-view-history');
  if (orderView) orderView.style.display = activeView === 'order' ? 'block' : 'none';
  if (histView) histView.style.display = activeView === 'history' ? 'block' : 'none';

  subscribedKey = '';
  refreshTallyUI();
}

export function refreshTallyStoreOptions() {
  const select = document.getElementById('tally-store-select');
  if (!select) return;

  const prev = select.value;
  const businesses = state.businesses || [];
  select.innerHTML = businesses
    .map((b) => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`)
    .join('');

  const assigned = state.currentUser?.storeAssignment;
  if (assigned && assigned !== 'All Stores') {
    select.value = assigned;
    select.disabled = true;
  } else {
    select.disabled = false;
    if (prev && businesses.some((b) => b.name === prev)) {
      select.value = prev;
    } else if (businesses.length > 0) {
      select.value = businesses[0].name;
    }
  }
}

function ensureTallyDaySubscription() {
  if (!state.currentUser) return;
  const storeId = getSelectedStoreId();
  const targetDate = getActiveSubscriptionDate();
  if (!storeId || !targetDate) return;

  const key = `${storeId}__${targetDate}`;
  if (subscribedKey === key) return;
  subscribedKey = key;

  subscribeTallyDayLines(storeId, targetDate, () => {
    renderSummaryBar();
    if (activeView === 'history') renderHistoryView();
  }).catch(() => {});
}

export function refreshTallyUI() {
  refreshTallyStoreOptions();
  ensureTallyDaySubscription();
  renderOfflineBadge();
  renderSummaryBar();
  renderCategoryChips();
  renderMenuTiles();
  renderCart();
  renderPaymentPills();
  if (activeView === 'history') renderHistoryView();
}

export function openTallyHistoryForDate(storeId, dateIso) {
  if (switchTabCallback) switchTabCallback('tally');
  const storeSelect = document.getElementById('tally-store-select');
  const locked = state.currentUser?.storeAssignment && state.currentUser.storeAssignment !== 'All Stores';
  if (!locked && storeSelect && storeId) {
    storeSelect.value = storeId;
  }
  const histDate = document.getElementById('tally-history-date');
  if (histDate && dateIso) histDate.value = dateIso;
  setActiveView('history');
}

function handleBarcodeScan(rawCode) {
  const storeId = getSelectedStoreId();
  const match = resolveScanCode(rawCode, state.menuItems, storeId);
  if (match) {
    addItemToCart(match);
    playScanFeedback(true);
    searchQuery = '';
    const scanInput = document.getElementById('tally-scan-input');
    if (scanInput) scanInput.value = '';
    renderMenuTiles();
    showToast(`+1 ${match.name} (${formatCurrency(match.price)})`);
    return { itemName: match.name };
  }
  playScanFeedback(false);
  showToast(
    isPt() ? `Código não cadastrado nesta loja: ${rawCode}` : `Barcode not found for this store: ${rawCode}`,
    true
  );
  return false;
}

function addItemToCart(item) {
  const idx = cart.findIndex((c) => c.itemId === item.id);
  if (idx >= 0) {
    cart[idx].qty += 1;
  } else {
    cart.push({
      itemId: item.id,
      name: item.name || '',
      barcode: item.barcode || '',
      category: item.category || '',
      price: round2(Number(item.price) || 0),
      qty: 1
    });
  }
  renderCart();
  renderMenuTiles();
}

function renderOfflineBadge() {
  const badge = document.getElementById('tally-offline-badge');
  if (!badge) return;
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'inline-flex';
  badge.innerHTML = isPt()
    ? `<i class="fa-solid fa-cloud-arrow-up"></i> ${queue.length} pendente(s)`
    : `<i class="fa-solid fa-cloud-arrow-up"></i> ${queue.length} pending sync`;
}

function getPendingTotalsForDay(storeId, dateIso) {
  let amount = 0;
  let count = 0;
  for (const q of getOfflineQueue()) {
    if (q.storeId === storeId && q.date === dateIso) {
      for (const line of q.lines || []) {
        const qty = Number(line.qty) || 0;
        const price = Number(line.price) || 0;
        amount = round2(amount + price * qty);
        count += qty;
      }
    }
  }
  return { amount, count };
}

function renderSummaryBar() {
  const storeId = getSelectedStoreId();
  const today = getTodayISO();
  const dayId = makeTallyDayId(storeId, today);
  const liveDay = (state.tallyDays || []).find((d) => d.id === dayId || (d.storeId === storeId && d.date === today));
  const pending = getPendingTotalsForDay(storeId, today);

  const totalAmt = round2((Number(liveDay?.total) || 0) + pending.amount);
  const totalCount = (Number(liveDay?.itemCount) || 0) + pending.count;

  const totalEl = document.getElementById('tally-today-total');
  const countEl = document.getElementById('tally-today-count');
  if (totalEl) totalEl.textContent = formatCurrency(totalAmt);
  if (countEl) {
    countEl.textContent = isPt() ? `${totalCount} item(ns)` : `${totalCount} item(s)`;
  }
}

function getStoreActiveItems() {
  const storeId = getSelectedStoreId();
  return (state.menuItems || []).filter((item) => (item.storeId || '').trim() === storeId && item.active !== false);
}

function renderCategoryChips() {
  const container = document.getElementById('tally-category-chips');
  if (!container) return;
  const items = getStoreActiveItems();
  const cats = Array.from(new Set(items.map((i) => (i.category || '').trim()).filter(Boolean))).sort();
  if (selectedCategory !== 'ALL' && !cats.includes(selectedCategory)) {
    selectedCategory = 'ALL';
  }

  const allLabel = isPt() ? 'Todos' : 'All';
  const chipsHtml = [
    `<button type="button" class="tally-chip ${selectedCategory === 'ALL' ? 'active' : ''}" data-tally-cat="ALL">${escapeHtml(allLabel)} (${items.length})</button>`,
    ...cats.map(
      (c) =>
        `<button type="button" class="tally-chip ${selectedCategory === c ? 'active' : ''}" data-tally-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
    )
  ];
  container.innerHTML = chipsHtml.join('');
}

function renderMenuTiles() {
  const grid = document.getElementById('tally-tiles-grid');
  if (!grid) return;

  const storeItems = getStoreActiveItems();
  if (storeItems.length === 0) {
    const canManage = ['admin', 'partner'].includes(normalizeUserRole(state.currentUser?.role));
    const msg = isPt()
      ? 'Nenhum produto cadastrado para esta loja.'
      : 'No products configured for this store yet.';
    const btnHtml = canManage
      ? `<button type="button" class="btn-secondary" style="margin-top:0.75rem;" onclick="document.getElementById('btn-tally-go-settings')?.click()"><i class="fa-solid fa-sliders"></i> ${isPt() ? 'Cadastrar nos Ajustes' : 'Add Items in Settings'}</button>`
      : '';
    grid.innerHTML = `<div class="tally-empty-state"><i class="fa-solid fa-box-open" style="font-size:1.75rem; color:var(--text-muted);"></i><p>${escapeHtml(msg)}</p>${btnHtml}</div>`;
    return;
  }

  const q = searchQuery.trim().toLowerCase();
  const filtered = storeItems.filter((item) => {
    if (selectedCategory !== 'ALL' && (item.category || '').trim() !== selectedCategory) return false;
    if (!q) return true;
    return (
      (item.name || '').toLowerCase().includes(q) ||
      (item.category || '').toLowerCase().includes(q) ||
      (item.barcode || '').toLowerCase().includes(q)
    );
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="tally-empty-state"><p>${escapeHtml(
      isPt() ? 'Nenhum item corresponde à busca.' : 'No items match your search.'
    )}</p></div>`;
    return;
  }

  const cartQtyMap = new Map(cart.map((c) => [c.itemId, c.qty]));
  grid.innerHTML = filtered
    .map((item) => {
      const inCartQty = cartQtyMap.get(item.id) || 0;
      const badgeHtml = inCartQty > 0 ? `<span class="tally-tile-qty">${inCartQty}</span>` : '';
      const catHtml = item.category ? `<span class="tally-tile-cat">${escapeHtml(item.category)}</span>` : '';
      const barcodeHtml = item.barcode
        ? `<span class="tally-tile-code"><i class="fa-solid fa-barcode"></i> ${escapeHtml(item.barcode)}</span>`
        : '';
      return `
        <button type="button" class="tally-tile ${inCartQty > 0 ? 'in-cart' : ''}" data-menu-item-id="${escapeHtml(item.id)}">
          ${badgeHtml}
          <span class="tally-tile-name">${escapeHtml(item.name)}</span>
          <span class="tally-tile-price">${formatCurrency(item.price)}</span>
          <span class="tally-tile-meta">${catHtml}${barcodeHtml}</span>
        </button>
      `;
    })
    .join('');
}

function renderCart() {
  const listEl = document.getElementById('tally-cart-items');
  const totalEl = document.getElementById('tally-cart-total');
  const confirmBtn = document.getElementById('btn-tally-confirm');
  const clearBtn = document.getElementById('btn-tally-clear-cart');
  if (!listEl) return;

  if (cart.length === 0) {
    listEl.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:1.25rem 0.5rem; font-size:0.88rem;">
      <i class="fa-solid fa-cart-shopping" style="margin-bottom:0.35rem; font-size:1.2rem; display:block;"></i>
      ${escapeHtml(isPt() ? 'Escaneie um código ou toque nos itens para montar o pedido.' : 'Scan a barcode or tap items to build an order.')}
    </div>`;
    if (totalEl) totalEl.textContent = formatCurrency(0);
    if (confirmBtn) confirmBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    return;
  }

  let orderTotal = 0;
  listEl.innerHTML = cart
    .map((line, idx) => {
      const sub = round2(line.price * line.qty);
      orderTotal = round2(orderTotal + sub);
      return `
        <div class="tally-cart-row">
          <div class="tally-cart-info">
            <div class="tally-cart-name">${escapeHtml(line.name)}</div>
            <div class="tally-cart-unit">${formatCurrency(line.price)} × ${line.qty} = <strong>${formatCurrency(sub)}</strong></div>
          </div>
          <div class="tally-qty-stepper">
            <button type="button" data-cart-act="dec" data-cart-idx="${idx}" aria-label="Decrease">−</button>
            <span>${line.qty}</span>
            <button type="button" data-cart-act="inc" data-cart-idx="${idx}" aria-label="Increase">+</button>
            <button type="button" class="del" data-cart-act="rem" data-cart-idx="${idx}" aria-label="Remove"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      `;
    })
    .join('');

  if (totalEl) totalEl.textContent = formatCurrency(orderTotal);
  if (confirmBtn) confirmBtn.disabled = false;
  if (clearBtn) clearBtn.disabled = false;
}

function renderPaymentPills() {
  document.querySelectorAll('#tally-payment-pills [data-tally-pay]').forEach((btn) => {
    btn.classList.toggle('active', (btn.dataset.tallyPay || '') === selectedPayment);
  });
}

async function confirmCartOrder() {
  if (cart.length === 0 || !state.currentUser) return;
  const storeId = getSelectedStoreId();
  if (!storeId) {
    showToast(isPt() ? 'Selecione uma loja primeiro.' : 'Please select a store first.', true);
    return;
  }

  const orderPayload = {
    storeId,
    date: getTodayISO(),
    orderId: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    payment: selectedPayment,
    lines: cart.map((c) => ({ ...c })),
    userId: state.currentUser.id || '',
    userName: state.currentUser.name || ''
  };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    queueOfflineOrder(orderPayload);
    return;
  }

  showLoadingScreen(isPt() ? 'Registrando pedido na comanda...' : 'Saving order to daily tally...');
  try {
    await addTallyOrderToDb(orderPayload);
    cart = [];
    renderCart();
    renderMenuTiles();
    showToast(isPt() ? 'Pedido confirmado na comanda!' : 'Order added to tally!');
  } catch (err) {
    const msg = (err?.message || '').toLowerCase();
    if (!navigator.onLine || msg.includes('offline') || msg.includes('network') || msg.includes('unavailable')) {
      queueOfflineOrder(orderPayload);
    } else {
      showToast('Error saving order: ' + err.message, true);
    }
  } finally {
    hideLoadingScreen();
  }
}

function queueOfflineOrder(orderPayload) {
  const queue = getOfflineQueue();
  queue.push({ ...orderPayload, queuedAt: new Date().toISOString() });
  saveOfflineQueue(queue);
  cart = [];
  renderCart();
  renderMenuTiles();
  renderOfflineBadge();
  renderSummaryBar();
  showToast(
    isPt()
      ? 'Sem internet: pedido salvo na fila offline e será sincronizado automaticamente.'
      : 'Offline: order queued locally and will sync automatically.',
    false,
    true
  );
}

export async function syncOfflineTallyQueue(silent = true) {
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    renderOfflineBadge();
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (!silent) {
      showToast(isPt() ? 'Dispositivo ainda offline.' : 'Device is still offline.', true);
    }
    return;
  }

  const remaining = [];
  let syncedCount = 0;

  for (let i = 0; i < queue.length; i++) {
    const order = queue[i];
    try {
      await addTallyOrderToDb({ ...order, checkIdempotent: true });
      syncedCount += 1;
    } catch (_) {
      remaining.push(...queue.slice(i));
      break;
    }
  }

  saveOfflineQueue(remaining);
  renderOfflineBadge();
  renderSummaryBar();

  if (syncedCount > 0) {
    showToast(
      isPt()
        ? `${syncedCount} pedido(s) offline sincronizado(s)!`
        : `Synced ${syncedCount} offline order(s)!`
    );
  }
}

function renderHistoryView() {
  const storeId = getSelectedStoreId();
  const dateIso = getHistoryDate();
  const roleKind = normalizeUserRole(state.currentUser?.role);
  const isManager = roleKind === 'admin' || roleKind === 'partner';
  const todayIso = getTodayISO();

  const lines = state.activeTallyLines || [];
  const summary = computeTallyLinesSummary(lines);

  // Manual submissions total for same store & date
  let manualTotal = 0;
  for (const sub of state.rawSubmissions || []) {
    if ((sub.store || 'Store 1').trim() === storeId && sub.date === dateIso) {
      manualTotal += getSignedSubmissionAmount(sub.entryType, parseFlexibleNumber(sub.amount) || 0);
    }
  }
  const recon = getEffectiveDaySales(manualTotal, summary.total);

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  setText('tally-hist-summary-tally', formatCurrency(recon.tally));
  setText('tally-hist-summary-manual', formatCurrency(recon.manual));
  setText('tally-hist-summary-unitemized', formatCurrency(recon.unitemized));
  setText('tally-hist-summary-reported', formatCurrency(recon.reported));

  // Role-gated Retroactive Controls
  const retroBox = document.getElementById('tally-retro-add-box');
  const editLogBtn = document.getElementById('btn-tally-edit-log');
  if (retroBox) retroBox.style.display = isManager ? 'block' : 'none';
  if (editLogBtn) editLogBtn.style.display = isManager ? 'inline-flex' : 'none';

  if (isManager) {
    const retroItemSelect = document.getElementById('tally-retro-item');
    if (retroItemSelect) {
      const storeItems = getStoreActiveItems();
      retroItemSelect.innerHTML = storeItems.length
        ? storeItems
            .map(
              (m) =>
                `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} (${formatCurrency(m.price)})</option>`
            )
            .join('')
        : `<option value="">${escapeHtml(isPt() ? 'Sem itens na loja' : 'No store items')}</option>`;
    }
  }

  // Per-item aggregated table
  const itemsTbody = document.getElementById('tally-hist-items-tbody');
  if (itemsTbody) {
    if (summary.byItem.length === 0) {
      itemsTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">${escapeHtml(
        isPt() ? 'Nenhum item lançado neste dia.' : 'No items recorded on this day.'
      )}</td></tr>`;
    } else {
      itemsTbody.innerHTML = summary.byItem
        .map(
          (row) => `
          <tr>
            <td><strong>${escapeHtml(row.name)}</strong>${row.category ? ` <span class="badge">${escapeHtml(row.category)}</span>` : ''}</td>
            <td>${row.qty}</td>
            <td>${formatCurrency(row.price)}</td>
            <td style="font-weight:700; color:var(--accent);">${formatCurrency(row.subtotal)}</td>
          </tr>
        `
        )
        .join('');
    }
  }

  // Chronological lines
  const linesList = document.getElementById('tally-hist-lines-list');
  if (!linesList) return;

  if (lines.length === 0) {
    linesList.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:1rem; font-size:0.88rem;">${escapeHtml(
      isPt() ? 'Sem lançamentos na comanda para esta data.' : 'No tally events for this date.'
    )}</div>`;
    return;
  }

  const selfName = stripRoleSuffix(state.currentUser?.name).toLowerCase();
  const selfId = state.currentUser?.id || '';

  linesList.innerHTML = lines
    .map((line) => {
      const isVoided = line.voided === true;
      const subtotal = round2((Number(line.price) || 0) * (Number(line.qty) || 0));
      const timeLabel = line.createdAt
        ? new Date(line.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      const whoLabel = stripRoleSuffix(line.userName || '');
      const payLabel = line.payment ? getPaymentMethodTranslation(line.payment) : '';
      const isOwner =
        (selfId && line.userId === selfId) ||
        (selfName && stripRoleSuffix(line.userName).toLowerCase() === selfName);
      const canEmployeeUndo = !isVoided && !isManager && dateIso === todayIso && isOwner;
      const canManagerEdit = !isVoided && isManager;

      let statusNote = '';
      if (isVoided) {
        statusNote = `<span class="badge" style="color:var(--danger);">${escapeHtml(
          isPt() ? `Estornado por ${stripRoleSuffix(line.voidedBy || '')}` : `Voided by ${stripRoleSuffix(line.voidedBy || '')}`
        )}</span>`;
      } else if (line.editedBy) {
        statusNote = `<span class="badge">${escapeHtml(
          isPt() ? `Editado por ${stripRoleSuffix(line.editedBy)}` : `Edited by ${stripRoleSuffix(line.editedBy)}`
        )}</span>`;
      } else if (line.retroactive) {
        statusNote = `<span class="badge">${escapeHtml(isPt() ? 'Retroativo' : 'Retroactive')}</span>`;
      }

      const actionsHtml = canManagerEdit
        ? `
          <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
            <button type="button" class="btn-secondary" style="padding:0.28rem 0.6rem; font-size:0.75rem;" data-line-act="edit" data-line-id="${escapeHtml(line.id)}">
              <i class="fa-solid fa-pen"></i> ${escapeHtml(isPt() ? 'Qtd' : 'Qty')}
            </button>
            <button type="button" class="btn-danger-outline" data-line-act="void" data-line-id="${escapeHtml(line.id)}">
              <i class="fa-solid fa-ban"></i> ${escapeHtml(isPt() ? 'Estornar' : 'Void')}
            </button>
          </div>
        `
        : canEmployeeUndo
          ? `
            <button type="button" class="btn-danger-outline" data-line-act="void" data-line-id="${escapeHtml(line.id)}">
              <i class="fa-solid fa-rotate-left"></i> ${escapeHtml(isPt() ? 'Desfazer' : 'Undo')}
            </button>
          `
          : '';

      return `
        <div class="tally-line-row ${isVoided ? 'voided' : ''}">
          <div class="tally-line-main">
            <div>
              <strong>${line.qty}× ${escapeHtml(line.name)}</strong>
              <span style="color:var(--text-secondary); font-size:0.82rem; margin-left:0.35rem;">(${formatCurrency(line.price)})</span>
            </div>
            <div style="font-size:0.78rem; color:var(--text-secondary); display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.2rem;">
              ${timeLabel ? `<span><i class="fa-regular fa-clock"></i> ${escapeHtml(timeLabel)}</span>` : ''}
              ${whoLabel ? `<span><i class="fa-regular fa-user"></i> ${escapeHtml(whoLabel)}</span>` : ''}
              ${payLabel ? `<span class="badge">${escapeHtml(payLabel)}</span>` : ''}
              ${statusNote}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.65rem; flex-wrap:wrap;">
            <strong style="font-family:var(--font-display);">${formatCurrency(subtotal)}</strong>
            ${actionsHtml}
          </div>
        </div>
      `;
    })
    .join('');
}

async function handleRetroAddLine() {
  const roleKind = normalizeUserRole(state.currentUser?.role);
  if (roleKind !== 'admin' && roleKind !== 'partner') return;

  const storeId = getSelectedStoreId();
  const dateIso = getHistoryDate();
  const itemId = document.getElementById('tally-retro-item')?.value;
  const qty = Math.max(1, parseInt(document.getElementById('tally-retro-qty')?.value, 10) || 1);
  const payment = document.getElementById('tally-retro-payment')?.value || '';
  const item = (state.menuItems || []).find((m) => m.id === itemId);
  if (!item) {
    showToast(isPt() ? 'Selecione um item válido.' : 'Select a valid catalog item.', true);
    return;
  }

  showLoadingScreen(isPt() ? 'Adicionando lançamento...' : 'Adding retroactive entry...');
  try {
    await addRetroactiveTallyLineToDb({
      storeId,
      date: dateIso,
      item,
      qty,
      payment,
      userId: state.currentUser?.id || '',
      userName: state.currentUser?.name || ''
    });
    showToast(isPt() ? 'Lançamento adicionado e auditado!' : 'Retroactive line added & logged!');
  } catch (err) {
    showToast('Error adding line: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

async function handleHistoryLineAction(e) {
  const btn = e.target.closest('[data-line-act]');
  if (!btn) return;
  const lineId = btn.dataset.lineId;
  const act = btn.dataset.lineAct;
  const line = (state.activeTallyLines || []).find((l) => l.id === lineId);
  if (!line || line.voided) return;

  const roleKind = normalizeUserRole(state.currentUser?.role);
  const isManager = roleKind === 'admin' || roleKind === 'partner';
  const storeId = getSelectedStoreId();
  const dateIso = getHistoryDate();

  if (act === 'edit' && isManager) {
    editingLineTarget = { storeId, date: dateIso, line };
    const lbl = document.getElementById('tally-edit-item-label');
    const qtyEl = document.getElementById('tally-edit-qty-input');
    if (lbl) lbl.textContent = `${line.name} (${formatCurrency(line.price)})`;
    if (qtyEl) qtyEl.value = String(line.qty || 1);
    document.getElementById('tally-edit-line-modal')?.showModal();
    return;
  }

  if (act === 'void') {
    showLoadingScreen(isPt() ? 'Estornando lançamento...' : 'Voiding line...');
    try {
      await voidTallyLineInDb({
        storeId,
        date: dateIso,
        lineId,
        userId: state.currentUser?.id || '',
        userName: state.currentUser?.name || ''
      });
      showToast(isPt() ? 'Lançamento estornado!' : 'Line voided!');
    } catch (err) {
      showToast('Error voiding line: ' + err.message, true);
    } finally {
      hideLoadingScreen();
    }
  }
}

async function saveEditedLineQty() {
  if (!editingLineTarget) return;
  const newQty = Math.max(1, parseInt(document.getElementById('tally-edit-qty-input')?.value, 10) || 1);
  const { storeId, date, line } = editingLineTarget;
  document.getElementById('tally-edit-line-modal')?.close();
  editingLineTarget = null;

  showLoadingScreen(isPt() ? 'Atualizando quantidade...' : 'Updating quantity...');
  try {
    await editTallyLineInDb({
      storeId,
      date,
      lineId: line.id,
      newQty,
      userId: state.currentUser?.id || '',
      userName: state.currentUser?.name || ''
    });
    showToast(isPt() ? 'Quantidade atualizada!' : 'Quantity updated!');
  } catch (err) {
    showToast('Error updating quantity: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

async function openEditLogModal() {
  const modal = document.getElementById('tally-edit-log-modal');
  const listEl = document.getElementById('tally-edit-log-list');
  if (!modal || !listEl) return;

  const storeId = getSelectedStoreId();
  const dateIso = getHistoryDate();
  showLoadingScreen(isPt() ? 'Carregando auditoria...' : 'Loading edit history...');
  try {
    const edits = await fetchTallyEditsFromDb(storeId, dateIso);
    if (edits.length === 0) {
      listEl.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:1rem;">${escapeHtml(
        isPt() ? 'Nenhuma edição registrada nesta data.' : 'No edits recorded for this date.'
      )}</p>`;
    } else {
      listEl.innerHTML = edits
        .map((ed) => {
          const when = ed.at ? new Date(ed.at).toLocaleString() : '';
          const actionLabel =
            ed.action === 'void'
              ? isPt()
                ? 'Estornou'
                : 'Voided'
              : ed.action === 'add_line'
                ? isPt()
                  ? 'Adicionou'
                  : 'Added'
                : isPt()
                  ? 'Alterou Qtd'
                  : 'Edited Qty';
          const detail =
            ed.action === 'edit_qty'
              ? `${ed.before?.qty ?? '?'} → ${ed.after?.qty ?? '?'}`
              : `${ed.after?.qty ?? ed.before?.qty ?? 1}×`;
          return `
            <div class="calc-row" style="flex-direction:column; align-items:flex-start; gap:0.25rem;">
              <div style="display:flex; justify-content:space-between; width:100%; gap:0.5rem;">
                <strong>${escapeHtml(actionLabel)}: ${escapeHtml(ed.itemName || '')} (${escapeHtml(detail)})</strong>
                <span class="badge">${escapeHtml(stripRoleSuffix(ed.userName || ''))}</span>
              </div>
              <span style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(when)}</span>
            </div>
          `;
        })
        .join('');
    }
    modal.showModal();
  } catch (err) {
    showToast('Error loading audit log: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}
