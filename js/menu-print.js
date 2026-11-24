// Printable Categorized Barcode Menu Generator (Formats A, B, C + @media print sheet)
import { state } from './state.js';
import { escapeHtml, formatCurrency, normalizeBarcode, showToast } from './utils.js';
import { renderBarcodeSvg } from './barcode-svg.js';
import { fetchStoreBrandingFromDb } from './db.js';

let printState = {
  storeId: '',
  format: 'a',
  showBarcodes: true,
  showPrices: true,
  largeBarcodes: false,
  selectedCategories: null // null = all categories selected
};

function getUncategorizedLabel(lang = 'pt') {
  return lang === 'pt' ? 'Geral' : 'General';
}

export function groupCatalogByCategory(items = [], storeId = '', lang = 'pt') {
  const target = (storeId || '').toString().trim();
  const generalLabel = getUncategorizedLabel(lang);
  const map = new Map();

  for (const item of items || []) {
    if (!item || item.active === false) continue;
    if (target && (item.storeId || '').toString().trim() !== target) continue;
    const cat = (item.category || '').toString().trim() || generalLabel;
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(item);
  }

  const entries = Array.from(map.entries()).sort(([a], [b]) => {
    if (a === generalLabel && b !== generalLabel) return 1;
    if (b === generalLabel && a !== generalLabel) return -1;
    return a.localeCompare(b);
  });

  for (const [, list] of entries) {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  return entries;
}

export function buildPrintableMenuHtml({
  storeId = '',
  items = [],
  branding = {},
  options = {},
  lang = 'pt'
} = {}) {
  const pt = lang === 'pt';
  const format = ['a', 'b', 'c'].includes(options.format) ? options.format : 'a';
  const showBarcodes = options.showBarcodes !== false;
  const showPrices = options.showPrices !== false;
  const largeBarcodes = Boolean(options.largeBarcodes);
  const selectedCats = options.selectedCategories;

  let groups = groupCatalogByCategory(items, storeId, lang);
  if (selectedCats instanceof Set) {
    groups = groups.filter(([cat]) => selectedCats.has(cat));
  }

  const svgOpts = largeBarcodes
    ? { height: 48, barWidth: 1.75, quietModules: 11, showText: true }
    : format === 'b'
      ? { height: 38, barWidth: 1.4, quietModules: 9, showText: true }
      : { height: 34, barWidth: 1.35, quietModules: 9, showText: true };

  const logoHtml = branding?.logoDataUrl
    ? `<img class="pmenu-logo" src="${escapeHtml(branding.logoDataUrl)}" alt="${escapeHtml(storeId)}">`
    : '';
  const subtitleText = (branding?.menuSubtitle || '').trim();
  const subtitleHtml = subtitleText ? `<p class="pmenu-subtitle">${escapeHtml(subtitleText)}</p>` : '';
  const docLabel = showBarcodes
    ? pt
      ? 'Cardápio & Códigos de Barras'
      : 'Menu & Barcode Directory'
    : pt
      ? 'Cardápio'
      : 'Menu';

  const headerHtml =
    format === 'b'
      ? `
      <header class="pmenu-header pmenu-header--bar">
        <div class="pmenu-header-left">
          ${logoHtml}
          <div>
            <h1 class="pmenu-store">${escapeHtml(storeId || 'Loja')}</h1>
            ${subtitleHtml}
          </div>
        </div>
        <div class="pmenu-tag">${escapeHtml(docLabel)}</div>
      </header>
    `
      : `
      <header class="pmenu-header pmenu-header--center">
        ${logoHtml}
        <h1 class="pmenu-store">${escapeHtml(storeId || 'Loja')}</h1>
        ${subtitleHtml}
        <div class="pmenu-rule"><span>${escapeHtml(docLabel)}</span></div>
      </header>
    `;

  const renderBarcodeSlot = (item) => {
    if (!showBarcodes) return '';
    const code = normalizeBarcode(item.barcode);
    if (!code) {
      return `<div class="pmenu-nocode">${escapeHtml(pt ? 'Sem código' : 'No barcode')}</div>`;
    }
    return `<div class="pmenu-barcode-wrap">${renderBarcodeSvg(code, svgOpts)}</div>`;
  };

  let bodyHtml = '';
  if (groups.length === 0) {
    bodyHtml = `<div class="pmenu-empty">${escapeHtml(
      pt ? 'Nenhum item ativo selecionado para impressão.' : 'No active items selected for printing.'
    )}</div>`;
  } else if (format === 'a') {
    bodyHtml = `
      <div class="pmenu-cols-2">
        ${groups
          .map(
            ([cat, list]) => `
          <section class="pmenu-cat-block">
            <h2 class="pmenu-cat-title">${escapeHtml(cat)}</h2>
            <div class="pmenu-list-a">
              ${list
                .map(
                  (item) => `
                <article class="pmenu-item-a">
                  <div class="pmenu-item-row">
                    <span class="pmenu-item-name">${escapeHtml(item.name)}</span>
                    ${showPrices ? `<span class="pmenu-dots"></span><span class="pmenu-item-price">${formatCurrency(item.price)}</span>` : ''}
                  </div>
                  ${renderBarcodeSlot(item)}
                </article>
              `
                )
                .join('')}
            </div>
          </section>
        `
          )
          .join('')}
      </div>
    `;
  } else if (format === 'b') {
    bodyHtml = groups
      .map(
        ([cat, list]) => `
      <section class="pmenu-cat-block">
        <h2 class="pmenu-cat-title pmenu-cat-title--bar">${escapeHtml(cat)}</h2>
        <div class="pmenu-grid-3">
          ${list
            .map(
              (item) => `
            <article class="pmenu-card-b">
              <div class="pmenu-card-b-top">
                <span class="pmenu-item-name">${escapeHtml(item.name)}</span>
                ${showPrices ? `<span class="pmenu-item-price">${formatCurrency(item.price)}</span>` : ''}
              </div>
              ${renderBarcodeSlot(item)}
            </article>
          `
            )
            .join('')}
        </div>
      </section>
    `
      )
      .join('');
  } else {
    bodyHtml = `
      <div class="pmenu-list-c">
        ${groups
          .map(
            ([cat, list]) => `
          <section class="pmenu-cat-block">
            <h2 class="pmenu-cat-title pmenu-cat-title--editorial">${escapeHtml(cat)}</h2>
            ${list
              .map(
                (item) => `
              <article class="pmenu-item-c">
                <div class="pmenu-item-c-info">
                  <div class="pmenu-item-name">${escapeHtml(item.name)}</div>
                  ${showPrices ? `<div class="pmenu-item-price">${formatCurrency(item.price)}</div>` : ''}
                </div>
                ${renderBarcodeSlot(item)}
              </article>
            `
              )
              .join('')}
          </section>
        `
          )
          .join('')}
      </div>
    `;
  }

  return `
    <div class="pmenu pmenu--${format}">
      ${headerHtml}
      ${bodyHtml}
    </div>
  `;
}

export function bindMenuPrintEvents() {
  const modal = document.getElementById('menu-print-modal');
  document.getElementById('btn-close-menu-print')?.addEventListener('click', () => modal?.close());
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });

  document.getElementById('menu-print-formats')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-print-fmt]');
    if (!btn) return;
    printState.format = btn.dataset.printFmt || 'a';
    renderMenuPrintModal();
  });

  document.getElementById('print-opt-barcodes')?.addEventListener('change', (e) => {
    printState.showBarcodes = Boolean(e.target.checked);
    renderMenuPrintModal();
  });

  document.getElementById('print-opt-prices')?.addEventListener('change', (e) => {
    printState.showPrices = Boolean(e.target.checked);
    renderMenuPrintModal();
  });

  document.getElementById('print-opt-large')?.addEventListener('change', (e) => {
    printState.largeBarcodes = Boolean(e.target.checked);
    renderMenuPrintModal();
  });

  document.getElementById('print-opt-categories')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-print-cat]');
    if (!chip) return;
    const cat = chip.dataset.printCat;
    const allCats = groupCatalogByCategory(state.menuItems, printState.storeId, state.currentLanguage).map(([c]) => c);
    if (cat === '__ALL__') {
      printState.selectedCategories = null;
    } else {
      const current = printState.selectedCategories ? new Set(printState.selectedCategories) : new Set(allCats);
      if (current.has(cat)) current.delete(cat);
      else current.add(cat);
      printState.selectedCategories = current.size === allCats.length ? null : current;
    }
    renderMenuPrintModal();
  });

  document.getElementById('btn-print-menu-now')?.addEventListener('click', () => {
    const html = getCurrentMenuHtml();
    const sheet = document.getElementById('print-menu-sheet');
    if (sheet) sheet.innerHTML = html;
    modal?.close();
    window.print();
  });
}

