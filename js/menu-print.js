// Printable Categorized Barcode Menu Generator (Formats A, B, C, 4-7 cols + @media print sheet)
import { state } from './state.js';
import {
  escapeHtml,
  formatCurrency,
  getCategoryAccentColor,
  normalizeBarcode,
  showToast,
  sortCategoriesCanonical
} from './utils.js';
import { renderBarcodeSvg } from './barcode-svg.js';
import { fetchStoreBrandingFromDb } from './db.js';

let printState = {
  storeId: '',
  format: 'a',
  orientation: 'portrait',
  density: 'normal',
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

  const sortedKeys = sortCategoriesCanonical(Array.from(map.keys()));
  const entries = sortedKeys.map((k) => [k, map.get(k)]);

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
  const validFormats = ['a', 'b', 'c', '4', '5', '6', '7'];
  const format = validFormats.includes(options.format) ? options.format : 'a';
  const density = options.density === 'super' ? 'super' : 'normal';
  const showBarcodes = options.showBarcodes !== false;
  const showPrices = options.showPrices !== false;
  const largeBarcodes = Boolean(options.largeBarcodes);
  const selectedCats = options.selectedCategories;

  let groups = groupCatalogByCategory(items, storeId, lang);
  if (selectedCats instanceof Set) {
    groups = groups.filter(([cat]) => selectedCats.has(cat));
  }

  const isMultiCol = ['4', '5', '6', '7'].includes(format);
  const svgOpts = largeBarcodes
    ? { height: isMultiCol ? 38 : 48, barWidth: isMultiCol ? 1.45 : 1.75, quietModules: 10, showText: true }
    : isMultiCol
      ? { height: density === 'super' ? 24 : 28, barWidth: 1.15, quietModules: 7, showText: true }
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

  const headerHtml = `
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
  } else if (['b', '4', '5', '6', '7'].includes(format)) {
    const gridClass = format === 'b' ? 'pmenu-grid-3' : `pmenu-grid-${format}`;
    bodyHtml = groups
      .map(
        ([cat, list]) => `
      <section class="pmenu-cat-block" style="--cat-accent:${getCategoryAccentColor(cat)};">
        <h2 class="pmenu-cat-title pmenu-cat-title--bar">${escapeHtml(cat)}</h2>
        <div class="${gridClass}">
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

  const miscPrintHtml = showBarcodes
    ? `
      <section class="pmenu-cat-block" style="--cat-accent:#64748b; margin-top:8px;">
        <h2 class="pmenu-cat-title pmenu-cat-title--bar">${escapeHtml(pt ? 'Diversos / Avulso' : 'Miscellaneous')}</h2>
        <div class="pmenu-card-b" style="max-width:240px;">
          <div class="pmenu-card-b-top">
            <span class="pmenu-item-name">${escapeHtml(pt ? 'Item Diversos (Digitar Nome & R$)' : 'Misc Item (Custom Name & Price)')}</span>
          </div>
          <div class="pmenu-barcode-wrap">${renderBarcodeSvg('2099999999990', svgOpts)}</div>
        </div>
      </section>
    `
    : '';

  return `
    <div class="pmenu pmenu--${format} ${density === 'super' ? 'pmenu--super' : ''}">
      ${headerHtml}
      ${bodyHtml}
      ${miscPrintHtml}
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

  document.getElementById('print-opt-orientation')?.addEventListener('change', (e) => {
    printState.orientation = e.target.value === 'landscape' ? 'landscape' : 'portrait';
    renderMenuPrintModal();
  });

  document.getElementById('print-opt-density')?.addEventListener('change', (e) => {
    printState.density = e.target.value === 'super' ? 'super' : 'normal';
    renderMenuPrintModal();
  });

  document.getElementById('btn-print-menu-now')?.addEventListener('click', () => {
    let styleEl = document.getElementById('print-page-orientation-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'print-page-orientation-style';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `@media print { @page { size: A4 ${printState.orientation}; margin: 8mm; } }`;
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
      orientation: printState.orientation,
      density: printState.density,
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

  const orientSel = document.getElementById('print-opt-orientation');
  const densitySel = document.getElementById('print-opt-density');
  if (orientSel) orientSel.value = printState.orientation;
  if (densitySel) densitySel.value = printState.density;

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
