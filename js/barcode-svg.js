// Pure offline vector barcode generator: GS1 In-Store EAN-13 + Code 128B SVG renderer

const L_CODES = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011'
];
const R_CODES = L_CODES.map((bits) =>
  bits.replace(/0/g, 'x').replace(/1/g, '0').replace(/x/g, '1')
);
const G_CODES = R_CODES.map((bits) => bits.split('').reverse().join(''));
const FIRST_DIGIT_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'
];

const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

export function computeEan13CheckDigit(twelveDigits) {
  const s = (twelveDigits ?? '').toString().trim();
  if (!/^\d{12}$/.test(s)) {
    throw new Error(`Expected 12 digits for EAN-13 check digit, got "${s}"`);
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(s[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(code) {
  const s = (code ?? '').toString().trim();
  if (!/^\d{13}$/.test(s)) return false;
  return computeEan13CheckDigit(s.slice(0, 12)) === s[12];
}

function getStorePrefix5(storeName) {
  const clean = (storeName || 'Store 1').toString().trim();
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) % 1000;
  }
  return '20' + String(hash).padStart(3, '0');
}

export function generateInStoreEan13(storeName, existingBarcodes = new Set()) {
  const existing = existingBarcodes instanceof Set ? existingBarcodes : new Set(existingBarcodes || []);
  const prefix5 = getStorePrefix5(storeName);

  let maxSeq = 0;
  for (const raw of existing) {
    const code = (raw ?? '').toString().trim();
    if (code.length === 13 && code.startsWith(prefix5) && /^\d+$/.test(code)) {
      const seq = parseInt(code.slice(5, 12), 10);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  let seq = maxSeq + 1;
  while (true) {
    const seq7 = String(seq % 10000000).padStart(7, '0');
    const base12 = prefix5 + seq7;
    const candidate = base12 + computeEan13CheckDigit(base12);
    if (!existing.has(candidate)) {
      return candidate;
    }
    seq += 1;
  }
}

export function encodeEan13Bits(code13) {
  const s = (code13 ?? '').toString().trim();
  if (!isValidEan13(s)) return '';

  const first = parseInt(s[0], 10);
  const parity = FIRST_DIGIT_PARITY[first];
  let bits = '101';

  for (let i = 1; i <= 6; i++) {
    const digit = parseInt(s[i], 10);
    bits += parity[i - 1] === 'L' ? L_CODES[digit] : G_CODES[digit];
  }

  bits += '01010';

  for (let i = 7; i <= 12; i++) {
    const digit = parseInt(s[i], 10);
    bits += R_CODES[digit];
  }

  bits += '101';
  return bits;
}

export function encodeCode128BBits(text) {
  const normalized = (text ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!normalized) return '';

  const values = [];
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code >= 32 && code <= 126) {
      values.push(code - 32);
    }
  }
  if (values.length === 0) return '';

  const START_B = 104;
  const STOP = 106;
  let checksum = START_B;
  values.forEach((v, idx) => {
    checksum += v * (idx + 1);
  });
  const checkVal = checksum % 103;

  const symbols = [START_B, ...values, checkVal, STOP];
  let bits = '';
  for (const sym of symbols) {
    const pat = CODE128_PATTERNS[sym];
    for (let i = 0; i < pat.length; i++) {
      const width = parseInt(pat[i], 10);
      const isBar = i % 2 === 0;
      bits += (isBar ? '1' : '0').repeat(width);
    }
  }
  return bits;
}

function escapeXml(str) {
  return (str ?? '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderBarcodeSvg(rawCode, { height = 46, barWidth = 1.6, quietModules = 10, showText = true } = {}) {
  const code = (rawCode ?? '').toString().trim();
  if (!code) return '';

  const useEan13 = isValidEan13(code);
  const bits = useEan13 ? encodeEan13Bits(code) : encodeCode128BBits(code);
  if (!bits) return '';

  const qx = quietModules * barWidth;
  const totalWidth = Math.round((bits.length * barWidth + 2 * qx) * 100) / 100;
  const textHeight = showText ? 14 : 0;
  const topPad = 4;
  const bottomPad = 4;
  const guardExtra = useEan13 && showText ? 5 : 0;
  const totalHeight = topPad + height + guardExtra + textHeight + bottomPad;

  const rects = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      const start = i;
      while (i < bits.length && bits[i] === '1') i++;
      const runLen = i - start;
      const isGuard =
        useEan13 &&
        ((start >= 0 && start < 3) || (start >= 45 && start < 50) || (start >= 92 && start < 95));
      const barH = height + (isGuard ? guardExtra : 0);
      const x = Math.round((qx + start * barWidth) * 100) / 100;
      const w = Math.round(runLen * barWidth * 100) / 100;
      rects.push(`<rect x="${x}" y="${topPad}" width="${w}" height="${barH}"/>`);
    } else {
      i++;
    }
  }

  const labelY = topPad + height + guardExtra + 11;
  const textSvg = showText
    ? `<text x="${(totalWidth / 2).toFixed(2)}" y="${labelY}" text-anchor="middle" font-family="'Courier New', monospace" font-size="11" font-weight="700" fill="#000000">${escapeXml(code)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" class="barcode-svg" shape-rendering="crispEdges" role="img" aria-label="${escapeXml(code)}"><rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="#ffffff"/><g fill="#000000">${rects.join('')}</g>${textSvg}</svg>`;
}
