// Daily Sales Form, Dynamic Payment Streams & POS Z-Report AI Scanner
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
import { t } from './i18n.js';
import { analyzeZReportWithAI } from './ai-ocr.js';
import { saveSubmissionToDb } from './db.js';

export function bindSalesEvents(onSavedSwitchToDashboard) {
  const storeSelect = document.getElementById('store-select');
  const streamsContainer = document.getElementById('dynamic-streams-container');
  const form = document.getElementById('finance-form');
  const dailyFile = document.getElementById('daily-receipt-upload');
  const scanBtn = document.getElementById('btn-scan-daily-ai');

  storeSelect?.addEventListener('change', (e) => renderDynamicStreams(e.target.value));

  ['cash-in', 'cash-out', 'fees-taxes'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', calculateLiveTotal);
  });

  streamsContainer?.addEventListener('input', (e) => {
    if (e.target.classList.contains('dynamic-stream-input')) calculateLiveTotal();
  });

  streamsContainer?.addEventListener('change', async (e) => {
    const input = e.target;
    if (input.type !== 'file' || !input.files?.[0]) return;
    const safeId = input.dataset.safeId;
    if (!safeId) return;

    showLoadingScreen(state.currentLanguage === 'pt' ? 'Compactando foto...' : 'Compressing photo...');
    try {
      const compressed = await compressImage(input.files[0]);
      state.uploadedImages[safeId] = {
        base64: compressed,
        mimeType: 'image/jpeg',
        name: `${safeId}_receipt_${Date.now()}.jpg`
      };
      document.getElementById(`stream-preview-img-${safeId}`).src = compressed;
      document.getElementById(`stream-placeholder-${safeId}`).style.display = 'none';
      document.getElementById(`stream-preview-wrapper-${safeId}`).style.display = 'flex';
      document.getElementById(`stream-box-${safeId}`).classList.add('has-image');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      hideLoadingScreen();
    }
  });

  streamsContainer?.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-image-btn');
    if (btn?.dataset.safeId) {
      e.stopPropagation();
      clearDynamicImage(btn.dataset.safeId);
    }
  });

  dailyFile?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    document.getElementById('lbl-upload-daily').innerText = file.name;
    document.getElementById('btn-scan-daily-ai').style.display = 'inline-flex';
    state.currentDailyReceiptBase64 = await compressImage(file);
  });

  scanBtn?.addEventListener('click', scanDailyReceiptAI);

  form?.addEventListener('submit', (e) => handleFormSubmit(e, onSavedSwitchToDashboard));
}

