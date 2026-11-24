// Settings Tab: Businesses, Team Roster & Splits, Categories, Integrations, Auto-Update & Preferences
import { state } from './state.js';
import {
  compressLogoImage,
  computePartnerEquityValidation,
  escapeHtml,
  formatCurrency,
  formatMemberNameWithRole,
  hideLoadingScreen,
  normalizeBarcode,
  normalizeUserRole,
  parseFlexibleNumber,
  showLoadingScreen,
  showToast,
  stripRoleSuffix
} from './utils.js';
import { t, translatePageLayout } from './i18n.js';
import {
  archiveMenuItemInDb,
  bulkAssignBarcodesInDb,
  copyMenuItemsToStoreInDb,
  fetchStoreBrandingFromDb,
  saveBusinessesToDb,
  saveCategoriesToDb,
  saveIntegrationConfigToDb,
  saveMenuItemToDb,
  saveStoreBrandingToDb,
  saveTeamRosterToDb
} from './db.js';
import { generateInStoreEan13, renderBarcodeSvg } from './barcode-svg.js';
import { openMenuPrintModal } from './menu-print.js';
import { applyAppUpdate, checkForUpdates } from './updater.js';
import { syncSnapshotToGoogleSheets } from './sheets-export.js';
import { openCameraScanner } from './scanner.js';
import { renderDynamicStreams } from './ui-sales.js';
import { populateMasterCategoryDropdown } from './ui-expenses.js';

let rosterHasLocalEdits = false;
let editingCatalogItemId = null;

export function bindSettingsEvents(onPrefsOrDashboardRefresh) {
  // Businesses
  const bizContainer = document.getElementById('settings-businesses-container');
  document.getElementById('btn-add-business')?.addEventListener('click', () => {
    state.businesses.push({ name: 'New Business', streams: 'Card, PIX' });
    renderSettingsBusinesses();
  });
  document.getElementById('btn-save-businesses')?.addEventListener('click', saveBusinessesData);
  bizContainer?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-biz]');
    if (btn) {
      state.businesses.splice(Number(btn.dataset.removeBiz), 1);
      renderSettingsBusinesses();
    }
  });

  // Categories
  const catContainer = document.getElementById('settings-categories-container');
  document.getElementById('btn-add-category')?.addEventListener('click', () => {
    state.globalExpenseCategories.push('');
    renderSettingsCategories();
  });
  document.getElementById('btn-save-categories')?.addEventListener('click', saveCategoriesData);
  catContainer?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-cat]');
    if (btn) {
      state.globalExpenseCategories.splice(Number(btn.dataset.removeCat), 1);
      renderSettingsCategories();
    }
  });

  // Team Roster delegated table events
  const rosterBody = document.getElementById('settings-roster-tbody');
  rosterBody?.addEventListener('input', (e) => {
    const el = e.target;
    const idx = Number(el.dataset.idx);
    if (Number.isNaN(idx) || !state.localTeamRoster[idx]) return;

    if (el.dataset.field === 'equity') {
      rosterHasLocalEdits = true;
      const biz = el.dataset.biz;
      if (!state.localTeamRoster[idx].equity) state.localTeamRoster[idx].equity = {};
      state.localTeamRoster[idx].equity[biz] = (parseInt(el.value, 10) || 0) / 100;
      validateSettingsSplits();
    }
  });

  rosterBody?.addEventListener('change', (e) => {
    const el = e.target;
    const idx = Number(el.dataset.idx);
    if (Number.isNaN(idx) || !state.localTeamRoster[idx]) return;

    rosterHasLocalEdits = true;
    const field = el.dataset.field;
    if (field === 'name') {
      state.localTeamRoster[idx].name = formatMemberNameWithRole(el.value, state.localTeamRoster[idx].role);
    } else if (field === 'storeAssignment') {
      const val = el.value;
      state.localTeamRoster[idx].storeAssignment = val;
      if (val !== 'All Stores' && state.localTeamRoster[idx].equity) {
        for (const b in state.localTeamRoster[idx].equity) {
          if (b !== val) state.localTeamRoster[idx].equity[b] = 0;
        }
      }
      renderSettingsRoster();
    } else if (field === 'role') {
      const val = el.value;
      state.localTeamRoster[idx].role = val;
      if (val === 'Employee') state.localTeamRoster[idx].equity = {};
      state.localTeamRoster[idx].name = formatMemberNameWithRole(state.localTeamRoster[idx].name, val);
      renderSettingsRoster();
    } else if (field === 'salary') {
      state.localTeamRoster[idx].salary = parseFlexibleNumber(el.value) || 0;
    } else if (field === 'payFrequency') {
      state.localTeamRoster[idx].payFrequency = el.value;
      if (el.value !== 'Weekly' && el.value !== 'Monthly') state.localTeamRoster[idx].payDay = null;
      renderSettingsRoster();
    } else if (field === 'payDay') {
      state.localTeamRoster[idx].payDay = parseInt(el.value, 10);
    } else if (field === 'newPin') {
      state.localTeamRoster[idx].newPin = el.value.trim();
    }
  });

  rosterBody?.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-delete-member]');
    if (delBtn) {
      const idx = Number(delBtn.dataset.deleteMember);
      const removed = stripRoleSuffix(state.localTeamRoster[idx]?.name);
      state.localTeamRoster.splice(idx, 1);
      rosterHasLocalEdits = true;
      renderSettingsRoster();
      showToast(
        state.currentLanguage === 'pt'
          ? `Removido ${removed} da lista local. Lembre-se de salvar!`
          : `Removed ${removed} from local list. Remember to Save!`
      );
    }
  });

  document.getElementById('btn-save-roster')?.addEventListener('click', saveTeamRoster);

  // Add Member Box
  document.getElementById('new-member-role')?.addEventListener('change', toggleNewSplitInput);
  document.getElementById('new-member-store')?.addEventListener('change', toggleNewSplitInput);
  document.getElementById('new-member-frequency')?.addEventListener('change', (e) => {
    togglePayDayPicker('new-member-payday-container', e.target.value);
  });
  document.getElementById('btn-add-member')?.addEventListener('click', addMemberToRosterList);

  // Integrations (Gemini + Sheets)
  document.getElementById('btn-save-integrations')?.addEventListener('click', saveIntegrations);
  document.getElementById('btn-sync-sheets-now')?.addEventListener('click', syncSnapshotToGoogleSheets);

  // Updater controls
  document.getElementById('btn-check-updates')?.addEventListener('click', () => checkForUpdates(false));
  document.getElementById('btn-install-update')?.addEventListener('click', applyAppUpdate);
  document.getElementById('btn-banner-update')?.addEventListener('click', applyAppUpdate);

  // UI Preferences
  ['pref-theme', 'pref-palette', 'pref-fontsize', 'pref-lang'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => applyPreferencesFromForm(onPrefsOrDashboardRefresh));
  });
  document.getElementById('btn-save-prefs')?.addEventListener('click', savePreferences);

  // Store Item Catalog (Socio + Admin)
  document.getElementById('catalog-store-select')?.addEventListener('change', () => {
    resetCatalogItemForm();
    renderSettingsCatalog();
  });
  document.getElementById('catalog-show-archived')?.addEventListener('change', renderSettingsCatalog);
  document.getElementById('btn-catalog-scan-barcode')?.addEventListener('click', () => {
    const barcodeInput = document.getElementById('catalog-item-barcode');
    openCameraScanner({
      continuous: false,
      title: state.currentLanguage === 'pt' ? 'Ler Código do Produto' : 'Scan Product Barcode',
      onDetected: (code) => {
        if (barcodeInput) barcodeInput.value = normalizeBarcode(code);
      }
    });
  });
  document.getElementById('catalog-item-barcode')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.value = normalizeBarcode(e.target.value);
      document.getElementById('btn-catalog-save')?.focus();
    }
  });
  document.getElementById('btn-catalog-save')?.addEventListener('click', handleSaveCatalogItem);
  document.getElementById('btn-catalog-cancel')?.addEventListener('click', resetCatalogItemForm);
  document.getElementById('btn-catalog-copy')?.addEventListener('click', handleCopyCatalogItems);
  document.getElementById('btn-catalog-gen-barcode')?.addEventListener('click', handleGenerateFormBarcode);
  document.getElementById('btn-catalog-autofill-barcodes')?.addEventListener('click', handleBulkAutofillBarcodes);
  document.getElementById('btn-catalog-print-menu')?.addEventListener('click', () => {
    const storeId = document.getElementById('catalog-store-select')?.value || state.businesses?.[0]?.name || '';
    openMenuPrintModal(storeId);
  });

  document.getElementById('catalog-logo-input')?.addEventListener('change', handleCatalogLogoUpload);
  document.getElementById('btn-catalog-remove-logo')?.addEventListener('click', handleCatalogLogoRemove);
  document.getElementById('btn-catalog-save-subtitle')?.addEventListener('click', handleCatalogSubtitleSave);

  document.getElementById('catalog-items-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-item]');
    if (editBtn) {
      startEditCatalogItem(editBtn.dataset.editItem);
      return;
    }
    const archBtn = e.target.closest('[data-archive-item]');
    if (archBtn) {
      await toggleArchiveCatalogItem(archBtn.dataset.archiveItem, false);
      return;
    }
    const restBtn = e.target.closest('[data-restore-item]');
    if (restBtn) {
      await toggleArchiveCatalogItem(restBtn.dataset.restoreItem, true);
    }
  });
}

