// Settings Tab: Businesses, Team Roster & Splits, Categories, Integrations, Auto-Update & Preferences
import { state } from './state.js';
import {
  computePartnerEquityValidation,
  escapeHtml,
  formatMemberNameWithRole,
  hideLoadingScreen,
  normalizeUserRole,
  parseFlexibleNumber,
  showLoadingScreen,
  showToast,
  stripRoleSuffix
} from './utils.js';
import { t, translatePageLayout } from './i18n.js';
import {
  saveBusinessesToDb,
  saveCategoriesToDb,
  saveIntegrationConfigToDb,
  saveTeamRosterToDb
} from './db.js';
import { applyAppUpdate, checkForUpdates } from './updater.js';
import { syncSnapshotToGoogleSheets } from './sheets-export.js';
import { renderDynamicStreams } from './ui-sales.js';
import { populateMasterCategoryDropdown } from './ui-expenses.js';

let rosterHasLocalEdits = false;

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

  populateMasterCategoryDropdown();
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
