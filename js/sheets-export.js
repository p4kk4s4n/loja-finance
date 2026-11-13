// CSV offline export & optional Admin-only Google Identity Services OAuth sync to Google Sheets
import { state } from './state.js';
import { getSignedSubmissionAmount, showLoadingScreen, hideLoadingScreen, showToast, stripRoleSuffix } from './utils.js';

export function exportHistoryCSV() {
  const pt = state.currentLanguage === 'pt';
  const rows = [
    pt
      ? 'Tipo,Data,Usuario,Loja,CategoriaOuFluxo,FormaPagamento,ValorAssinado,NotasOuDescricao'
      : 'Type,Date,Submitter,Store,CategoryOrStream,PaymentMethod,SignedAmount,NotesOrDescription'
  ];

  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  for (const r of state.rawSubmissions) {
    const signed = getSignedSubmissionAmount(r.entryType, r.amount);
    rows.push(
      ['Sales', r.date, stripRoleSuffix(r.submitter), r.store, r.entryType, '', signed, r.notes || '']
        .map(q)
        .join(',')
    );
  }

  for (const e of state.groupedExpenses) {
    rows.push(
      [
        'Expense',
        e.date,
        stripRoleSuffix(e.submitter),
        e.store,
        e.category,
        e.paymentMethod,
        -(Number(e.amount) || 0),
        e.description || ''
      ]
        .map(q)
        .join(',')
    );
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `loja_finance_export_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Loads Google Identity Services lazily only when an Admin clicks "Sync to Google Sheets Now"
function loadGisScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
    document.head.appendChild(script);
  });
}

function getOAuthAccessToken(clientId) {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      callback: (resp) => {
        if (resp.error) reject(new Error(resp.error));
        else resolve(resp.access_token);
      }
    });
    client.requestAccessToken();
  });
}

async function writeSheetRange(spreadsheetId, token, range, values) {
  const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`;
  await fetch(clearUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });

  const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Sheets API error (${res.status})`);
  }
}

export async function syncSnapshotToGoogleSheets() {
  const { spreadsheetId, googleClientId } = state.sheetsConfig || {};
  if (!spreadsheetId || !googleClientId) {
    showToast(
      state.currentLanguage === 'pt'
        ? 'Configure o Spreadsheet ID e Google OAuth Client ID nos Ajustes.'
        : 'Configure Spreadsheet ID and Google OAuth Client ID in Settings first.',
      true
    );
    return;
  }

  try {
    showLoadingScreen(state.currentLanguage === 'pt' ? 'Conectando ao Google Sheets...' : 'Syncing to Google Sheets...');
    await loadGisScript();
    const token = await getOAuthAccessToken(googleClientId);

    const bizRows = [['Name', 'PaymentStreams'], ...state.businesses.map((b) => [b.name, b.streams])];

    const dailyRows = [
      ['Timestamp', 'Date', 'Store', 'Submitter', 'Entry Type', 'Amount (R$)', 'Receipt Link', 'Notes / Expenses'],
      ...state.rawSubmissions.map((r) => [
        r.timestamp || '',
        r.date || '',
        r.store || '',
        r.submitter || '',
        r.entryType || '',
        Number(r.amount) || 0,
        r.legacyLink || (r.receiptId ? `firestore:receipts/${r.receiptId}` : ''),
        r.notes || ''
      ])
    ];

    const expenseRows = [
      ['Date', 'Store', 'Submitter', 'Category', 'Amount (R$)', 'Payment Method', 'Description', 'Receipt Link', 'Timestamp'],
      ...state.rawExpenses.map((e) => [
        e.date || '',
        e.store || '',
        e.submitter || '',
        e.category || '',
        Number(e.amount) || 0,
        e.paymentMethod || '',
        e.description || '',
        e.legacyLink || (e.receiptId ? `firestore:receipts/${e.receiptId}` : ''),
        e.timestamp || ''
      ])
    ];

    await Promise.all([
      writeSheetRange(spreadsheetId, token, 'Businesses!A:B', bizRows),
      writeSheetRange(spreadsheetId, token, 'DailySubmissions!A:H', dailyRows),
      writeSheetRange(spreadsheetId, token, 'Expenses!A:I', expenseRows)
    ]);

    showToast(state.currentLanguage === 'pt' ? 'Planilha Google sincronizada!' : 'Google Sheet synced successfully!');
  } catch (err) {
    showToast('Sheets Sync Failed: ' + err.message, true);
  } finally {
    hideLoadingScreen();
  }
}
