// Dashboard KPIs, Charts, Partner Profit Shares, History Tables, Duplicate & Receipt Modal
import { state } from './state.js';
import {
  escapeHtml,
  formatCurrency,
  getScopedLedgerData,
  getSignedSubmissionAmount,
  hideLoadingScreen,
  normalizeUserRole,
  parseFlexibleNumber,
  showLoadingScreen,
  showToast,
  stripRoleSuffix
} from './utils.js';
import { getCategoryTranslation, getPaymentMethodTranslation, t } from './i18n.js';
import { getReceiptDataUrl } from './db.js';
import { renderDynamicStreams, calculateLiveTotal } from './ui-sales.js';
import { addExpenseLine, calculateExpenseTotal, toggleItemizedMode } from './ui-expenses.js';
import { exportHistoryCSV } from './sheets-export.js';

let dashboardChartInstance = null;
let portfolioChartInstance = null;

export function bindDashboardEvents(switchTab) {
  document.getElementById('time-filter')?.addEventListener('change', renderDashboard);
  document.getElementById('dashboard-store-filter')?.addEventListener('change', renderDashboard);
  document.getElementById('btn-export-csv')?.addEventListener('click', exportHistoryCSV);

  const handleHistoryClick = async (e) => {
    const dupBtn = e.target.closest('.btn-duplicate');
    if (dupBtn) {
      duplicateHistoryEntry(dupBtn.closest('tr'), switchTab);
      return;
    }

    const receiptBtn = e.target.closest('button.receipt-btn[data-receipt-id]');
    if (receiptBtn) {
      await openReceiptModal(receiptBtn.dataset.receiptId);
    }
  };

  document.getElementById('history-tbody')?.addEventListener('click', handleHistoryClick);
  document.getElementById('history-expenses-tbody')?.addEventListener('click', handleHistoryClick);

  const modal = document.getElementById('receipt-modal');
  document.getElementById('btn-close-receipt-modal')?.addEventListener('click', () => modal?.close());
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });
}

export function showSkeletons() {
  ['kpi-revenue', 'kpi-expenses', 'kpi-netprofit', 'kpi-cards'].forEach((id) => {
    document.getElementById(id)?.classList.add('skeleton');
  });
}

function removeSkeletons() {
  ['kpi-revenue', 'kpi-expenses', 'kpi-netprofit', 'kpi-cards'].forEach((id) => {
    document.getElementById(id)?.classList.remove('skeleton');
  });
}

