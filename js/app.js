// Main ES Module Entry Point: Routing, Session Lifecycle, Real-Time Wiring & Mobile Gestures
import { state } from './state.js';
import { getTodayISO, normalizeUserRole, stripRoleSuffix } from './utils.js';
import { translatePageLayout } from './i18n.js';
import {
  attemptLogin,
  handleBootstrapAdminSubmit,
  handleLocalFirebaseConfigSave,
  initializeAuthModal,
  logout,
  setOnLoginSuccess
} from './auth.js';
import { subscribeRealtimeData } from './db.js';
import { initUpdater, refreshPwaInstallUI } from './updater.js';
import { bindSalesEvents } from './ui-sales.js';
import { bindExpenseEvents, renderExpenseLines, populateMasterCategoryDropdown } from './ui-expenses.js';
import { bindDashboardEvents, renderDashboard, showSkeletons } from './ui-dashboard.js';
import {
  bindSettingsEvents,
  loadPreferences,
  populateStoreDropdowns,
  renderIntegrationInputs,
  renderSettingsBusinesses,
  renderSettingsCategories,
  renderSettingsRoster,
  syncRosterFromLive,
  updateDateBadgeSubtitle
} from './ui-settings.js';

function isNavTabVisible(btn) {
  return Boolean(btn && btn.style.display !== 'none' && (!btn.isConnected || window.getComputedStyle(btn).display !== 'none'));
}

