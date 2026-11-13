// Operational Expenses Form, Master Category Toggle, Flex Rows & Receipt OCR
import { state } from './state.js';
import {
  compressImage,
  escapeHtml,
  formatCurrency,
  getTodayISO,
  hideLoadingScreen,
  parseFlexibleNumber,
  showLoadingScreen,
  showToast
} from './utils.js';
import { getCategoryTranslation, t } from './i18n.js';
import { analyzeReceiptWithAI } from './ai-ocr.js';
import { saveExpenseToDb } from './db.js';

export function bindExpenseEvents(onSavedSwitchToDashboard) {
  const masterCat = document.getElementById('expense-master-category');
  const addRowBtn = document.getElementById('btn-add-expense-row');
  const linesContainer = document.getElementById('expense-lines-container');
  const receiptInput = document.getElementById('expense-receipt-upload');
  const scanBtn = document.getElementById('btn-scan-ai');
  const form = document.getElementById('expense-form');

  masterCat?.addEventListener('change', toggleItemizedMode);
  addRowBtn?.addEventListener('click', () => addExpenseLine());

  linesContainer?.addEventListener('input', (e) => {
    if (e.target.classList.contains('exp-line-amt')) calculateExpenseTotal();
  });

  linesContainer?.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.exp-line-del');
    if (delBtn) {
      delBtn.closest('.expense-line')?.remove();
      calculateExpenseTotal();
    }
  });

  receiptInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    document.getElementById('lbl-upload-receipt').innerText = file.name;
    document.getElementById('btn-scan-ai').style.display = 'inline-flex';
    showLoadingScreen(state.currentLanguage === 'pt' ? 'Compactando comprovante...' : 'Compressing receipt...');
    try {
      state.currentReceiptBase64 = await compressImage(file);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      hideLoadingScreen();
    }
  });

  scanBtn?.addEventListener('click', scanReceiptAI);
  form?.addEventListener('submit', (e) => handleExpenseSubmit(e, onSavedSwitchToDashboard));
}

export function populateMasterCategoryDropdown() {
  const masterSelect = document.getElementById('expense-master-category');
  if (!masterSelect) return;

  const currentVal = masterSelect.value;
  const cats = state.globalExpenseCategories;
  const itemizedLabel = t('exp_cat_itemized', 'Itemized (Multiple Categories)');

  let optionsHTML = `<option value="Itemized">${escapeHtml(itemizedLabel)}</option>`;
  for (const cat of cats) {
    optionsHTML += `<option value="${escapeHtml(cat)}">${escapeHtml(getCategoryTranslation(cat))}</option>`;
  }
  masterSelect.innerHTML = optionsHTML;
  masterSelect.value = currentVal && (currentVal === 'Itemized' || cats.includes(currentVal)) ? currentVal : 'Itemized';
  toggleItemizedMode();
}

export function toggleItemizedMode() {
  const masterVal = document.getElementById('expense-master-category')?.value || 'Itemized';
  const isItemized = masterVal === 'Itemized';
  document.querySelectorAll('.exp-line-cat').forEach((select) => {
    if (isItemized) {
      select.style.display = 'inline-block';
      select.setAttribute('required', 'true');
    } else {
      select.style.display = 'none';
      select.removeAttribute('required');
      select.value = masterVal;
    }
  });
}

export function renderExpenseLines() {
  const container = document.getElementById('expense-lines-container');
  if (container && container.children.length === 0) addExpenseLine();
  calculateExpenseTotal();
}

export function addExpenseLine(category = '', amount = '', description = '') {
  const container = document.getElementById('expense-lines-container');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'expense-line';
  const cats = state.globalExpenseCategories;
  const placeholderText = t('exp_category_placeholder', 'Category');

  let catOptions = `<option value="" disabled ${!category ? 'selected' : ''}>${escapeHtml(placeholderText)}</option>`;
  for (const cat of cats) {
    const selected = category === cat ? 'selected' : '';
    catOptions += `<option value="${escapeHtml(cat)}" ${selected}>${escapeHtml(getCategoryTranslation(cat))}</option>`;
  }

  div.innerHTML = `
    <select class="exp-line-cat" required>${catOptions}</select>
    <input type="text" inputmode="decimal" class="exp-line-amt" placeholder="R$ 0.00" value="${escapeHtml(amount)}" required>
    <input type="text" class="exp-line-desc" placeholder="Description..." value="${escapeHtml(description)}" required>
    <button type="button" class="exp-line-del" title="Remove row"><i class="fa-solid fa-trash"></i></button>
  `;

  container.appendChild(div);
  toggleItemizedMode();
}