export function renderDashboard() {
  removeSkeletons();

  const requestedStore = document.getElementById('dashboard-store-filter')?.value || 'All Stores';
  const timeFilter = document.getElementById('time-filter')?.value || '30';
  const scoped = getScopedLedgerData({
    rawSubmissions: state.rawSubmissions,
    groupedExpenses: state.groupedExpenses,
    teamRoster: state.teamRoster,
    businesses: state.businesses,
    currentUser: state.currentUser,
    selectedStore: requestedStore
  });

  const scopeBadge = document.getElementById('dashboard-scope-badge');
  if (scopeBadge) {
    if (scoped.roleKind === 'employee') {
      scopeBadge.innerText = t('scope_employee', 'Your Entries Only');
      scopeBadge.style.display = 'inline-flex';
    } else if (scoped.effectiveStore !== 'All Stores') {
      scopeBadge.innerText = `${t('scope_store', 'Scope: ')}${scoped.effectiveStore}`;
      scopeBadge.style.display = 'inline-flex';
    } else {
      scopeBadge.style.display = 'none';
    }
  }

  const partnerPanel = document.getElementById('partner-split-panel');
  if (partnerPanel) partnerPanel.style.display = scoped.roleKind === 'employee' ? 'none' : 'block';

  const storeSubmissions = scoped.scopedSubmissions;
  const storeExpenses = scoped.scopedExpenses;

  let filteredSubmissions = [...storeSubmissions];
  let filteredExpenses = [...storeExpenses];

  if (timeFilter === '7') {
    filteredSubmissions = filteredSubmissions.slice(0, 7);
    filteredExpenses = filteredExpenses.slice(0, 7);
  } else if (timeFilter === '30') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    filteredSubmissions = filteredSubmissions.filter((item) => new Date(item.date) >= cutoff);
    filteredExpenses = filteredExpenses.filter((item) => new Date(item.date) >= cutoff);
  }

  let totalRevenue = 0;
  let card1Total = 0;
  const bizProfit = {};
  scoped.visibleBusinesses.forEach((b) => {
    bizProfit[b.name] = 0;
  });

  filteredSubmissions.forEach((item) => {
    const amt = parseFlexibleNumber(item.amount) || 0;
    const tot = getSignedSubmissionAmount(item.entryType, amt);
    totalRevenue += tot;

    if (!['Cash In', 'Cash Out', 'Fee'].includes(item.entryType)) {
      card1Total += amt;
    }

    const st = item.store || 'Store 1';
    if (bizProfit[st] === undefined) bizProfit[st] = 0;
    bizProfit[st] += tot;
  });

  let totalExpenses = 0;
  filteredExpenses.forEach((item) => {
    const amt = parseFlexibleNumber(item.amount) || 0;
    totalExpenses += amt;
    const st = item.store || 'Store 1';
    if (bizProfit[st] === undefined) bizProfit[st] = 0;
    bizProfit[st] -= amt;
  });

  const netProfit = totalRevenue - totalExpenses;

  document.getElementById('kpi-revenue').innerText = formatCurrency(totalRevenue);
  document.getElementById('kpi-expenses').innerText = formatCurrency(totalExpenses);
  document.getElementById('kpi-netprofit').innerText = formatCurrency(netProfit);
  document.getElementById('kpi-cards').innerText = formatCurrency(card1Total);

  renderPartnerSharesList(netProfit, bizProfit, scoped.visiblePartners);
  renderDashboardChart(filteredSubmissions, filteredExpenses);
  renderPortfolioChart(filteredSubmissions, filteredExpenses, scoped.visibleBusinesses);
  renderHistoryTables(storeSubmissions, storeExpenses);
}

function renderPartnerSharesList(netProfit, bizProfit, partners) {
  const container = document.getElementById('partner-shares-output-container');
  if (!container) return;
  container.innerHTML = '';

  if (!partners || partners.length === 0) {
    container.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:1rem; font-size:0.85rem;"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(t('txt_no_partners'))}</div>`;
    return;
  }

  partners.forEach((partner) => {
    let shareAmount = 0;
    if (partner.equity) {
      for (const biz in partner.equity) {
        if (bizProfit && bizProfit[biz]) {
          shareAmount += bizProfit[biz] * partner.equity[biz];
        }
      }
    }

    let displayName = partner.name || '';
    displayName =
      state.currentLanguage === 'en'
        ? displayName.replace('(Sócio)', '(Partner)')
        : displayName.replace('(Partner)', '(Sócio)');

    const breakdownArr = [];
    if (partner.equity) {
      for (const biz in partner.equity) {
        const pct = Math.round((partner.equity[biz] || 0) * 100);
        if (pct > 0) breakdownArr.push(`${biz}: ${pct}%`);
      }
    }

    const row = document.createElement('div');
    row.className = 'calc-row';
    row.innerHTML = `
      <span class="calc-partner-name" style="display:flex; flex-direction:column; gap:0.2rem;">
        <span><i class="fa-solid fa-user-tie" style="color: var(--primary); margin-right: 0.45rem;"></i> ${escapeHtml(displayName)}</span>
        <span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">${escapeHtml(breakdownArr.join(' | ') || '0%')}</span>
      </span>
      <span class="calc-partner-share">${formatCurrency(shareAmount)}</span>
    `;
    container.appendChild(row);
  });

  const labelCombined = state.currentLanguage === 'pt' ? 'Total Combinado' : 'Combined Total';
  const totalRow = document.createElement('div');
  totalRow.className = 'calc-row';
  totalRow.style.background = 'rgba(16, 185, 129, 0.06)';
  totalRow.style.borderColor = 'rgba(16, 185, 129, 0.25)';
  totalRow.innerHTML = `
    <span class="calc-partner-name"><i class="fa-solid fa-circle-check" style="color: var(--success); margin-right: 0.45rem;"></i> ${labelCombined}</span>
    <span class="calc-partner-share" style="color: var(--success); font-size: 1.1rem;">${formatCurrency(netProfit)}</span>
  `;
  container.appendChild(totalRow);
}

