// Pure calculation, formatting, image compression & UI feedback helpers

export function parseFlexibleNumber(val) {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (!val) return 0;
  let str = val.toString().trim();
  const commas = (str.match(/,/g) || []).length;
  const periods = (str.match(/\./g) || []).length;

  if (commas > 0 && periods > 0) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (commas > 0) {
    if (commas > 1) {
      str = str.replace(/,/g, '');
    } else {
      const parts = str.split(',');
      str = parts[1].length === 3 ? str.replace(',', '') : str.replace(',', '.');
    }
  } else if (periods > 0) {
    if (periods > 1) {
      str = str.replace(/\./g, '');
    } else {
      const parts = str.split('.');
      if (parts[1].length === 3) str = str.replace('.', '');
    }
  }

  str = str.replace(/[^\d.-]/g, '');
  return Number.parseFloat(str) || 0;
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount) || 0);
}

export function getSignedSubmissionAmount(entryType, amount) {
  const amt = parseFlexibleNumber(amount) || 0;
  return (entryType === 'Cash Out' || entryType === 'Fee') ? -amt : amt;
}

export function stripRoleSuffix(name) {
  return (name || '')
    .toString()
    .replace(/ \((Partner|Sócio|Employee|Funcionário|Admin|Administrador)\)/g, '')
    .trim();
}

export function formatMemberNameWithRole(name, role) {
  const clean = stripRoleSuffix(name);
  const suffix = role === 'Partner' ? ' (Partner)' : (role === 'Admin' ? ' (Admin)' : ' (Employee)');
  return clean + suffix;
}

export function computePartnerEquityValidation(teamRoster, businesses) {
  const partners = (teamRoster || []).filter((m) => m.role === 'Partner');
  if (partners.length === 0) {
    return { valid: true, noPartners: true, invalidBizName: '', invalidBizTotal: 0 };
  }

  for (const b of businesses || []) {
    let bizTotal = 0;
    for (const m of partners) {
      if (m.equity && m.equity[b.name]) {
        bizTotal += parseFlexibleNumber(m.equity[b.name]);
      }
    }
    const totalPercent = Math.round(bizTotal * 100);
    if (totalPercent !== 100) {
      return { valid: false, noPartners: false, invalidBizName: b.name, invalidBizTotal: totalPercent };
    }
  }

  return { valid: true, noPartners: false, invalidBizName: '', invalidBizTotal: 100 };
}

export function doesMemberMatchPayday(member, dateObj) {
  if (!member || !member.salary || Number(member.salary) <= 0) return false;
  const freq = (member.payFrequency || '').trim().toLowerCase();
  const configuredDay =
    member.payDay !== null && member.payDay !== undefined && member.payDay !== ''
      ? parseInt(member.payDay, 10)
      : null;

  if (freq === 'daily') return true;
  if (freq === 'weekly') {
    const targetWeekDay = configuredDay !== null ? configuredDay : 5;
    return dateObj.getDay() === targetWeekDay;
  }
  if (freq === 'monthly') {
    const targetDate = configuredDay !== null ? configuredDay : 1;
    return dateObj.getDate() === targetDate;
  }
  return false;
}