export function syncRosterFromLive(force = false) {
  if (force || !rosterHasLocalEdits) {
    state.localTeamRoster = JSON.parse(JSON.stringify(state.teamRoster || []));
    renderSettingsRoster();
  }
}

export function populateStoreDropdowns() {
  const optionsHTML = state.businesses
    .map((b) => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`)
    .join('');

  const storeSelect = document.getElementById('store-select');
  const expStore = document.getElementById('expense-store');
  const dashFilter = document.getElementById('dashboard-store-filter');
  const newMemberStore = document.getElementById('new-member-store');

  if (storeSelect) storeSelect.innerHTML = optionsHTML;
  if (expStore) expStore.innerHTML = optionsHTML;
  if (dashFilter) dashFilter.innerHTML = `<option value="All Stores">${escapeHtml(t('opt_all_stores', 'All Stores'))}</option>${optionsHTML}`;
  if (newMemberStore) newMemberStore.innerHTML = `<option value="All Stores">${escapeHtml(t('opt_all_stores', 'All Stores'))}</option>${optionsHTML}`;

  const lockedStore =
    state.currentUser?.storeAssignment && state.currentUser.storeAssignment !== 'All Stores'
      ? state.currentUser.storeAssignment
      : '';

  if (lockedStore) {
    if (storeSelect) storeSelect.value = lockedStore;
    if (expStore) expStore.value = lockedStore;
    if (dashFilter) dashFilter.value = lockedStore;
  }

  const mobileFilters = document.getElementById('mobile-store-filters');
  if (mobileFilters) {
    if (lockedStore) {
      mobileFilters.innerHTML = `<button type="button" class="nav-btn" data-mobile-store="${escapeHtml(lockedStore)}" style="justify-content:center; border:1px solid var(--panel-border);">${escapeHtml(lockedStore)}</button>`;
    } else {
      mobileFilters.innerHTML =
        `<button type="button" class="nav-btn" data-mobile-store="All Stores" style="justify-content:center; border:1px solid var(--panel-border);">${escapeHtml(t('opt_all_stores', 'All Stores'))}</button>` +
        state.businesses
          .map(
            (b) =>
              `<button type="button" class="nav-btn" data-mobile-store="${escapeHtml(b.name)}" style="justify-content:center; border:1px solid var(--panel-border);">${escapeHtml(b.name)}</button>`
          )
          .join('');
    }
  }

  if (storeSelect?.value) renderDynamicStreams(storeSelect.value);
  else if (state.businesses.length > 0) renderDynamicStreams(state.businesses[0].name);

  populateCatalogStoreDropdowns();
  populateMasterCategoryDropdown();
}

export function populateCatalogStoreDropdowns() {
  const catStore = document.getElementById('catalog-store-select');
  const copyTarget = document.getElementById('catalog-copy-target');
  const copyWrap = document.getElementById('catalog-copy-row');
  if (!catStore) return;

  const prevCatStore = catStore.value;
  const optionsHTML = state.businesses
    .map((b) => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`)
    .join('');

  catStore.innerHTML = optionsHTML;
  if (copyTarget) copyTarget.innerHTML = optionsHTML;

  const lockedStore =
    state.currentUser?.storeAssignment && state.currentUser.storeAssignment !== 'All Stores'
      ? state.currentUser.storeAssignment
      : '';

  if (lockedStore) {
    catStore.value = lockedStore;
    catStore.disabled = true;
    if (copyWrap) copyWrap.style.display = 'none';
  } else {
    catStore.disabled = false;
    if (prevCatStore && state.businesses.some((b) => b.name === prevCatStore)) {
      catStore.value = prevCatStore;
    }
    if (copyTarget) {
      const altBiz = state.businesses.find((b) => b.name !== catStore.value);
      if (altBiz) copyTarget.value = altBiz.name;
    }
    if (copyWrap) copyWrap.style.display = state.businesses.length >= 2 ? 'flex' : 'none';
  }
}