function getChartThemeOptions() {
  const styles = getComputedStyle(document.documentElement);
  const textColor = styles.getPropertyValue('--text-secondary').trim() || '#94a3b8';
  const gridColor = styles.getPropertyValue('--panel-border').trim() || 'rgba(255,255,255,0.06)';
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: textColor } } },
    scales: {
      x: { ticks: { color: textColor }, grid: { color: gridColor } },
      y: { ticks: { color: textColor }, grid: { color: gridColor } }
    }
  };
}

function renderDashboardChart(submissions, expenses) {
  const ctx = document.getElementById('finance-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  if (dashboardChartInstance) dashboardChartInstance.destroy();

  const dateMap = {};
  submissions.forEach((sub) => {
    if (!dateMap[sub.date]) dateMap[sub.date] = { rev: 0, exp: 0 };
    dateMap[sub.date].rev += getSignedSubmissionAmount(sub.entryType, sub.amount);
  });
  expenses.forEach((exp) => {
    if (!dateMap[exp.date]) dateMap[exp.date] = { rev: 0, exp: 0 };
    dateMap[exp.date].exp += parseFlexibleNumber(exp.amount) || 0;
  });

  const labels = Object.keys(dateMap).sort();
  const revData = labels.map((d) => dateMap[d].rev);
  const expData = labels.map((d) => dateMap[d].exp);
  const profitData = labels.map((d) => dateMap[d].rev - dateMap[d].exp);

  dashboardChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: state.currentLanguage === 'pt' ? 'Receita Total' : 'Total Revenue',
          data: revData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          tension: 0.3,
          fill: true
        },
        {
          label: state.currentLanguage === 'pt' ? 'Despesas' : 'Expenses',
          data: expData,
          borderColor: '#ef4444',
          borderWidth: 2,
          tension: 0.3
        },
        {
          label: state.currentLanguage === 'pt' ? 'Lucro Líquido' : 'Net Profit',
          data: profitData,
          borderColor: '#06b6d4',
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.3
        }
      ]
    },
    options: getChartThemeOptions()
  });
}

function renderPortfolioChart(submissions, expenses, visibleBusinesses = state.businesses) {
  const ctx = document.getElementById('portfolio-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  if (portfolioChartInstance) portfolioChartInstance.destroy();
  if (!visibleBusinesses || visibleBusinesses.length === 0) return;

  const bizMap = {};
  visibleBusinesses.forEach((b) => {
    bizMap[b.name] = { rev: 0, exp: 0 };
  });

  submissions.forEach((sub) => {
    const storeName = sub.store || 'Store 1';
    if (!bizMap[storeName]) bizMap[storeName] = { rev: 0, exp: 0 };
    bizMap[storeName].rev += getSignedSubmissionAmount(sub.entryType, sub.amount);
  });

  expenses.forEach((exp) => {
    const storeName = exp.store || 'Store 1';
    if (!bizMap[storeName]) bizMap[storeName] = { rev: 0, exp: 0 };
    bizMap[storeName].exp += parseFlexibleNumber(exp.amount) || 0;
  });

  const labels = Object.keys(bizMap);
  portfolioChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: state.currentLanguage === 'pt' ? 'Receita Total' : 'Total Revenue',
          data: labels.map((l) => bizMap[l].rev),
          backgroundColor: '#10b981'
        },
        {
          label: state.currentLanguage === 'pt' ? 'Despesas' : 'Expenses',
          data: labels.map((l) => bizMap[l].exp),
          backgroundColor: '#ef4444'
        },
        {
          label: state.currentLanguage === 'pt' ? 'Lucro Líquido' : 'Net Profit',
          data: labels.map((l) => bizMap[l].rev - bizMap[l].exp),
          backgroundColor: '#06b6d4'
        }
      ]
    },
    options: getChartThemeOptions()
  });
}