export function escapeHtml(str) {
  return (str ?? '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_DIM = 1000;
        let { width, height } = img;
        if (width > height && width > MAX_DIM) {
          height *= MAX_DIM / width;
          width = MAX_DIM;
        } else if (height >= width && height > MAX_DIM) {
          width *= MAX_DIM / height;
          height = MAX_DIM;
        }
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export function compressLogoImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read logo file.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid logo image file.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_W = 420;
        const MAX_H = 220;
        let { width, height } = img;
        const scale = Math.min(1, MAX_W / (width || 1), MAX_H / (height || 1));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
        if (keepAlpha) {
          const pngUrl = canvas.toDataURL('image/png');
          if (pngUrl.length <= 220000) {
            resolve(pngUrl);
            return;
          }
          // Flatten onto white before JPEG fallback for overly heavy PNGs
          const flatCanvas = document.createElement('canvas');
          flatCanvas.width = canvas.width;
          flatCanvas.height = canvas.height;
          const flatCtx = flatCanvas.getContext('2d');
          flatCtx.fillStyle = '#ffffff';
          flatCtx.fillRect(0, 0, flatCanvas.width, flatCanvas.height);
          flatCtx.drawImage(canvas, 0, 0);
          resolve(flatCanvas.toDataURL('image/jpeg', 0.85));
          return;
        }
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export function showToast(message, isError = false, isInfo = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : isInfo ? 'info' : 'success'}`;
  const iconClass = isError ? 'fa-triangle-exclamation' : isInfo ? 'fa-circle-info' : 'fa-circle-check';

  toast.innerHTML = `
    <i class="fa-solid ${iconClass} toast-icon"></i>
    <span>${escapeHtml(message)}</span>
    <div class="toast-progress" style="animation-duration: 4s;"></div>
  `;

  container.appendChild(toast);
  void toast.offsetWidth;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

export function showLoadingScreen(text) {
  const elText = document.getElementById('loading-text');
  const elOverlay = document.getElementById('loading-overlay');
  if (elText) elText.innerText = text || 'Processing...';
  if (elOverlay) elOverlay.style.display = 'flex';
}

export function hideLoadingScreen() {
  const elOverlay = document.getElementById('loading-overlay');
  if (elOverlay) elOverlay.style.display = 'none';
}

export function toIsoTimestamp(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val.toDate === 'function') return val.toDate().toISOString();
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

export function groupExpenseDocs(docs) {
  const grouped = {};
  const sortedAsc = [...docs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  for (const row of sortedAsc) {
    const groupKey = row.groupId || toIsoTimestamp(row.timestamp) || `single_${row.id}`;
    const amt = parseFlexibleNumber(row.amount) || 0;
    const category = (row.category || '').toString().trim();
    const desc = (row.description || '').toString().trim();

    if (!grouped[groupKey]) {
      grouped[groupKey] = {
        id: row.id,
        groupId: groupKey,
        date: row.date || '',
        store: (row.store || 'Store 1').toString().trim(),
        submitter: row.submitter || '',
        category,
        amount: amt,
        paymentMethod: row.paymentMethod || '',
        description: desc,
        receiptId: row.receiptId || '',
        legacyLink: row.legacyLink || '',
        timestamp: toIsoTimestamp(row.timestamp)
      };
    } else {
      grouped[groupKey].amount += amt;
      const existingCats = grouped[groupKey].category.split(',').map((s) => s.trim()).filter(Boolean);
      if (category && !existingCats.includes(category)) {
        grouped[groupKey].category = existingCats.concat(category).join(', ');
      }
      if (desc && !grouped[groupKey].description.includes(desc)) {
        grouped[groupKey].description += (grouped[groupKey].description ? ' | ' : '') + desc;
      }
    }
  }

  return Object.values(grouped).sort((a, b) => {
    const dCmp = (b.date || '').localeCompare(a.date || '');
    return dCmp !== 0 ? dCmp : (b.timestamp || '').localeCompare(a.timestamp || '');
  });
}

export function normalizeUserRole(role) {
  const r = (role || '').toString().trim().toLowerCase();
  if (r === 'admin' || r === 'administrador') return 'admin';
  if (r === 'partner' || r === 'sócio' || r === 'socio') return 'partner';
  return 'employee';
}

export function getEffectiveStoreFilter(currentUser, requestedStore = 'All Stores') {
  const assigned = (currentUser?.storeAssignment || '').trim();
  if (assigned && assigned !== 'All Stores') return assigned;
  return requestedStore || 'All Stores';
}

export function getScopedLedgerData({
  rawSubmissions = [],
  groupedExpenses = [],
  tallyDays = [],
  teamRoster = [],
  businesses = [],
  currentUser = null,
  selectedStore = 'All Stores'
}) {
  const roleKind = normalizeUserRole(currentUser?.role);
  const effectiveStore = getEffectiveStoreFilter(currentUser, selectedStore);
  const selfName = stripRoleSuffix(currentUser?.name).toLowerCase();

  const matchesScope = (row) => {
    const rowStore = (row.store || 'Store 1').trim();
    if (effectiveStore !== 'All Stores' && rowStore !== effectiveStore) return false;
    if (roleKind === 'employee') {
      if (!selfName) return false;
      return stripRoleSuffix(row.submitter).toLowerCase() === selfName;
    }
    return true;
  };

  const scopedSubmissions = rawSubmissions.filter(matchesScope);
  const scopedExpenses = groupedExpenses.filter(matchesScope);
  const scopedTallyDays =
    roleKind === 'employee'
      ? []
      : (tallyDays || []).filter((td) => {
          const tdStore = (td.storeId || td.store || '').trim();
          return effectiveStore === 'All Stores' || tdStore === effectiveStore;
        });

  const visibleBusinesses =
    roleKind === 'employee'
      ? []
      : effectiveStore === 'All Stores'
        ? businesses
        : businesses.filter((b) => (b.name || '').trim() === effectiveStore);

  let visiblePartners = [];
  if (roleKind !== 'employee') {
    const allPartners = teamRoster.filter((m) => normalizeUserRole(m.role) === 'partner');
    if (effectiveStore === 'All Stores') {
      visiblePartners = allPartners.map((p) => ({ ...p, equity: { ...(p.equity || {}) } }));
    } else {
      visiblePartners = allPartners
        .filter((p) => {
          const hasEquity = parseFlexibleNumber(p.equity?.[effectiveStore]) > 0;
          const assignedHere = (p.storeAssignment || '').trim() === effectiveStore;
          return hasEquity || assignedHere;
        })
        .map((p) => {
          const pct = parseFlexibleNumber(p.equity?.[effectiveStore]) || 0;
          return {
            ...p,
            equity: pct > 0 ? { [effectiveStore]: pct } : {}
          };
        });
    }
  }

  return {
    roleKind,
    effectiveStore,
    scopedSubmissions,
    scopedExpenses,
    scopedTallyDays,
    visibleBusinesses,
    visiblePartners
  };
}

export function round2(val) {
  return Math.round((Number(val) || 0) * 100) / 100;
}

export function makeTallyDayId(storeName, dateIso) {
  const safeStore = encodeURIComponent((storeName || 'Store 1').toString().trim());
  const safeDate = (dateIso || '').toString().trim();
  return `${safeStore}__${safeDate}`;
}

export function normalizeBarcode(raw) {
  return (raw ?? '')
    .toString()
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();
}

export function resolveScanCode(rawCode, menuItems = [], storeId = '') {
  const code = normalizeBarcode(rawCode);
  if (!code) return null;

  const targetStore = (storeId || '').toString().trim();
  const candidates = (menuItems || []).filter((item) => {
    if (!item || item.active === false) return false;
    if (targetStore && (item.storeId || '').toString().trim() !== targetStore) return false;
    return Boolean(normalizeBarcode(item.barcode));
  });

  const exact = candidates.find((item) => normalizeBarcode(item.barcode) === code);
  if (exact) return exact;

  // Handle UPC-A (12 digits) <-> EAN-13 (leading '0' + 12 digits) scanner variance
  if (/^\d+$/.test(code)) {
    const altCodes = new Set();
    if (code.length === 12) altCodes.add('0' + code);
    if (code.length === 13 && code.startsWith('0')) altCodes.add(code.slice(1));
    if (altCodes.size > 0) {
      const paddedMatch = candidates.find((item) => altCodes.has(normalizeBarcode(item.barcode)));
      if (paddedMatch) return paddedMatch;
    }
  }

  return null;
}

export function getEffectiveDaySales(manualTotal, tallyTotal) {
  const manual = round2(Number(manualTotal) || 0);
  const tally = round2(Math.max(0, Number(tallyTotal) || 0));

  if (tally <= 0) {
    return {
      reported: manual,
      tally: 0,
      manual,
      unitemized: 0,
      source: 'manual'
    };
  }

  const reported = round2(Math.max(manual, tally));
  const unitemized = round2(Math.max(0, manual - tally));
  const source = manual <= 0 ? 'tally' : manual > tally ? 'mixed' : 'tally';
  return {
    reported,
    tally,
    manual,
    unitemized,
    source
  };
}

export function computeTallyLinesSummary(lines = []) {
  let total = 0;
  let itemCount = 0;
  let cardPixTotal = 0;
  const byItemMap = new Map();

  for (const line of lines || []) {
    if (!line || line.voided === true) continue;
    const price = Number(line.price) || 0;
    const qty = Number(line.qty) || 0;
    if (qty <= 0) continue;
    const subtotal = round2(price * qty);
    total += subtotal;
    itemCount += qty;

    if (line.payment === 'Card' || line.payment === 'PIX') {
      cardPixTotal += subtotal;
    }

    const key = line.itemId || line.name || 'item';
    const existing = byItemMap.get(key);
    if (existing) {
      existing.qty += qty;
      existing.subtotal = round2(existing.subtotal + subtotal);
    } else {
      byItemMap.set(key, {
        itemId: line.itemId || '',
        name: line.name || 'Item',
        category: line.category || '',
        price,
        qty,
        subtotal
      });
    }
  }

  const byItem = Array.from(byItemMap.values()).sort((a, b) => b.subtotal - a.subtotal);
  return {
    total: round2(total),
    itemCount,
    cardPixTotal: round2(cardPixTotal),
    byItem
  };
}

export function reconcileLedgerRevenue(submissions = [], tallyDays = []) {
  const dayBuckets = new Map();

  const getBucket = (store, date) => {
    const st = (store || 'Store 1').toString().trim();
    const dt = (date || '').toString().trim();
    const key = `${st}||${dt}`;
    let b = dayBuckets.get(key);
    if (!b) {
      b = { store: st, date: dt, manualNet: 0, manualCardPix: 0, tallyTotal: 0, tallyCardPix: 0 };
      dayBuckets.set(key, b);
    }
    return b;
  };

  for (const sub of submissions || []) {
    if (!sub || !sub.date) continue;
    const bucket = getBucket(sub.store, sub.date);
    const amt = parseFlexibleNumber(sub.amount) || 0;
    const signed = getSignedSubmissionAmount(sub.entryType, amt);
    bucket.manualNet += signed;
    if (!['Cash In', 'Cash Out', 'Fee'].includes(sub.entryType)) {
      bucket.manualCardPix += amt;
    }
  }

  for (const td of tallyDays || []) {
    if (!td || !td.date) continue;
    const tTotal = Number(td.total) || 0;
    if (tTotal <= 0) continue;
    const bucket = getBucket(td.storeId || td.store, td.date);
    bucket.tallyTotal += tTotal;
    bucket.tallyCardPix += Number(td.cardPixTotal) || 0;
  }

  let totalRevenue = 0;
  let cardTotal = 0;
  const bizRevenue = {};
  const dateRevenue = {};
  const dailyBreakdown = [];

  for (const b of dayBuckets.values()) {
    const eff = getEffectiveDaySales(b.manualNet, b.tallyTotal);
    totalRevenue += eff.reported;
    cardTotal += eff.tally > 0 ? Math.max(b.manualCardPix, b.tallyCardPix) : b.manualCardPix;
    bizRevenue[b.store] = round2((bizRevenue[b.store] || 0) + eff.reported);
    dateRevenue[b.date] = round2((dateRevenue[b.date] || 0) + eff.reported);
    dailyBreakdown.push({
      date: b.date,
      store: b.store,
      tally: eff.tally,
      manual: eff.manual,
      unitemized: eff.unitemized,
      reported: eff.reported,
      source: eff.source
    });
  }

  dailyBreakdown.sort((a, b) => {
    const dCmp = (b.date || '').localeCompare(a.date || '');
    return dCmp !== 0 ? dCmp : (a.store || '').localeCompare(b.store || '');
  });

  return {
    totalRevenue: round2(totalRevenue),
    cardTotal: round2(cardTotal),
    bizRevenue,
    dateRevenue,
    dailyBreakdown
  };
}
