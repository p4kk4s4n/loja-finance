// GitHub Releases + version.json + Service Worker auto-update controller
import { state } from './state.js';
import { showToast } from './utils.js';

const AUTO_UPDATE_KEY = 'loja_auto_update';
const INSTALLED_VERSION_FALLBACK = '2.0.1';

let swRegistration = null;
let installedVersion = INSTALLED_VERSION_FALLBACK;
let latestInfo = null;
let updateCheckTimer = null;
let deferredInstallPrompt = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    refreshPwaInstallUI();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    refreshPwaInstallUI();
    showToast(
      state.currentLanguage === 'pt' ? 'Loja Finance instalado no dispositivo!' : 'Loja Finance installed to device!'
    );
  });
}

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
  refreshPwaInstallUI();
  document.getElementById('btn-install-pwa')?.addEventListener('click', triggerPwaInstall);
  document.getElementById('btn-copy-app-link')?.addEventListener('click', copyCanonicalAppLink);
  document.getElementById('btn-reset-pwa-cache')?.addEventListener('click', resetPwaCacheAndReload);

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

export function getCanonicalAppUrl() {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname.replace(/index\.html$/i, '')}`;
}

function isStandaloneApp() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true);
}

export function refreshPwaInstallUI() {
  if (typeof document === 'undefined') return;
  const canonicalUrl = getCanonicalAppUrl();
  const isPt = state.currentLanguage === 'pt';

  const urlEl = document.getElementById('pwa-canonical-url');
  const idEl = document.getElementById('pwa-manifest-id');
  const statusEl = document.getElementById('pwa-install-status');
  const hintEl = document.getElementById('pwa-install-hint');
  const installBtn = document.getElementById('btn-install-pwa');

  if (urlEl) urlEl.innerText = canonicalUrl;
  if (idEl && canonicalUrl) {
    try {
      idEl.innerText = new URL('./', canonicalUrl).href;
    } catch {
      idEl.innerText = canonicalUrl;
    }
  }

  const standalone = isStandaloneApp();
  const ua = navigator.userAgent || '';
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isInApp = /FBAN|FBAV|Instagram|WhatsApp|Line\//i.test(ua);

  if (statusEl) {
    if (standalone) {
      statusEl.innerText = isPt ? 'Instalado (App)' : 'Installed (App)';
    } else if (deferredInstallPrompt) {
      statusEl.innerText = isPt ? 'Pronto para Instalar' : 'Ready to Install';
    } else {
      statusEl.innerText = isPt ? 'Instalação pelo Navegador' : 'Browser Install';
    }
  }

  if (installBtn) {
    installBtn.disabled = standalone;
    const span = installBtn.querySelector('span');
    if (span) {
      span.innerText = standalone
        ? (isPt ? 'Já Instalado Neste Dispositivo' : 'Installed on This Device')
        : (isPt ? 'Instalar no Dispositivo' : 'Install to Device');
    }
  }

  if (hintEl) {
    if (standalone) {
      hintEl.innerText = isPt
        ? 'Executando em modo aplicativo independente (WebAPK / PWA). Se precisar migrar para uma nova compilação, use "Limpar Cache WebAPK".'
        : 'Running in standalone app mode (WebAPK / PWA). If switching from an older build causes conflicts, tap "Reset WebAPK Cache".';
    } else if (isInApp) {
      hintEl.innerText = isPt
        ? 'Você abriu em um navegador interno (ex: WhatsApp). Copie o link abaixo e abra no Google Chrome ou Safari para instalar corretamente.'
        : 'Opened inside an in-app browser. Copy the canonical link below and open it in Chrome or Safari before installing.';
    } else if (deferredInstallPrompt) {
      hintEl.innerText = isPt
        ? 'Prompt nativo pronto! Clique em "Instalar no Dispositivo". Se já houver um atalho antigo no Android causando erro de WebAPK, desinstale o ícone antigo primeiro.'
        : 'Native installer ready! Click "Install to Device". If an older Android shortcut exists with a different WebAPK ID, uninstall the old icon first.';
    } else if (isIos) {
      hintEl.innerText = isPt
        ? 'No iPhone/iPad (Safari): toque no botão Compartilhar e escolha "Adicionar à Tela de Início".'
        : 'On iPhone/iPad (Safari): tap the Share icon and choose "Add to Home Screen".';
    } else {
      hintEl.innerText = isPt
        ? 'Se o prompt automático não abrir: no Chrome use Menu (⋮) → "Instalar aplicativo". Em caso de conflito de WebAPK no Android, remova o atalho antigo, clique em "Limpar Cache WebAPK" e instale pelo link canônico.'
        : 'If the prompt does not appear automatically: open Chrome Menu (⋮) → "Install app". To clear an Android WebAPK ID conflict, uninstall any older shortcut, tap "Reset WebAPK Cache", and install from the canonical link.';
    }
  }
}

export async function triggerPwaInstall() {
  const isPt = state.currentLanguage === 'pt';
  if (isStandaloneApp()) {
    showToast(isPt ? 'O aplicativo já está instalado.' : 'App is already installed.', false, true);
    return;
  }

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      deferredInstallPrompt = null;
      refreshPwaInstallUI();
    }
    return;
  }

  refreshPwaInstallUI();
  const hint = document.getElementById('pwa-install-hint')?.innerText || '';
  showToast(
    hint || (isPt ? 'Use o menu do navegador para instalar o app.' : 'Use your browser menu to install this app.'),
    false,
    true
  );
}

export async function copyCanonicalAppLink() {
  const url = getCanonicalAppUrl();
  const isPt = state.currentLanguage === 'pt';
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ title: 'Loja Finance', url });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }

  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const tmp = document.createElement('textarea');
    tmp.value = url;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
  }
  showToast(isPt ? 'Link canônico copiado!' : 'Canonical link copied!');
}

export async function resetPwaCacheAndReload() {
  const isPt = state.currentLanguage === 'pt';
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    showToast(isPt ? 'Cache WebAPK limpo! Recarregando...' : 'WebAPK cache cleared! Reloading...', false, true);
    setTimeout(() => {
      window.location.href = getCanonicalAppUrl();
    }, 600);
  } catch (err) {
    showToast('Reset failed: ' + err.message, true);
  }
}