function getReceiptMarkup(row) {
  const viewText = t('btn_view_receipt', 'View Receipt');
  if (row.receiptId) {
    return `<button type="button" class="receipt-btn" data-receipt-id="${escapeHtml(row.receiptId)}"><i class="fa-solid fa-image"></i> ${escapeHtml(viewText)}</button>`;
  }
  const legacyUrl = (row.legacyLink || row.link || '').toString();
  if (legacyUrl.startsWith('http')) {
    return `<a href="${escapeHtml(legacyUrl)}" target="_blank" rel="noopener noreferrer" class="receipt-btn"><i class="fa-solid fa-image"></i> ${escapeHtml(viewText)}</a>`;
  }
  return `<span class="receipt-btn-missing"><i class="fa-solid fa-slash"></i> ${escapeHtml(t('txt_no_image'))}</span>`;
}

async function openReceiptModal(receiptId) {
  const modal = document.getElementById('receipt-modal');
  const img = document.getElementById('receipt-modal-img');
  if (!modal || !img) return;
  showLoadingScreen(state.currentLanguage === 'pt' ? 'Carregando comprovante...' : 'Loading receipt...');
  try {
    const dataUrl = await getReceiptDataUrl(receiptId);
    if (!dataUrl) {
      showToast('Receipt image not found.', true);
      return;
    }
    img.src = dataUrl;
    modal.showModal();
  } catch (err) {
    showToast('Error loading receipt: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

export function renderHistoryTables(subsLogs, expLogs) {
  const tbodySubs = document.getElementById('history-tbody');
  document.getElementById('history-count').innerText = subsLogs.length;
  const dupLabel = t('btn_duplicate', 'Duplicate');

  if (subsLogs.length === 0) {
    tbodySubs.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">${escapeHtml(t('txt_no_records'))}</td></tr>`;
  } else {
    tbodySubs.innerHTML = subsLogs
      .map((row) => {
        const safeSub = (row.submitter || '').toString();
        const isPartner = safeSub.includes('Partner') || safeSub.includes('Sócio');
        const badgeClass = isPartner ? 'badge-partner' : 'badge-employee';
        const badgeText = isPartner ? t('txt_partner_badge') : t('txt_employee_badge');
        const isNeg = row.entryType === 'Cash Out' || row.entryType === 'Fee';
        return `
          <tr data-swipe-type="sale" data-store="${escapeHtml(row.store)}" data-entry-type="${escapeHtml(row.entryType)}" data-amount="${escapeHtml(row.amount)}" data-notes="${escapeHtml(row.notes)}">
            <td data-label="Date" style="font-weight:600;">${escapeHtml(row.date)}</td>
            <td data-label="Submitter">${escapeHtml(stripRoleSuffix(safeSub))} <span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span></td>
            <td data-label="Store"><span class="badge">${escapeHtml(row.store)}</span></td>
            <td data-label="Type" style="font-weight:600; color:var(--accent);">${escapeHtml(row.entryType)}</td>
            <td data-label="Amount" style="font-weight:700; color:${isNeg ? 'var(--danger)' : 'var(--text-primary)'};">${isNeg ? '-' : ''}${formatCurrency(Math.abs(row.amount || 0))}</td>
            <td data-label="Receipt">${getReceiptMarkup(row)}</td>
            <td data-label="Notes" style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary);" title="${escapeHtml(row.notes)}">${escapeHtml(row.notes || '-')}</td>
            <td class="td-duplicate-action"><button type="button" class="btn-duplicate"><i class="fa-solid fa-copy"></i> ${escapeHtml(dupLabel)}</button></td>
          </tr>
        `;
      })
      .join('');
  }

  const tbodyExp = document.getElementById('history-expenses-tbody');
  document.getElementById('history-expenses-count').innerText = expLogs.length;

  if (expLogs.length === 0) {
    tbodyExp.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">${escapeHtml(t('txt_no_expenses'))}</td></tr>`;
  } else {
    tbodyExp.innerHTML = expLogs
      .map((row) => {
        const catClass = (row.category || '').toString().toLowerCase().split(',')[0].trim();
        const catName = getCategoryTranslation(row.category);
        const methodLabel = getPaymentMethodTranslation(row.paymentMethod);
        return `
          <tr data-swipe-type="expense" data-store="${escapeHtml(row.store)}" data-category="${escapeHtml(row.category)}" data-amount="${escapeHtml(row.amount)}" data-payment-method="${escapeHtml(row.paymentMethod)}" data-description="${escapeHtml(row.description)}">
            <td data-label="Date" style="font-weight:600;">${escapeHtml(row.date)}</td>
            <td data-label="Paid By">${escapeHtml(stripRoleSuffix(row.submitter))}</td>
            <td data-label="Category"><span class="badge badge-category ${escapeHtml(catClass)}">${escapeHtml(catName)}</span></td>
            <td data-label="Amount" style="font-family:var(--font-display); font-weight:700; color:var(--danger);">${formatCurrency(row.amount)}</td>
            <td data-label="Payment Method"><span style="font-size:0.85rem; color:var(--text-secondary);"><i class="fa-solid fa-credit-card" style="font-size:0.75rem; margin-right:0.35rem;"></i>${escapeHtml(methodLabel)}</span></td>
            <td data-label="Description" style="color:var(--text-secondary);">${escapeHtml(row.description)}</td>
            <td class="td-duplicate-action"><button type="button" class="btn-duplicate"><i class="fa-solid fa-copy"></i> ${escapeHtml(dupLabel)}</button></td>
          </tr>
        `;
      })
      .join('');
  }
}

export function duplicateHistoryEntry(tr, switchTab) {
  if (!tr?.dataset) return;
  const { swipeType, store, entryType, amount, notes, category, paymentMethod, description } = tr.dataset;

  if (swipeType === 'sale') {
    switchTab('submit');
    const storeEl = document.getElementById('store-select');
    if (storeEl && store) {
      storeEl.value = store;
      renderDynamicStreams(store);
    }

    if (entryType === 'Cash In') {
      document.getElementById('cash-in').value = amount;
    } else if (entryType === 'Cash Out') {
      document.getElementById('cash-out').value = amount;
    } else if (entryType === 'Fee') {
      document.getElementById('fees-taxes').value = amount;
    } else {
      const targetInput =
        Array.from(document.querySelectorAll('.dynamic-stream-input')).find(
          (i) => i.dataset.streamName === entryType
        ) || document.querySelector('.dynamic-stream-input');
      if (targetInput) targetInput.value = amount;
    }

    const notesEl = document.getElementById('notes');
    if (notesEl) notesEl.value = notes || '';
    calculateLiveTotal();
    showToast(state.currentLanguage === 'pt' ? 'Entrada duplicada! Revise e envie.' : 'Entry duplicated! Review & submit.');
  } else if (swipeType === 'expense') {
    switchTab('expense');
    const storeEl = document.getElementById('expense-store');
    if (storeEl && store) storeEl.value = store;

    const methodEl = document.getElementById('expense-method');
    if (methodEl && paymentMethod) methodEl.value = paymentMethod;

    const masterCat = document.getElementById('expense-master-category');
    const cats = (category || '').split(',').map((s) => s.trim()).filter(Boolean);
    const linesContainer = document.getElementById('expense-lines-container');
    linesContainer.innerHTML = '';

    if (cats.length === 1 && masterCat && state.globalExpenseCategories.includes(cats[0])) {
      masterCat.value = cats[0];
    } else if (masterCat) {
      masterCat.value = 'Itemized';
    }

    addExpenseLine(cats[0] || '', amount || '', description || '');
    toggleItemizedMode();
    calculateExpenseTotal();
    showToast(state.currentLanguage === 'pt' ? 'Despesa duplicada! Revise e envie.' : 'Expense duplicated! Review & submit.');
  }
}
