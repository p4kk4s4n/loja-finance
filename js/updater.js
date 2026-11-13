// GitHub Releases + version.json + Service Worker auto-update controller
import { state } from './state.js';
import { showToast } from './utils.js';

const AUTO_UPDATE_KEY = 'loja_auto_update';
const INSTALLED_VERSION_FALLBACK = '2.0.0';

let swRegistration = null;
let installedVersion = INSTALLED_VERSION_FALLBACK;
let latestInfo = null;
let updateCheckTimer = null;

export function parseSemver(ver) {
  const clean = String(ver || '0.0.0').trim().replace(/^v\.?/i, '').split('-')[0];
  const parts = clean.split('.').map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function isNewerVersion(candidate, current) {
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

export function detectGithubRepoFromUrl(hostname, pathname) {
  const host = (hostname || '').toLowerCase();
  if (!host.endsWith('.github.io')) return '';
  const owner = host.split('.')[0];
  const seg = (pathname || '/').split('/').filter(Boolean)[0];
  return seg ? `${owner}/${seg}` : `${owner}/${owner}.github.io`;
}

export function isAutoUpdateEnabled() {
  const val = localStorage.getItem(AUTO_UPDATE_KEY);
  return val === null ? true : val === 'true';
}

export function setAutoUpdateEnabled(enabled) {
  localStorage.setItem(AUTO_UPDATE_KEY, String(Boolean(enabled)));
}

function hasUnsavedFormInput() {
  const inputs = document.querySelectorAll(
    '#tab-submit.active .dynamic-stream-input, #tab-submit.active #cash-in, #tab-submit.active #cash-out, #tab-submit.active #notes, #tab-expense.active .exp-line-amt, #tab-expense.active .exp-line-desc'
  );
  return Array.from(inputs).some((el) => el.value && el.value.trim() !== '');
}

export async function initUpdater() {
  // Bind UI controls in Settings
  const autoToggle = document.getElementById('pref-auto-update');
  if (autoToggle) {
    autoToggle.checked = isAutoUpdateEnabled();
    autoToggle.addEventListener('change', (e) => {
      setAutoUpdateEnabled(e.target.checked);
      showToast(
        state.currentLanguage === 'pt' ? 'Preferência de atualização salva!' : 'Update preference saved!'
      );
    });
  }

  try {
    const localRes = await fetch('./version.json');
    if (localRes.ok) {
      const localJson = await localRes.json();
      installedVersion = localJson.version || INSTALLED_VERSION_FALLBACK;
      if (localJson.githubRepo) {
        localStorage.setItem('loja_detected_repo', localJson.githubRepo);
      }
    }
  } catch (_) {}

  updateVersionLabels();

  if ('serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('./sw.js');
      swRegistration.addEventListener('updatefound', () => {
        const newWorker = swRegistration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateAvailable(latestInfo || { version: 'new', source: 'sw' });
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    } catch (err) {
      console.warn('Service Worker registration skipped:', err.message);
    }
  }

  // Initial silent check + background 30-minute polling
  checkForUpdates(true);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateCheckTimer = setInterval(() => {
    if (document.visibilityState === 'visible') checkForUpdates(true);
  }, 30 * 60 * 1000);
}

export async function checkForUpdates(silent = false) {
  const statusEl = document.getElementById('update-status-text');
  if (statusEl && !silent) {
    statusEl.innerText =
      state.currentLanguage === 'pt' ? 'Verificando no GitHub...' : 'Checking GitHub...';
  }

  try {
    // 1. Always check fresh origin version.json (bypassing HTTP cache)
    const originRes = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    let candidate = originRes.ok ? await originRes.json() : null;

    // 2. Also query GitHub Releases API if repo slug is known
    const repoSlug =
      candidate?.githubRepo ||
      localStorage.getItem('loja_detected_repo') ||
      detectGithubRepoFromUrl(window.location.hostname, window.location.pathname);

    if (repoSlug) {
      try {
        const ghRes = await fetch(`https://api.github.com/repos/${repoSlug}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json' }
        });
        if (ghRes.ok) {
          const release = await ghRes.json();
          const tagVer = (release.tag_name || '').replace(/^v\.?/i, '');
          if (tagVer && (!candidate || isNewerVersion(tagVer, candidate.version))) {
            candidate = {
              version: tagVer,
              releasedAt: release.published_at,
              notes: release.name || release.body || '',
              url: release.html_url
            };
          }
        }
      } catch (_) {}
    }

    latestInfo = candidate || { version: installedVersion, notes: '' };
    updateVersionLabels();

    const newer = isNewerVersion(latestInfo.version, installedVersion);
    if (newer || (swRegistration && swRegistration.waiting)) {
      await swRegistration?.update().catch(() => {});
      onUpdateAvailable(latestInfo);
    } else if (!silent) {
      showToast(
        state.currentLanguage === 'pt'
          ? `Você já está na versão mais recente (v${installedVersion}).`
          : `You are on the latest version (v${installedVersion}).`,
        false,
        true
      );
    }
  } catch (err) {
    if (!silent) {
      showToast('Update check failed: ' + err.message, true);
    }
  }
}

function onUpdateAvailable(info) {
  const banner = document.getElementById('update-banner');
  const bannerText = document.getElementById('update-banner-text');
  const installBtn = document.getElementById('btn-install-update');
  const verLabel = info?.version ? `v${info.version.replace(/^v\.?/i, '')}` : '';

  if (installBtn) installBtn.style.display = 'inline-flex';
  if (banner && bannerText) {
    bannerText.innerText =
      state.currentLanguage === 'pt'
        ? `Nova versão disponível (${verLabel}). Clique para atualizar agora.`
        : `New version available (${verLabel}). Click to update now.`;
    banner.classList.add('visible');
  }

  if (isAutoUpdateEnabled() && !hasUnsavedFormInput() && info?.version !== installedVersion) {
    showToast(
      state.currentLanguage === 'pt'
        ? `Atualizando automaticamente para ${verLabel}...`
        : `Auto-updating to ${verLabel}...`,
      false,
      true
    );
    setTimeout(() => applyAppUpdate(), 1200);
  }
}

export async function applyAppUpdate() {
  if (swRegistration?.waiting) {
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return;
  }

  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('loja-finance-')).map((k) => caches.delete(k)));
  }
  await swRegistration?.update().catch(() => {});
  window.location.reload();
}

function updateVersionLabels() {
  const headerPill = document.getElementById('header-version-pill');
  const curEl = document.getElementById('upd-current-ver');
  const latestEl = document.getElementById('upd-latest-ver');
  const statusEl = document.getElementById('update-status-text');

  if (headerPill) headerPill.innerText = `v${installedVersion}`;
  if (curEl) curEl.innerText = `v${installedVersion}`;
  if (latestEl && latestInfo?.version) latestEl.innerText = `v${latestInfo.version}`;

  if (statusEl && latestInfo?.version) {
    const hasNew = isNewerVersion(latestInfo.version, installedVersion);
    statusEl.innerText = hasNew
      ? state.currentLanguage === 'pt'
        ? `Atualização disponível: v${latestInfo.version}`
        : `Update available: v${latestInfo.version}`
      : state.currentLanguage === 'pt'
        ? 'Aplicativo atualizado'
        : 'Up to date';
  }
}