export function calculateExpenseTotal() {
  let tot = 0;
  document.querySelectorAll('.exp-line-amt').forEach((a) => {
    tot += parseFlexibleNumber(a.value) || 0;
  });
  const el = document.getElementById('expense-total-calc');
  if (el) el.innerText = formatCurrency(tot);
}

async function scanReceiptAI() {
  if (!state.currentReceiptBase64) return;
  showLoadingScreen(state.currentLanguage === 'pt' ? 'Lendo nota fiscal com IA...' : 'Scanning receipt with AI...');
  try {
    const items = await analyzeReceiptWithAI(state.currentReceiptBase64);
    const container = document.getElementById('expense-lines-container');
    container.innerHTML = '';
    if (Array.isArray(items) && items.length > 0) {
      document.getElementById('expense-master-category').value = 'Itemized';
      items.forEach((item) => addExpenseLine(item.category, item.amount, item.description));
      calculateExpenseTotal();
      showToast(state.currentLanguage === 'pt' ? 'Nota fiscal lida!' : 'Receipt parsed successfully!');
    } else {
      addExpenseLine();
      showToast('No items detected in receipt.', true);
    }
  } catch (err) {
    showToast('AI Scan Error: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

async function handleExpenseSubmit(e, onSaved) {
  e.preventDefault();
  const submitter = state.currentUser?.name;
  const store = document.getElementById('expense-store').value;
  const date = document.getElementById('expense-date').value;
  const method = document.getElementById('expense-method').value;
  const masterCategory = document.getElementById('expense-master-category').value;
  const isItemized = masterCategory === 'Itemized';

  const rows = document.getElementById('expense-lines-container').children;
  const items = [];
  for (const row of rows) {
    const cat = isItemized ? row.querySelector('.exp-line-cat').value : masterCategory;
    const amt = parseFlexibleNumber(row.querySelector('.exp-line-amt').value) || 0;
    const desc = row.querySelector('.exp-line-desc').value.trim();
    if (!cat || amt <= 0 || !desc) {
      showToast(
        state.currentLanguage === 'pt' ? 'Preencha todos os itens da despesa.' : 'Please complete all line items.',
        true
      );
      return;
    }
    items.push({ category: cat, amount: amt, description: desc });
  }

  if (!items.length || !submitter || !date || !method) {
    showToast(
      state.currentLanguage === 'pt' ? 'Preencha todos os campos obrigatórios.' : 'Please fill all required fields.',
      true
    );
    return;
  }

  showLoadingScreen(state.currentLanguage === 'pt' ? 'Registrando despesa...' : 'Logging business expense...');
  try {
    await saveExpenseToDb({
      date,
      submitter,
      store,
      paymentMethod: method,
      items,
      receiptPhoto: state.currentReceiptBase64 ? { base64: state.currentReceiptBase64 } : null
    });
    showToast(t('toast_exp_success'));

    document.getElementById('expense-form').reset();
    document.getElementById('expense-lines-container').innerHTML = '';
    addExpenseLine();
    calculateExpenseTotal();
    state.currentReceiptBase64 = null;
    document.getElementById('lbl-upload-receipt').innerText = 'Upload Receipt';
    document.getElementById('btn-scan-ai').style.display = 'none';
    document.getElementById('expense-date').value = getTodayISO();
    if (state.currentUser?.storeAssignment && state.currentUser.storeAssignment !== 'All Stores') {
      document.getElementById('expense-store').value = state.currentUser.storeAssignment;
    }
    onSaved?.();
  } catch (err) {
    showToast('Error saving expense: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}