export function renderSettingsBusinesses() {
  const container = document.getElementById('settings-businesses-container');
  if (!container) return;
  container.innerHTML = state.businesses
    .map(
      (biz, idx) => `
      <div class="calc-row" style="flex-direction:column; align-items:stretch; gap:0.65rem;">
        <div style="display:flex; justify-content:space-between; gap:0.5rem;">
          <input type="text" id="set-biz-name-${idx}" value="${escapeHtml(biz.name)}" placeholder="Business Name" style="flex:1;">
          <button type="button" data-remove-biz="${idx}" class="btn-danger-outline"><i class="fa-solid fa-trash"></i> ${escapeHtml(t('btn_remove'))}</button>
        </div>
        <input type="text" id="set-biz-streams-${idx}" value="${escapeHtml(biz.streams)}" placeholder="Comma separated streams: Stone, Rede, PIX">
      </div>
    `
    )
    .join('');
}

async function saveBusinessesData() {
  if (normalizeUserRole(state.currentUser?.role) !== 'admin') return;
  showLoadingScreen(state.currentLanguage === 'pt' ? 'Salvando Empresas...' : 'Saving Businesses...');
  const newBiz = [];
  state.businesses.forEach((_, idx) => {
    const n = document.getElementById(`set-biz-name-${idx}`)?.value.trim();
    const s = document.getElementById(`set-biz-streams-${idx}`)?.value.trim() || '';
    if (n) newBiz.push({ name: n, streams: s });
  });

  try {
    await saveBusinessesToDb(newBiz);
    state.businesses = newBiz;
    populateStoreDropdowns();
    renderSettingsRoster();
    showToast(state.currentLanguage === 'pt' ? 'Empresas atualizadas!' : 'Businesses updated!');
  } catch (err) {
    showToast('Error saving businesses: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

export function renderSettingsCategories() {
  const container = document.getElementById('settings-categories-container');
  if (!container) return;
  container.innerHTML = state.globalExpenseCategories
    .map(
      (cat, idx) => `
      <div style="display:flex; gap:0.5rem; align-items:center;">
        <input type="text" id="set-cat-name-${idx}" value="${escapeHtml(cat)}" placeholder="Category Name" style="flex:1;">
        <button type="button" data-remove-cat="${idx}" class="btn-danger-outline"><i class="fa-solid fa-trash"></i></button>
      </div>
    `
    )
    .join('');
}

async function saveCategoriesData() {
  if (normalizeUserRole(state.currentUser?.role) !== 'admin') return;
  const newCats = state.globalExpenseCategories
    .map((_, idx) => document.getElementById(`set-cat-name-${idx}`)?.value.trim())
    .filter(Boolean);

  if (newCats.length === 0) {
    showToast(state.currentLanguage === 'pt' ? 'Adicione pelo menos uma categoria' : 'Add at least one category', true);
    return;
  }

  showLoadingScreen(state.currentLanguage === 'pt' ? 'Salvando Categorias...' : 'Saving Categories...');
  try {
    await saveCategoriesToDb(newCats);
    state.globalExpenseCategories = newCats;
    populateMasterCategoryDropdown();
    showToast(state.currentLanguage === 'pt' ? 'Categorias atualizadas!' : 'Categories updated!');
  } catch (err) {
    showToast('Error saving categories: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

function buildPayDaySelect(index, freq, currentVal) {
  const curVal = currentVal !== null && currentVal !== undefined && currentVal !== '' ? parseInt(currentVal, 10) : null;
  if (freq === 'Weekly') {
    const days = [[0, 'Sunday'], [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday']];
    const opts = days
      .map(([v, label]) => `<option value="${v}" ${curVal === v || (curVal === null && v === 5) ? 'selected' : ''}>${label}</option>`)
      .join('');
    return `<select class="roster-cell-input" data-idx="${index}" data-field="payDay">${opts}</select>`;
  }
  if (freq === 'Monthly') {
    let opts = '';
    for (let d = 1; d <= 28; d++) {
      const sfx = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
      opts += `<option value="${d}" ${curVal === d || (curVal === null && d === 1) ? 'selected' : ''}>${d}${sfx}</option>`;
    }
    return `<select class="roster-cell-input" data-idx="${index}" data-field="payDay">${opts}</select>`;
  }
  return `<span style="font-size:0.8rem; color:var(--text-muted);">—</span>`;
}

export function renderSettingsRoster() {
  const tbody = document.getElementById('settings-roster-tbody');
  if (!tbody) return;

  if (state.localTeamRoster.length === 0) {
    const msg =
      state.currentLanguage === 'pt'
        ? 'Nenhum membro configurado. Adicione parceiros abaixo.'
        : 'No team members configured. Add partners below.';
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:2rem;">${msg}</td></tr>`;
    validateSettingsSplits();
    return;
  }

  tbody.innerHTML = state.localTeamRoster
    .map((member, index) => {
      const isPartner = member.role === 'Partner';
      const cleanName = stripRoleSuffix(member.name);

      let equityHTML = '<span style="font-size:0.8rem; color:var(--text-muted);">N/A</span>';
      if (isPartner) {
        const visibleStores =
          member.storeAssignment && member.storeAssignment !== 'All Stores'
            ? state.businesses.filter((b) => b.name === member.storeAssignment)
            : state.businesses;

        equityHTML = visibleStores
          .map((b) => {
            const val = Math.round(((member.equity && member.equity[b.name]) || 0) * 100);
            return `
              <div style="display:flex; align-items:center; gap:0.25rem; margin-bottom:4px; justify-content:space-between;">
                <span style="font-size:0.75rem; color:var(--text-secondary); max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</span>
                <div style="display:flex; align-items:center; gap:0.2rem;">
                  <input type="text" inputmode="decimal" class="roster-cell-input" style="width:52px; text-align:center;" data-idx="${index}" data-field="equity" data-biz="${escapeHtml(b.name)}" value="${val}">
                  <span style="font-size:0.75rem; color:var(--text-secondary);">%</span>
                </div>
              </div>
            `;
          })
          .join('');
      }

      const roleNorm = (member.role || '').toString().trim().toLowerCase();
      const pinPlaceholder = member.newPin ? escapeHtml(member.newPin) : member.pinHash ? '••••' : 'PIN';

      return `
        <tr>
          <td style="min-width:140px;">
            <input type="text" class="roster-cell-input" data-idx="${index}" data-field="name" value="${escapeHtml(cleanName)}" style="font-weight:600;">
          </td>
          <td style="min-width:135px;">
            <select class="roster-cell-input" data-idx="${index}" data-field="storeAssignment">
              <option value="All Stores" ${!member.storeAssignment || member.storeAssignment === 'All Stores' ? 'selected' : ''}>${escapeHtml(t('opt_all_stores'))}</option>
              ${state.businesses.map((b) => `<option value="${escapeHtml(b.name)}" ${member.storeAssignment === b.name ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
            </select>
          </td>
          <td style="min-width:120px;">
            <select class="roster-cell-input" data-idx="${index}" data-field="role">
              <option value="Partner" ${member.role === 'Partner' ? 'selected' : ''}>${escapeHtml(t('set_role_partner'))}</option>
              <option value="Employee" ${member.role === 'Employee' ? 'selected' : ''}>${escapeHtml(t('set_role_employee'))}</option>
              <option value="Admin" ${roleNorm === 'admin' || roleNorm === 'administrador' ? 'selected' : ''}>${escapeHtml(t('set_role_admin'))}</option>
            </select>
          </td>
          <td style="min-width:210px;">${equityHTML}</td>
          <td style="min-width:125px;">
            ${
              !isPartner
                ? `<div class="currency-field currency-field--compact"><span class="currency-prefix">R$</span><input type="text" inputmode="decimal" class="roster-cell-input" style="text-align:right;" data-idx="${index}" data-field="salary" value="${escapeHtml(member.salary || 0)}" placeholder="0,00"></div>`
                : '<span style="font-size:0.8rem; color:var(--text-muted);">N/A</span>'
            }
          </td>
          <td style="min-width:110px;">
            ${
              !isPartner
                ? `<select class="roster-cell-input" data-idx="${index}" data-field="payFrequency">
                    <option value="None" ${!member.payFrequency || member.payFrequency === 'None' ? 'selected' : ''}>${escapeHtml(t('opt_freq_none'))}</option>
                    <option value="Daily" ${member.payFrequency === 'Daily' ? 'selected' : ''}>${escapeHtml(t('opt_freq_daily'))}</option>
                    <option value="Weekly" ${member.payFrequency === 'Weekly' ? 'selected' : ''}>${escapeHtml(t('opt_freq_weekly'))}</option>
                    <option value="Monthly" ${member.payFrequency === 'Monthly' ? 'selected' : ''}>${escapeHtml(t('opt_freq_monthly'))}</option>
                  </select>`
                : '<span style="font-size:0.8rem; color:var(--text-muted);">N/A</span>'
            }
          </td>
          <td style="min-width:110px;">
            ${!isPartner && (member.payFrequency === 'Weekly' || member.payFrequency === 'Monthly') ? buildPayDaySelect(index, member.payFrequency, member.payDay) : '<span style="font-size:0.8rem; color:var(--text-muted);">—</span>'}
          </td>
          <td style="min-width:95px;">
            <input type="text" class="roster-cell-input" style="text-align:center;" data-idx="${index}" data-field="newPin" value="${escapeHtml(member.newPin || '')}" placeholder="${pinPlaceholder}">
          </td>
          <td style="text-align:center; min-width:100px;">
            <button type="button" data-delete-member="${index}" class="btn-danger-outline"><i class="fa-solid fa-trash"></i> ${escapeHtml(t('btn_remove'))}</button>
          </td>
        </tr>
      `;
    })
    .join('');

  validateSettingsSplits();
}

export function validateSettingsSplits() {
  const badge = document.getElementById('split-validation-status');
  const res = computePartnerEquityValidation(state.localTeamRoster, state.businesses);
  if (!badge) return res.valid;

  if (res.noPartners) {
    badge.innerText = t('txt_no_partners_warning');
    badge.style.background = 'rgba(245, 158, 11, 0.15)';
    badge.style.color = 'var(--warning)';
    return true;
  }

  if (res.valid) {
    badge.innerText = t('txt_valid_splits');
    badge.style.background = 'rgba(16, 185, 129, 0.15)';
    badge.style.color = 'var(--success)';
    return true;
  }

  badge.innerText =
    state.currentLanguage === 'pt'
      ? `Erro: ${res.invalidBizName} tem ${res.invalidBizTotal}% (Deve ser 100%)`
      : `Error: ${res.invalidBizName} equity is ${res.invalidBizTotal}% (Must be 100%)`;
  badge.style.background = 'rgba(239, 68, 68, 0.15)';
  badge.style.color = 'var(--danger)';
  return false;
}

function toggleNewSplitInput() {
  const role = document.getElementById('new-member-role')?.value;
  const container = document.getElementById('new-member-split-container');
  const salaryContainer = document.getElementById('new-member-salary-container');
  const grid = document.getElementById('new-member-equity-grid');
  if (!container || !grid) return;

  if (role === 'Partner') {
    container.style.display = 'flex';
    salaryContainer.style.display = 'none';
    const storeAsg = document.getElementById('new-member-store')?.value;
    const visible =
      storeAsg && storeAsg !== 'All Stores'
        ? state.businesses.filter((b) => b.name === storeAsg)
        : state.businesses;

    grid.innerHTML = visible
      .map(
        (b) => `
      <div style="display:flex; align-items:center; gap:0.5rem; min-width:170px; flex:1;">
        <span style="font-size:0.75rem; color:var(--text-secondary); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(b.name)}</span>
        <input type="text" inputmode="decimal" class="new-member-equity-input" data-biz="${escapeHtml(b.name)}" style="padding:0.35rem; font-size:0.85rem; width:64px; text-align:center;" placeholder="0">
        <span style="font-size:0.8rem; color:var(--text-secondary);">%</span>
      </div>
    `
      )
      .join('');
  } else {
    container.style.display = 'none';
    salaryContainer.style.display = 'flex';
    grid.innerHTML = '';
  }
}

function togglePayDayPicker(containerId, freq) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const select = container.querySelector('select');
  if (freq === 'Weekly') {
    const days = [[0, 'Sunday'], [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday']];
    select.innerHTML = days.map(([v, label]) => `<option value="${v}" ${v === 5 ? 'selected' : ''}>${label}</option>`).join('');
    container.style.display = 'flex';
  } else if (freq === 'Monthly') {
    let html = '';
    for (let d = 1; d <= 28; d++) {
      const sfx = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
      html += `<option value="${d}" ${d === 1 ? 'selected' : ''}>${d}${sfx}</option>`;
    }
    select.innerHTML = html;
    container.style.display = 'flex';
  } else {
    container.style.display = 'none';
  }
}

function addMemberToRosterList() {
  const nameInput = document.getElementById('new-member-name');
  const name = nameInput.value.trim();
  const role = document.getElementById('new-member-role').value;
  const storeAsg = document.getElementById('new-member-store').value;
  const pinCode = document.getElementById('new-member-pin').value.trim();

  if (!name || !pinCode) {
    showToast(
      state.currentLanguage === 'pt' ? 'Informe o nome e um PIN para o novo membro.' : 'Enter a valid name and PIN.',
      true
    );
    return;
  }

  if (state.localTeamRoster.some((m) => stripRoleSuffix(m.name).toLowerCase() === name.toLowerCase())) {
    showToast(
      state.currentLanguage === 'pt' ? 'Um membro com este nome já existe.' : 'A team member with this name already exists.',
      true
    );
    return;
  }

  const equity = {};
  let salary = 0;
  let payFrequency = 'None';
  if (role === 'Partner') {
    document.querySelectorAll('.new-member-equity-input').forEach((input) => {
      equity[input.dataset.biz] = (parseInt(input.value, 10) || 0) / 100;
    });
  } else {
    salary = parseFlexibleNumber(document.getElementById('new-member-salary').value) || 0;
    payFrequency = document.getElementById('new-member-frequency').value || 'None';
  }

  const payDayEl = document.getElementById('new-member-payday');
  const payDayContainer = document.getElementById('new-member-payday-container');
  const payDay = payDayContainer.style.display !== 'none' ? parseInt(payDayEl.value, 10) : null;

  state.localTeamRoster.push({
    name: formatMemberNameWithRole(name, role),
    role,
    equity,
    storeAssignment: storeAsg,
    newPin: pinCode,
    pinHash: '',
    salary,
    payFrequency,
    payDay
  });

  rosterHasLocalEdits = true;
  nameInput.value = '';
  document.getElementById('new-member-pin').value = '';
  document.getElementById('new-member-salary').value = '';
  document.getElementById('new-member-frequency').value = 'None';
  togglePayDayPicker('new-member-payday-container', 'None');
  toggleNewSplitInput();
  renderSettingsRoster();

  showToast(
    state.currentLanguage === 'pt'
      ? `Adicionado ${name} à lista local. Lembre-se de salvar!`
      : `Added ${name} to local list. Remember to Save!`
  );
}

async function saveTeamRoster() {
  if (normalizeUserRole(state.currentUser?.role) !== 'admin') return;
  if (!validateSettingsSplits()) {
    showToast(t('txt_invalid_splits'), true);
    return;
  }

  const missingPin = state.localTeamRoster.find((m) => !m.pinHash && (!m.newPin || !m.newPin.trim()));
  if (missingPin) {
    showToast(`Member "${stripRoleSuffix(missingPin.name)}" needs a PIN code before saving.`, true);
    return;
  }

  showLoadingScreen(state.currentLanguage === 'pt' ? 'Salvando equipe na nuvem...' : 'Saving team roster to Firebase...');
  try {
    await saveTeamRosterToDb(state.localTeamRoster);
    rosterHasLocalEdits = false;
    showToast(t('toast_roster_saved'));
  } catch (err) {
    showToast('Error saving team roster: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

export function renderIntegrationInputs() {
  const gemEl = document.getElementById('set-gemini-key');
  const sheetIdEl = document.getElementById('set-spreadsheet-id');
  const clientIdEl = document.getElementById('set-google-client-id');
  if (gemEl) gemEl.value = state.aiApiKey || '';
  if (sheetIdEl) sheetIdEl.value = state.sheetsConfig?.spreadsheetId || '';
  if (clientIdEl) clientIdEl.value = state.sheetsConfig?.googleClientId || '';
}

async function saveIntegrations() {
  if (normalizeUserRole(state.currentUser?.role) !== 'admin') return;
  const geminiApiKey = document.getElementById('set-gemini-key')?.value.trim() || '';
  const spreadsheetId = document.getElementById('set-spreadsheet-id')?.value.trim() || '';
  const googleClientId = document.getElementById('set-google-client-id')?.value.trim() || '';

  showLoadingScreen('Saving integration settings...');
  try {
    await saveIntegrationConfigToDb({ geminiApiKey, spreadsheetId, googleClientId });
    showToast(state.currentLanguage === 'pt' ? 'Integrações salvas!' : 'Integrations saved!');
  } catch (err) {
    showToast('Failed to save integrations: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

export function loadPreferences(onAfterApply) {
  let prefs = { theme: 'light', palette: 'workspace', fontSize: '100', lang: 'pt' };
  try {
    const raw = localStorage.getItem('loja_finance_prefs');
    if (raw) prefs = { ...prefs, ...JSON.parse(raw) };
  } catch (_) {}

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  setVal('pref-theme', prefs.theme);
  setVal('pref-palette', prefs.palette);
  setVal('pref-fontsize', prefs.fontSize);
  setVal('pref-lang', prefs.lang);

  applyPreferences(prefs.theme, prefs.palette, prefs.fontSize, prefs.lang, onAfterApply);
}

function applyPreferencesFromForm(onAfterApply) {
  const theme = document.getElementById('pref-theme').value;
  const palette = document.getElementById('pref-palette').value;
  const fontSize = document.getElementById('pref-fontsize').value;
  const lang = document.getElementById('pref-lang').value;
  applyPreferences(theme, palette, fontSize, lang, onAfterApply);
}

function applyPreferences(theme, palette, fontSize, lang, onAfterApply) {
  state.currentLanguage = lang;
  document.documentElement.className = `theme-${theme} palette-${palette}`;
  document.documentElement.style.fontSize = `${fontSize}%`;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#0b071e' : '#1a73e8');
  translatePageLayout(lang);
  updateDateBadgeSubtitle();
  onAfterApply?.();
}

export function updateDateBadgeSubtitle() {
  const el = document.getElementById('submission-date-label');
  if (!el) return;
  const locale = state.currentLanguage === 'pt' ? 'pt-BR' : 'en-US';
  el.innerText = new Date().toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function savePreferences() {
  const prefs = {
    theme: document.getElementById('pref-theme').value,
    palette: document.getElementById('pref-palette').value,
    fontSize: document.getElementById('pref-fontsize').value,
    lang: document.getElementById('pref-lang').value
  };
  localStorage.setItem('loja_finance_prefs', JSON.stringify(prefs));
  showToast(t('toast_saved'));
}

/* ==================== STORE ITEM CATALOG MANAGEMENT ==================== */

function resetCatalogItemForm() {
  editingCatalogItemId = null;
  const nameEl = document.getElementById('catalog-item-name');
  const priceEl = document.getElementById('catalog-item-price');
  const catEl = document.getElementById('catalog-item-category');
  const barEl = document.getElementById('catalog-item-barcode');
  const cancelBtn = document.getElementById('btn-catalog-cancel');
  const saveLabel = document.getElementById('lbl-catalog-save');

  if (nameEl) nameEl.value = '';
  if (priceEl) priceEl.value = '';
  if (catEl) catEl.value = '';
  if (barEl) barEl.value = '';
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (saveLabel) saveLabel.textContent = t('cat_item_add_btn', state.currentLanguage === 'pt' ? 'Salvar Item' : 'Save Item');
}

function startEditCatalogItem(itemId) {
  const item = (state.menuItems || []).find((m) => m.id === itemId);
  if (!item) return;
  editingCatalogItemId = item.id;

  const storeEl = document.getElementById('catalog-store-select');
  if (storeEl && !storeEl.disabled && item.storeId) storeEl.value = item.storeId;

  const nameEl = document.getElementById('catalog-item-name');
  const priceEl = document.getElementById('catalog-item-price');
  const catEl = document.getElementById('catalog-item-category');
  const barEl = document.getElementById('catalog-item-barcode');
  const cancelBtn = document.getElementById('btn-catalog-cancel');
  const saveLabel = document.getElementById('lbl-catalog-save');

  if (nameEl) nameEl.value = item.name || '';
  if (priceEl) priceEl.value = String(item.price ?? '').replace('.', ',');
  if (catEl) catEl.value = item.category || '';
  if (barEl) barEl.value = item.barcode || '';
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  if (saveLabel) {
    saveLabel.textContent = state.currentLanguage === 'pt' ? 'Atualizar Item' : 'Update Item';
  }
  nameEl?.focus();
}

export function renderSettingsCatalog() {
  const listEl = document.getElementById('catalog-items-list');
  const catDatalist = document.getElementById('catalog-category-suggestions');
  if (!listEl) return;

  const pt = state.currentLanguage === 'pt';
  const storeId = document.getElementById('catalog-store-select')?.value || state.businesses?.[0]?.name || '';
  const showArchived = Boolean(document.getElementById('catalog-show-archived')?.checked);
  renderStoreBrandingUI(storeId);

  // Sync category datalist suggestions for quick entry
  if (catDatalist) {
    const cats = Array.from(
      new Set((state.menuItems || []).filter((i) => i.storeId === storeId && i.category).map((i) => i.category.trim()))
    ).sort();
    catDatalist.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">`).join('');
  }

  // Update copy target dropdown exclusion/selection cleanly when unlocked
  const copyTarget = document.getElementById('catalog-copy-target');
  if (copyTarget && copyTarget.value === storeId && state.businesses.length >= 2) {
    const alt = state.businesses.find((b) => b.name !== storeId);
    if (alt) copyTarget.value = alt.name;
  }

  const items = (state.menuItems || []).filter((item) => {
    if ((item.storeId || '').trim() !== storeId) return false;
    if (!showArchived && item.active === false) return false;
    return true;
  });

  if (items.length === 0) {
    listEl.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:1.1rem; font-size:0.88rem;">${escapeHtml(
      pt ? 'Nenhum item cadastrado nesta loja.' : 'No items configured for this store yet.'
    )}</div>`;
    return;
  }

  listEl.innerHTML = items
    .map((item) => {
      const archived = item.active === false;
      const catBadge = item.category ? `<span class="badge">${escapeHtml(item.category)}</span>` : '';
      const barVisual = item.barcode
        ? `<div class="scan-barcode-box scan-barcode-box--catalog">${renderBarcodeSvg(item.barcode, { height: 50, barWidth: 1.8, quietModules: 10, showText: true })}</div>`
        : `<span style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(pt ? 'Sem código' : 'No barcode')}</span>`;
      const archBtn = archived
        ? `<button type="button" class="btn-secondary" style="padding:0.28rem 0.65rem; font-size:0.75rem;" data-restore-item="${escapeHtml(item.id)}"><i class="fa-solid fa-rotate-left"></i> ${escapeHtml(pt ? 'Restaurar' : 'Restore')}</button>`
        : `<button type="button" class="btn-danger-outline" data-archive-item="${escapeHtml(item.id)}"><i class="fa-solid fa-box-archive"></i> ${escapeHtml(pt ? 'Arquivar' : 'Archive')}</button>`;
      return `
        <div class="catalog-item-row ${archived ? 'archived' : ''}">
          <div style="display:flex; flex-direction:column; gap:0.25rem; min-width:140px; flex:1;">
            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
              <strong>${escapeHtml(item.name)}</strong>
              ${catBadge}
              ${archived ? `<span class="badge" style="color:var(--danger);">${escapeHtml(pt ? 'Arquivado' : 'Archived')}</span>` : ''}
            </div>
            <strong style="color:var(--accent); font-family:var(--font-display); font-size:1.02rem;">${formatCurrency(item.price)}</strong>
          </div>
          ${barVisual}
          <div style="display:flex; gap:0.45rem; flex-wrap:wrap;">
            <button type="button" class="btn-secondary" style="padding:0.28rem 0.65rem; font-size:0.75rem;" data-edit-item="${escapeHtml(item.id)}">
              <i class="fa-solid fa-pen"></i> ${escapeHtml(pt ? 'Editar' : 'Edit')}
            </button>
            ${archBtn}
          </div>
        </div>
      `;
    })
    .join('');
}

async function handleSaveCatalogItem() {
  const roleKind = normalizeUserRole(state.currentUser?.role);
  if (roleKind !== 'admin' && roleKind !== 'partner') return;

  const pt = state.currentLanguage === 'pt';
  const storeId = document.getElementById('catalog-store-select')?.value || '';
  const name = (document.getElementById('catalog-item-name')?.value || '').trim();
  const price = parseFlexibleNumber(document.getElementById('catalog-item-price')?.value) || 0;
  const category = (document.getElementById('catalog-item-category')?.value || '').trim();
  let barcode = normalizeBarcode(document.getElementById('catalog-item-barcode')?.value || '');

  if (!storeId || !name) {
    showToast(pt ? 'Selecione a loja e informe o nome do item.' : 'Select a store and enter an item name.', true);
    return;
  }
  if (price < 0) {
    showToast(pt ? 'O preço não pode ser negativo.' : 'Price cannot be negative.', true);
    return;
  }

  let autoGenerated = false;
  if (!barcode) {
    barcode = generateInStoreEan13(storeId, getActiveStoreBarcodeSet(storeId));
    autoGenerated = true;
  } else {
    // Enforce per-store barcode uniqueness among active items
    const duplicate = (state.menuItems || []).find(
      (m) =>
        m.id !== editingCatalogItemId &&
        m.active !== false &&
        (m.storeId || '').trim() === storeId &&
        normalizeBarcode(m.barcode) === barcode
    );
    if (duplicate) {
      showToast(
        pt
          ? `Este código já está vinculado a "${duplicate.name}" nesta loja.`
          : `Barcode already assigned to "${duplicate.name}" in this store.`,
        true
      );
      return;
    }
  }

  showLoadingScreen(pt ? 'Salvando item no catálogo...' : 'Saving catalog item...');
  try {
    await saveMenuItemToDb({
      id: editingCatalogItemId || undefined,
      storeId,
      name,
      price,
      category,
      barcode,
      active: true
    });
    const wasEdit = Boolean(editingCatalogItemId);
    resetCatalogItemForm();
    if (autoGenerated) {
      showToast(
        pt
          ? `Item salvo com código gerado: ${barcode}`
          : `Item saved with auto barcode: ${barcode}`
      );
    } else {
      showToast(
        wasEdit ? (pt ? 'Item atualizado!' : 'Item updated!') : pt ? 'Item adicionado ao catálogo!' : 'Item added to catalog!'
      );
    }
  } catch (err) {
    showToast('Error saving catalog item: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

function getActiveStoreBarcodeSet(storeId) {
  const cleanStore = (storeId || '').toString().trim();
  const set = new Set();
  for (const m of state.menuItems || []) {
    if (!m || m.active === false) continue;
    if ((m.storeId || '').toString().trim() !== cleanStore) continue;
    const code = normalizeBarcode(m.barcode);
    if (code) set.add(code);
  }
  return set;
}

function handleGenerateFormBarcode() {
  const storeId = document.getElementById('catalog-store-select')?.value || state.businesses?.[0]?.name || '';
  const input = document.getElementById('catalog-item-barcode');
  if (!storeId || !input) return;
  const code = generateInStoreEan13(storeId, getActiveStoreBarcodeSet(storeId));
  input.value = code;
  showToast(
    state.currentLanguage === 'pt' ? `Código gerado: ${code}` : `Generated barcode: ${code}`,
    false,
    true
  );
}

async function handleBulkAutofillBarcodes() {
  const roleKind = normalizeUserRole(state.currentUser?.role);
  if (roleKind !== 'admin' && roleKind !== 'partner') return;

  const pt = state.currentLanguage === 'pt';
  const storeId = document.getElementById('catalog-store-select')?.value || state.businesses?.[0]?.name || '';
  if (!storeId) return;

  const missing = (state.menuItems || []).filter(
    (m) => m && m.active !== false && (m.storeId || '').trim() === storeId && !normalizeBarcode(m.barcode)
  );
  if (missing.length === 0) {
    showToast(
      pt ? 'Todos os itens desta loja já possuem código de barras.' : 'All active items in this store already have barcodes.',
      false,
      true
    );
    return;
  }

  const usedSet = getActiveStoreBarcodeSet(storeId);
  const updates = missing.map((item) => {
    const code = generateInStoreEan13(storeId, usedSet);
    usedSet.add(code);
    return { id: item.id, barcode: code };
  });

  showLoadingScreen(pt ? 'Gerando códigos de barras...' : 'Generating missing barcodes...');
  try {
    const count = await bulkAssignBarcodesInDb(updates);
    showToast(pt ? `${count} código(s) gerado(s) com sucesso!` : `Generated ${count} barcode(s)!`);
  } catch (err) {
    showToast('Error generating barcodes: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

export function refreshCatalogBrandingUI() {
  const storeId = document.getElementById('catalog-store-select')?.value || state.businesses?.[0]?.name || '';
  if (storeId) renderStoreBrandingUI(storeId);
}

function renderStoreBrandingUI(storeId) {
  const previewWrap = document.getElementById('catalog-logo-preview');
  const removeBtn = document.getElementById('btn-catalog-remove-logo');
  const subInput = document.getElementById('catalog-menu-subtitle');
  if (!storeId || !previewWrap) return;

  const cached = state.storeBranding?.[storeId];
  if (!cached) {
    previewWrap.innerHTML = `<i class="fa-solid fa-store" style="color:var(--text-muted); font-size:1.35rem;"></i>`;
    if (removeBtn) removeBtn.style.display = 'none';
    if (subInput && document.activeElement !== subInput) subInput.value = '';
    fetchStoreBrandingFromDb(storeId)
      .then(() => {
        const curStore = document.getElementById('catalog-store-select')?.value || state.businesses?.[0]?.name || '';
        if (curStore === storeId) applyBrandingDom(state.storeBranding[storeId]);
      })
      .catch(() => {});
    return;
  }
  applyBrandingDom(cached);
}

function applyBrandingDom(branding = {}) {
  const previewWrap = document.getElementById('catalog-logo-preview');
  const removeBtn = document.getElementById('btn-catalog-remove-logo');
  const subInput = document.getElementById('catalog-menu-subtitle');
  if (!previewWrap) return;

  if (branding.logoDataUrl) {
    previewWrap.innerHTML = `<img src="${escapeHtml(branding.logoDataUrl)}" alt="Logo" style="max-width:100%; max-height:100%; object-fit:contain;">`;
    if (removeBtn) removeBtn.style.display = 'inline-flex';
  } else {
    previewWrap.innerHTML = `<i class="fa-solid fa-store" style="color:var(--text-muted); font-size:1.35rem;"></i>`;
    if (removeBtn) removeBtn.style.display = 'none';
  }

  if (subInput && document.activeElement !== subInput) {
    subInput.value = branding.menuSubtitle || '';
  }
}

async function handleCatalogLogoUpload(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  const roleKind = normalizeUserRole(state.currentUser?.role);
  if (roleKind !== 'admin' && roleKind !== 'partner') return;

  const storeId = document.getElementById('catalog-store-select')?.value || '';
  if (!storeId) return;

  const pt = state.currentLanguage === 'pt';
  showLoadingScreen(pt ? 'Enviando logotipo da loja...' : 'Uploading store logo...');
  try {
    const logoDataUrl = await compressLogoImage(file);
    await saveStoreBrandingToDb(storeId, { logoDataUrl });
    applyBrandingDom(state.storeBranding[storeId]);
    showToast(pt ? 'Logotipo salvo para esta loja!' : 'Store logo saved!');
  } catch (err) {
    showToast('Error saving logo: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

async function handleCatalogLogoRemove() {
  const roleKind = normalizeUserRole(state.currentUser?.role);
  if (roleKind !== 'admin' && roleKind !== 'partner') return;
  const storeId = document.getElementById('catalog-store-select')?.value || '';
  if (!storeId) return;

  const pt = state.currentLanguage === 'pt';
  showLoadingScreen(pt ? 'Removendo logotipo...' : 'Removing logo...');
  try {
    await saveStoreBrandingToDb(storeId, { logoDataUrl: '' });
    applyBrandingDom(state.storeBranding[storeId]);
    showToast(pt ? 'Logotipo removido.' : 'Store logo removed.');
  } catch (err) {
    showToast('Error removing logo: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

async function handleCatalogSubtitleSave() {
  const roleKind = normalizeUserRole(state.currentUser?.role);
  if (roleKind !== 'admin' && roleKind !== 'partner') return;
  const storeId = document.getElementById('catalog-store-select')?.value || '';
  if (!storeId) return;

  const pt = state.currentLanguage === 'pt';
  const menuSubtitle = (document.getElementById('catalog-menu-subtitle')?.value || '').trim();
  showLoadingScreen(pt ? 'Salvando subtítulo...' : 'Saving subtitle...');
  try {
    await saveStoreBrandingToDb(storeId, { menuSubtitle });
    applyBrandingDom(state.storeBranding[storeId]);
    showToast(pt ? 'Texto do cardápio salvo!' : 'Menu subtitle saved!');
  } catch (err) {
    showToast('Error saving subtitle: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

async function toggleArchiveCatalogItem(itemId, active) {
  const roleKind = normalizeUserRole(state.currentUser?.role);
  if (roleKind !== 'admin' && roleKind !== 'partner') return;
  const pt = state.currentLanguage === 'pt';
  showLoadingScreen(pt ? 'Atualizando item...' : 'Updating item...');
  try {
    await archiveMenuItemInDb(itemId, active);
    if (editingCatalogItemId === itemId && !active) resetCatalogItemForm();
    showToast(active ? (pt ? 'Item restaurado!' : 'Item restored!') : pt ? 'Item arquivado!' : 'Item archived!');
  } catch (err) {
    showToast('Error updating item: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

async function handleCopyCatalogItems() {
  const roleKind = normalizeUserRole(state.currentUser?.role);
  if (roleKind !== 'admin' && roleKind !== 'partner') return;

  const pt = state.currentLanguage === 'pt';
  const sourceStore = document.getElementById('catalog-store-select')?.value || '';
  const targetStore = document.getElementById('catalog-copy-target')?.value || '';
  if (!sourceStore || !targetStore || sourceStore === targetStore) {
    showToast(pt ? 'Escolha uma loja de destino diferente.' : 'Choose a different target store.', true);
    return;
  }

  showLoadingScreen(pt ? 'Copiando catálogo...' : 'Copying catalog...');
  try {
    const { copiedCount, skippedCount } = await copyMenuItemsToStoreInDb(sourceStore, targetStore, state.menuItems);
    showToast(
      pt
        ? `${copiedCount} item(ns) copiado(s) para ${targetStore} (${skippedCount} já existente(s)).`
        : `Copied ${copiedCount} item(s) to ${targetStore} (${skippedCount} skipped as existing).`
    );
  } catch (err) {
    showToast('Error copying items: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}