export function switchTab(tabName) {
  const navBtns = Array.from(document.querySelectorAll('.nav-btn[data-tab]'));
  let targetBtn = navBtns.find((b) => b.dataset.tab === tabName);
  if (!isNavTabVisible(targetBtn) || !document.getElementById(`tab-${tabName}`)) {
    tabName = 'submit';
    targetBtn = navBtns.find((b) => b.dataset.tab === tabName) || targetBtn;
  }

  navBtns.forEach((b) => b.classList.remove('active'));
  if (targetBtn) {
    targetBtn.classList.add('active');
  }

  document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('active'));
  document.getElementById(`tab-${tabName}`)?.classList.add('active');

  if (targetBtn && typeof targetBtn.scrollIntoView === 'function') {
    requestAnimationFrame(() => {
      targetBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  }
}

function toggleFilterMenu() {
  document.getElementById('filter-bottom-sheet')?.classList.toggle('open');
  document.getElementById('filter-menu-overlay')?.classList.toggle('open');
}

function setDefaultDates() {
  const today = getTodayISO();
  const entryDate = document.getElementById('entry-date');
  const expDate = document.getElementById('expense-date');
  if (entryDate && !entryDate.value) entryDate.value = today;
  if (expDate && !expDate.value) expDate.value = today;
}

async function applyLoginState() {
  const loginOverlay = document.getElementById('login-overlay');
  if (loginOverlay?.open) loginOverlay.close();

  const user = state.currentUser;
  if (!user) return;

  const updateDOM = () => {
    document.getElementById('header-user-name').innerHTML =
      `<i class="fa-solid fa-user"></i> ${stripRoleSuffix(user.name)}`;
    document.getElementById('header-user-store').innerText = user.storeAssignment || 'All Stores';
    document.getElementById('submitter').value = user.name;
    document.getElementById('expense-submitter').value = user.name;

    const storeDaily = document.getElementById('store-select');
    const storeExp = document.getElementById('expense-store');
    const storeFilter = document.getElementById('dashboard-store-filter');

    const locked = user.storeAssignment && user.storeAssignment !== 'All Stores';
    [storeDaily, storeExp, storeFilter].forEach((el) => {
      if (el) el.disabled = Boolean(locked);
    });

    const roleKind = normalizeUserRole(user.role);
    const isAdmin = roleKind === 'admin';
    const canViewPortfolio = roleKind !== 'employee';

    const settingsNavBtn = document.getElementById('nav-btn-settings');
    if (settingsNavBtn) settingsNavBtn.style.display = 'inline-flex';

    const portfolioNavBtn = document.getElementById('nav-btn-portfolio');
    if (portfolioNavBtn) portfolioNavBtn.style.display = canViewPortfolio ? 'inline-flex' : 'none';

    const partnerPanel = document.getElementById('partner-split-panel');
    if (partnerPanel) partnerPanel.style.display = canViewPortfolio ? 'block' : 'none';

    const adminSettingsEl = document.getElementById('settings-admin-section');
    if (adminSettingsEl) adminSettingsEl.style.display = isAdmin ? '' : 'none';

    translatePageLayout(state.currentLanguage);
  };

  if (document.startViewTransition) document.startViewTransition(updateDOM);
  else updateDOM();

  if (normalizeUserRole(user.role) === 'employee' && document.getElementById('tab-portfolio')?.classList.contains('active')) {
    switchTab('submit');
  }

  const isAdminUser = normalizeUserRole(user.role) === 'admin';
  populateStoreDropdowns();
  if (isAdminUser) {
    renderSettingsBusinesses();
    renderSettingsCategories();
    syncRosterFromLive(true);
    renderIntegrationInputs();
  }
  showSkeletons();

  await subscribeRealtimeData({
    onStoresUpdated: () => {
      populateStoreDropdowns();
      if (normalizeUserRole(state.currentUser?.role) === 'admin') {
        renderSettingsBusinesses();
        syncRosterFromLive(false);
      }
      renderDashboard();
    },
    onCategoriesUpdated: () => {
      populateMasterCategoryDropdown();
      if (normalizeUserRole(state.currentUser?.role) === 'admin') {
        renderSettingsCategories();
      }
    },
    onConfigUpdated: () => {
      if (normalizeUserRole(state.currentUser?.role) === 'admin') {
        renderIntegrationInputs();
      }
    },
    onRosterUpdated: () => {
      if (normalizeUserRole(state.currentUser?.role) === 'admin') {
        syncRosterFromLive(false);
      }
      renderDashboard();
    },
    onLedgerUpdated: () => {
      renderDashboard();
    }
  });
}

function bindGlobalGesturesAndNav() {
  document.querySelectorAll('.nav-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btn-logout')?.addEventListener('click', logout);

  document.getElementById('mobile-filter-btn')?.addEventListener('click', toggleFilterMenu);
  document.getElementById('filter-menu-overlay')?.addEventListener('click', toggleFilterMenu);
  document.getElementById('btn-close-filter-sheet')?.addEventListener('click', toggleFilterMenu);

  document.querySelectorAll('[data-mobile-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('time-filter').value = btn.dataset.mobilePeriod;
      renderDashboard();
      toggleFilterMenu();
    });
  });

  document.getElementById('mobile-store-filters')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mobile-store]');
    if (!btn || btn.disabled) return;
    document.getElementById('dashboard-store-filter').value = btn.dataset.mobileStore;
    renderDashboard();
    toggleFilterMenu();
  });

  bindSwipeNavigation();

  // Collapsible mobile header
  let lastScrollY = window.scrollY;
  const header = document.querySelector('header');
  window.addEventListener(
    'scroll',
    () => {
      if (!header || window.innerWidth > 768) return;
      const cur = window.scrollY;
      if (cur < 50) {
        header.classList.remove('header--collapsed');
        lastScrollY = cur;
      } else if (cur > lastScrollY + 10) {
        header.classList.add('header--collapsed');
        lastScrollY = cur;
      } else if (cur < lastScrollY - 10) {
        header.classList.remove('header--collapsed');
        lastScrollY = cur;
      }
    },
    { passive: true }
  );

  // Pull-to-refresh on Dashboard tab
  const dashTab = document.getElementById('tab-dashboard');
  const ptrIndicator = document.getElementById('ptr-indicator');
  const ptrIcon = document.getElementById('ptr-icon');
  const ptrText = document.getElementById('ptr-text');
  let ptrStartY = 0;
  let ptrCurY = 0;
  let pulling = false;

  dashTab?.addEventListener(
    'touchstart',
    (e) => {
      if (window.scrollY === 0 || dashTab.scrollTop === 0) {
        ptrStartY = e.touches[0].clientY;
        ptrCurY = ptrStartY;
        pulling = true;
      }
    },
    { passive: true }
  );

  dashTab?.addEventListener(
    'touchmove',
    (e) => {
      if (!pulling) return;
      ptrCurY = e.touches[0].clientY;
      const diff = ptrCurY - ptrStartY;
      if (diff > 0) {
        ptrIndicator.style.height = `${Math.min(diff, 80)}px`;
        ptrIndicator.style.opacity = String(Math.min(diff / 80, 1));
        if (diff > 80) {
          ptrIcon.style.transform = 'rotate(180deg)';
          ptrText.innerText = state.currentLanguage === 'pt' ? 'Solte para atualizar' : 'Release to refresh';
        } else {
          ptrIcon.style.transform = 'rotate(0deg)';
          ptrText.innerText = state.currentLanguage === 'pt' ? 'Puxe para atualizar' : 'Pull to refresh';
        }
      }
    },
    { passive: true }
  );

  dashTab?.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    if (ptrCurY - ptrStartY > 80) {
      ptrIcon.className = 'fa-solid fa-spinner fa-spin';
      ptrText.innerText = state.currentLanguage === 'pt' ? 'Atualizando...' : 'Refreshing...';
      ptrIndicator.style.height = '40px';
      renderDashboard();
      setTimeout(() => {
        ptrIndicator.style.height = '0px';
        ptrIndicator.style.opacity = '0';
        ptrIcon.className = 'fa-solid fa-arrow-down';
        ptrIcon.style.transform = 'rotate(0deg)';
      }, 650);
    } else {
      ptrIndicator.style.height = '0px';
      ptrIndicator.style.opacity = '0';
    }
  });
}