function getCurrentMenuHtml() {
  return buildPrintableMenuHtml({
    storeId: printState.storeId,
    items: state.menuItems || [],
    branding: state.storeBranding?.[printState.storeId] || {},
    options: {
      format: printState.format,
      showBarcodes: printState.showBarcodes,
      showPrices: printState.showPrices,
      largeBarcodes: printState.largeBarcodes,
      selectedCategories: printState.selectedCategories
    },
    lang: state.currentLanguage || 'pt'
  });
}

export function renderMenuPrintModal() {
  document.querySelectorAll('#menu-print-formats [data-print-fmt]').forEach((btn) => {
    btn.classList.toggle('active', (btn.dataset.printFmt || 'a') === printState.format);
  });

  const barChk = document.getElementById('print-opt-barcodes');
  const priceChk = document.getElementById('print-opt-prices');
  const largeChk = document.getElementById('print-opt-large');
  if (barChk) barChk.checked = printState.showBarcodes;
  if (priceChk) priceChk.checked = printState.showPrices;
  if (largeChk) {
    largeChk.checked = printState.largeBarcodes;
    largeChk.disabled = !printState.showBarcodes;
  }

  const catsWrap = document.getElementById('print-opt-categories');
  if (catsWrap) {
    const groups = groupCatalogByCategory(state.menuItems, printState.storeId, state.currentLanguage);
    const pt = state.currentLanguage === 'pt';
    const allSelected = printState.selectedCategories === null;
    catsWrap.innerHTML = [
      `<button type="button" class="tally-chip ${allSelected ? 'active' : ''}" data-print-cat="__ALL__">${escapeHtml(
        pt ? 'Todas Categorias' : 'All Categories'
      )}</button>`,
      ...groups.map(([cat, list]) => {
        const active = allSelected || printState.selectedCategories.has(cat);
        return `<button type="button" class="tally-chip ${active ? 'active' : ''}" data-print-cat="${escapeHtml(cat)}">${escapeHtml(cat)} (${list.length})</button>`;
      })
    ].join('');
  }

  const previewEl = document.getElementById('menu-print-preview');
  const html = getCurrentMenuHtml();
  if (previewEl) previewEl.innerHTML = html;

  const sheet = document.getElementById('print-menu-sheet');
  if (sheet) sheet.innerHTML = html;
}

export async function openMenuPrintModal(storeId) {
  const cleanStore = (storeId || '').toString().trim();
  if (!cleanStore) {
    showToast(
      state.currentLanguage === 'pt' ? 'Selecione uma loja primeiro.' : 'Please select a store first.',
      true
    );
    return;
  }

  printState.storeId = cleanStore;
  printState.selectedCategories = null;
  renderMenuPrintModal();

  const modal = document.getElementById('menu-print-modal');
  if (modal && !modal.open) modal.showModal();

  if (!state.storeBranding?.[cleanStore]) {
    try {
      await fetchStoreBrandingFromDb(cleanStore);
      if (modal?.open && printState.storeId === cleanStore) {
        renderMenuPrintModal();
      }
    } catch (_) {}
  }
}
