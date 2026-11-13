// Gemini 1.5 Flash direct REST OCR for Expenses & POS Z-Reports
import { state } from './state.js';

function getGeminiKey() {
  return (state.aiApiKey || localStorage.getItem('loja_gemini_key') || '').trim();
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
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
    throw new Error('Gemini API Error: ' + json.error.message);
  }

  const rawText = (json.candidates?.[0]?.content?.parts?.[0]?.text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  return JSON.parse(rawText);
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