function isAnyModalOrSheetOpen() {
  return Boolean(document.querySelector('dialog[open], .bottom-sheet.open, .bottom-sheet-overlay.open'));
}

function bindSwipeNavigation() {
  const mainEl = document.querySelector('main');
  if (!mainEl) return;

  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false;

  mainEl.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1 || isAnyModalOrSheetOpen()) {
        tracking = false;
        return;
      }
      if (e.target.closest('input, select, textarea, canvas, [data-no-swipe]')) {
        tracking = false;
        return;
      }
      const tableBox = e.target.closest('.table-container');
      if (tableBox && tableBox.scrollWidth > tableBox.clientWidth + 2) {
        tracking = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      tracking = true;
    },
    { passive: true }
  );

  mainEl.addEventListener(
    'touchcancel',
    () => {
      tracking = false;
    },
    { passive: true }
  );

  mainEl.addEventListener(
    'touchend',
    (e) => {
      if (!tracking) return;
      tracking = false;
      if (e.changedTouches.length !== 1 || isAnyModalOrSheetOpen()) return;
      if (Date.now() - startTime > 600) return;

      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 56 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;

      const visibleTabs = Array.from(document.querySelectorAll('nav .nav-btn[data-tab]'))
        .filter((btn) => isNavTabVisible(btn))
        .map((btn) => btn.dataset.tab);
      if (visibleTabs.length < 2) return;

      const activeBtn = document.querySelector('nav .nav-btn[data-tab].active');
      const currentTab = activeBtn?.dataset.tab || '';
      const currentIdx = visibleTabs.indexOf(currentTab);
      if (currentIdx === -1) return;

      const targetIdx = dx < 0 ? currentIdx + 1 : currentIdx - 1;
      if (targetIdx >= 0 && targetIdx < visibleTabs.length) {
        switchTab(visibleTabs[targetIdx]);
      }
    },
    { passive: true }
  );
}

document.addEventListener('DOMContentLoaded', async () => {
  loadPreferences(() => {
    if (state.currentUser) {
      populateMasterCategoryDropdown();
      populateStoreDropdowns();
      if (normalizeUserRole(state.currentUser.role) === 'admin') {
        syncRosterFromLive(false);
        renderSettingsBusinesses();
        renderSettingsCategories();
      }
      renderDashboard();
    }
  });

  setDefaultDates();
  updateDateBadgeSubtitle();
  renderExpenseLines();

  bindGlobalGesturesAndNav();
  bindSalesEvents(() => switchTab('dashboard'));
  bindExpenseEvents(() => switchTab('dashboard'));
  bindDashboardEvents(switchTab);
  bindSettingsEvents(() => {
    refreshPwaInstallUI();
    if (state.currentUser) {
      populateMasterCategoryDropdown();
      if (normalizeUserRole(state.currentUser.role) === 'admin') {
        renderSettingsRoster();
      }
      renderDashboard();
    }
  });

  // Auth triggers
  document.getElementById('login-pin')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      attemptLogin();
    }
  });
  document.getElementById('login-btn')?.addEventListener('click', attemptLogin);
  document.getElementById('btn-bootstrap-admin')?.addEventListener('click', handleBootstrapAdminSubmit);
  document.getElementById('btn-save-firebase-config')?.addEventListener('click', handleLocalFirebaseConfigSave);

  setOnLoginSuccess(applyLoginState);

  window.dispatchEvent(new Event('resize'));
  await Promise.all([initializeAuthModal(), initUpdater()]);
});
