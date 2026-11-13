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
    visibleBusinesses,
    visiblePartners
  };
}