export function renderDynamicStreams(storeName) {
  const container = document.getElementById('dynamic-streams-container');
  if (!container) return;

  const biz = state.businesses.find((b) => b.name === storeName) || state.businesses[0];
  if (!biz || !biz.streams) {
    container.innerHTML = '';
    calculateLiveTotal();
    return;
  }

  const streams = biz.streams
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  state.uploadedImages = {};
  container.innerHTML = streams
    .map((stream) => {
      const safeId = stream.replace(/[^a-zA-Z0-9]/g, '');
      state.uploadedImages[safeId] = null;
      return `
        <div class="form-group">
          <label>${escapeHtml(stream)} - Total Sales (R$)</label>
          <input type="text" inputmode="decimal" class="dynamic-stream-input" placeholder="0.00" data-stream-name="${escapeHtml(stream)}">
        </div>
        <div class="form-group">
          <label>${escapeHtml(stream)} Receipt Photo</label>
          <div class="photo-upload-container" id="stream-box-${safeId}">
            <input type="file" id="stream-file-${safeId}" data-safe-id="${safeId}" accept="image/*" capture="environment">
            <div class="upload-placeholder" id="stream-placeholder-${safeId}">
              <i class="fa-solid fa-camera upload-icon"></i>
              <div class="upload-text">Tap to Take Photo or Upload</div>
            </div>
            <div class="image-preview-wrapper" id="stream-preview-wrapper-${safeId}">
              <img id="stream-preview-img-${safeId}" class="image-preview" src="#" alt="${escapeHtml(stream)} receipt">
              <button type="button" class="remove-image-btn" data-safe-id="${safeId}">Remove Image</button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  calculateLiveTotal();
}

export function clearDynamicImage(safeId) {
  state.uploadedImages[safeId] = null;
  const fileEl = document.getElementById(`stream-file-${safeId}`);
  const imgEl = document.getElementById(`stream-preview-img-${safeId}`);
  const phEl = document.getElementById(`stream-placeholder-${safeId}`);
  const wrapEl = document.getElementById(`stream-preview-wrapper-${safeId}`);
  const boxEl = document.getElementById(`stream-box-${safeId}`);
  if (fileEl) fileEl.value = '';
  if (imgEl) imgEl.src = '#';
  if (phEl) phEl.style.display = 'flex';
  if (wrapEl) wrapEl.style.display = 'none';
  if (boxEl) boxEl.classList.remove('has-image');
}

export function calculateLiveTotal() {
  let total = 0;
  document.querySelectorAll('.dynamic-stream-input').forEach((input) => {
    total += parseFlexibleNumber(input.value) || 0;
  });
  const cashIn = parseFlexibleNumber(document.getElementById('cash-in')?.value) || 0;
  const cashOut = parseFlexibleNumber(document.getElementById('cash-out')?.value) || 0;
  total += cashIn - cashOut;

  const liveEl = document.getElementById('live-total');
  if (liveEl) liveEl.innerText = formatCurrency(total);
}

async function scanDailyReceiptAI() {
  if (!state.currentDailyReceiptBase64) return;
  showLoadingScreen(state.currentLanguage === 'pt' ? 'Analisando Z-Report com IA...' : 'Scanning Z-Report with AI...');
  try {
    const data = await analyzeZReportWithAI(state.currentDailyReceiptBase64);
    const cardInput =
      document.querySelector('.dynamic-stream-input[data-stream-name*="Machine 1 Card"]') ||
      document.querySelector('.dynamic-stream-input[data-stream-name*="Card"]') ||
      document.querySelector('.dynamic-stream-input');
    if (cardInput && data.card) cardInput.value = data.card;

    const pixInput =
      document.querySelector('.dynamic-stream-input[data-stream-name*="Machine 1 PIX"]') ||
      document.querySelector('.dynamic-stream-input[data-stream-name*="PIX"]');
    if (pixInput && data.pix) pixInput.value = data.pix;

    if (data.cash) document.getElementById('cash-in').value = data.cash;
    if (data.fee) document.getElementById('fees-taxes').value = data.fee;

    calculateLiveTotal();
    showToast(state.currentLanguage === 'pt' ? 'Z-Report lido com sucesso!' : 'Z-Report parsed successfully!');
  } catch (err) {
    showToast('AI Scan Error: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

async function handleFormSubmit(e, onSaved) {
  e.preventDefault();
  const submitter = state.currentUser?.name;
  const store = document.getElementById('store-select').value;
  const date = document.getElementById('entry-date').value;

  if (!submitter || !date) {
    showToast(
      state.currentLanguage === 'pt' ? 'Selecione o responsável e a data.' : 'Please select a submitter and date.',
      true
    );
    return;
  }

  const streams = [];
  document.querySelectorAll('.dynamic-stream-input').forEach((input) => {
    const streamName = input.getAttribute('data-stream-name');
    const safeId = streamName.replace(/[^a-zA-Z0-9]/g, '');
    const amt = parseFlexibleNumber(input.value) || 0;
    if (amt > 0 || state.uploadedImages[safeId]) {
      streams.push({ name: streamName, amount: amt, photo: state.uploadedImages[safeId] || null });
    }
  });

  const cin = parseFlexibleNumber(document.getElementById('cash-in').value) || 0;
  if (cin > 0) streams.push({ name: 'Cash In', amount: cin, photo: null });
  const cout = parseFlexibleNumber(document.getElementById('cash-out').value) || 0;
  if (cout > 0) streams.push({ name: 'Cash Out', amount: cout, photo: null });
  const fees = parseFlexibleNumber(document.getElementById('fees-taxes').value) || 0;
  if (fees > 0) streams.push({ name: 'Fee', amount: fees, photo: null });

  const notes = document.getElementById('notes').value;
  if (streams.length === 0) {
    showToast(
      state.currentLanguage === 'pt'
        ? 'Insira os valores de vendas ou dinheiro.'
        : 'Please input sales totals or cash before submitting.',
      true
    );
    return;
  }

  showLoadingScreen(
    state.currentLanguage === 'pt' ? 'Salvando fechamento na nuvem...' : 'Saving daily submission to Firebase...'
  );
  try {
    await saveSubmissionToDb({ date, submitter, store, streams, notes });
    showToast(t('toast_success'));
    resetSubmitForm();
    onSaved?.();
  } catch (err) {
    showToast('Error saving submission: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}

export function resetSubmitForm() {
  document.getElementById('finance-form')?.reset();
  Object.keys(state.uploadedImages).forEach((k) => {
    if (state.uploadedImages[k]) clearDynamicImage(k);
  });
  state.uploadedImages = {};
  state.currentDailyReceiptBase64 = null;
  const lbl = document.getElementById('lbl-upload-daily');
  if (lbl) lbl.innerText = 'Upload Z-Report';
  const btn = document.getElementById('btn-scan-daily-ai');
  if (btn) btn.style.display = 'none';
  const entryDate = document.getElementById('entry-date');
  if (entryDate) entryDate.value = getTodayISO();
  if (state.currentUser?.storeAssignment && state.currentUser.storeAssignment !== 'All Stores') {
    document.getElementById('store-select').value = state.currentUser.storeAssignment;
  }
  calculateLiveTotal();
}
