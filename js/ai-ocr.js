// Gemini direct REST OCR & Connection Tester for Expenses & POS Z-Reports
import { state } from './state.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const SUGGESTED_GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash'
];

function getGeminiKey() {
  return (state.aiApiKey || localStorage.getItem('loja_gemini_key') || '').trim();
}

export function getGeminiModel(overrideModel) {
  let stored = '';
  try {
    stored = localStorage.getItem('loja_gemini_model') || '';
  } catch (_) {}
  const raw = (overrideModel ?? state.aiModel ?? stored ?? '').toString().trim();
  const clean = raw.replace(/^models\//i, '').trim();
  return clean || DEFAULT_GEMINI_MODEL;
}

async function callGeminiVision(base64Image, promptText) {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    throw new Error(
      state.currentLanguage === 'pt'
        ? 'Chave da API Gemini não configurada. Adicione em Ajustes -> Integrações.'
        : 'Gemini API Key is not configured. Add it under Settings -> Integrations.'
    );
  }

  let mimeType = 'image/jpeg';
  let base64Data = base64Image;
  if (base64Image.includes(',')) {
    const [header, body] = base64Image.split(',');
    const match = header.match(/:(.*?);/);
    if (match) mimeType = match[1];
    base64Data = body;
  }

  const model = getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: promptText },
            { inline_data: { mime_type: mimeType, data: base64Data } }
          ]
        }
      ],
      generationConfig: { temperature: 0.1 }
    })
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(`Gemini API Error (${model}): ${json.error.message}`);
  }

  const rawText = (json.candidates?.[0]?.content?.parts?.[0]?.text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  return JSON.parse(rawText);
}

export async function listAvailableGeminiModels(apiKey, fetchImpl = fetch) {
  const key = (apiKey || '').trim();
  if (!key) return [];
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const res = await fetchImpl(url, { method: 'GET' });
    if (!res.ok) return [];
    const json = await res.json();
    const ids = (json.models || [])
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => (m.name || '').replace(/^models\//i, '').trim())
      .filter((id) => /^gemini/i.test(id));
    ids.sort((a, b) => {
      const aFlash = /flash/i.test(a) ? 0 : 1;
      const bFlash = /flash/i.test(b) ? 0 : 1;
      if (aFlash !== bFlash) return aFlash - bFlash;
      return b.localeCompare(a);
    });
    return ids.slice(0, 12);
  } catch (_) {
    return [];
  }
}

export async function testGeminiConnection({ apiKey, model, fetchImpl = fetch } = {}) {
  const key = (apiKey !== undefined ? apiKey : getGeminiKey()).trim();
  const requestedModel = getGeminiModel(model);
  if (!key) {
    return {
      ok: false,
      requestedModel,
      status: 0,
      latencyMs: 0,
      error:
        state.currentLanguage === 'pt'
          ? 'Informe a chave da API Gemini antes de testar.'
          : 'Enter a Gemini API Key before testing.'
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(requestedModel)}:generateContent?key=${encodeURIComponent(key)}`;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with OK' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8 }
      })
    });
    const latencyMs = Math.max(1, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
    const json = await res.json().catch(() => ({}));

    if (res.ok && !json?.error) {
      const replyText = (json.candidates?.[0]?.content?.parts?.[0]?.text || 'OK').trim();
      return {
        ok: true,
        requestedModel,
        modelVersion: json.modelVersion || requestedModel,
        replyText,
        latencyMs,
        status: res.status
      };
    }

    const errorMsg = json?.error?.message || `HTTP ${res.status}`;
    const shouldDiscover = res.status === 404 || /not found|not supported|deprecated|invalid/i.test(errorMsg);
    const availableModels = shouldDiscover ? await listAvailableGeminiModels(key, fetchImpl) : [];
    return {
      ok: false,
      requestedModel,
      status: res.status,
      latencyMs,
      error: errorMsg,
      availableModels
    };
  } catch (err) {
    const latencyMs = Math.max(1, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
    return {
      ok: false,
      requestedModel,
      status: 0,
      latencyMs,
      error: err?.message || 'Network error',
      availableModels: []
    };
  }
}

export async function analyzeReceiptWithAI(base64Image) {
  const cats = (state.globalExpenseCategories || ['Supplies', 'Rent', 'Utilities', 'Salaries', 'Other'])
    .map((c) => `'${c}'`)
    .join(', ');
  const prompt = `Analyze this receipt image. Extract each individual line item purchased. Do NOT include taxes, tips, or subtotals as items. For each item, provide a short description, assign an exact category (must be exactly one of: ${cats}), and the numerical price. Return the result strictly as a valid JSON array of objects with keys 'description', 'category', 'amount'. Do not include markdown or backticks.`;
  return callGeminiVision(base64Image, prompt);
}

export async function analyzeZReportWithAI(base64Image) {
  const prompt = "Analyze this Point of Sale (POS) batch settlement receipt (Z-Report). Look for: Total Credit/Debit Card Sales, Total PIX Sales, Total Cash Sales, and explicit Taxes or Processing Fees printed on the slip. Do NOT confuse PIX with normal Debit. Return strictly valid JSON with keys 'card', 'pix', 'cash', 'fee' mapped to numerical values (no currency symbols, 0 if missing). No markdown or backticks.";
  return callGeminiVision(base64Image, prompt);
}
