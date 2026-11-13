// Main ES Module Entry Point: Routing, Session Lifecycle, Real-Time Wiring & Mobile Gestures
import { state } from './state.js';
import { getTodayISO, stripRoleSuffix } from './utils.js';
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
import { initUpdater } from './updater.js';
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

function positionNavIndicator(activeBtn) {
  const indicator = document.querySelector('.nav-indicator');
  if (!activeBtn || !indicator) return;
  indicator.style.width = `${activeBtn.offsetWidth}px`;
  indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
}

export function switchTab(tabName) {
  const updateDOM = () => {
    const navBtns = document.querySelectorAll('.nav-btn[data-tab]');
    navBtns.forEach((b) => b.classList.remove('active'));
    const activeBtn = Array.from(navBtns).find((b) => b.dataset.tab === tabName);
    if (activeBtn) {
      activeBtn.classList.add('active');
      positionNavIndicator(activeBtn);
    }

    document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('active'));
    document.getElementById(`tab-${tabName}`)?.classList.add('active');
  };

  if (document.startViewTransition) {
    document.startViewTransition(updateDOM);
  } else {
    updateDOM();
  }
}

function toggleFabMenu() {
  document.getElementById('fab-bottom-sheet')?.classList.toggle('open');
  document.getElementById('fab-menu-overlay')?.classList.toggle('open');
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

    const roleLower = (user.role || '').toLowerCase();
    const isPriv = roleLower === 'partner' || roleLower === 'admin' || roleLower === 'administrador' || roleLower === 'sócio';
    document.getElementById('nav-btn-settings').style.display = isPriv ? 'inline-flex' : 'none';
    const partnerPanel = document.getElementById('partner-split-panel');
    if (partnerPanel) partnerPanel.style.display = isPriv ? 'block' : 'none';

    translatePageLayout(state.currentLanguage);
  };

  if (document.startViewTransition) document.startViewTransition(updateDOM);
  else updateDOM();

  populateStoreDropdowns();
  renderSettingsBusinesses();
  renderSettingsCategories();
  syncRosterFromLive(true);
  renderIntegrationInputs();
  showSkeletons();

  await subscribeRealtimeData({
    onStoresUpdated: () => {
      populateStoreDropdowns();
      renderSettingsBusinesses();
      syncRosterFromLive(false);
      renderDashboard();
    },
    onCategoriesUpdated: () => {
      populateMasterCategoryDropdown();
      renderSettingsCategories();
    },
    onConfigUpdated: () => {
      renderIntegrationInputs();
    },
    onRosterUpdated: () => {
      syncRosterFromLive(false);
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
  document.getElementById('mobile-fab')?.addEventListener('click', toggleFabMenu);
  document.getElementById('fab-menu-overlay')?.addEventListener('click', toggleFabMenu);
  document.querySelectorAll('.fab-sheet-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleFabMenu();
      switchTab(btn.dataset.tab);
    });
  });

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
    if (!btn) return;
    document.getElementById('dashboard-store-filter').value = btn.dataset.mobileStore;
    renderDashboard();
    toggleFilterMenu();
  });

  // Resize nav indicator smoothly
  window.addEventListener('resize', () => {
    const activeBtn = document.querySelector('.nav-btn[data-tab].active');
    const indicator = document.querySelector('.nav-indicator');
    if (activeBtn && indicator) {
      indicator.style.transition = 'none';
      positionNavIndicator(activeBtn);
      setTimeout(() => (indicator.style.transition = ''), 50);
    }
  });

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

document.addEventListener('DOMContentLoaded', async () => {
  loadPreferences(() => {
    if (state.currentUser) {
      populateMasterCategoryDropdown();
      populateStoreDropdowns();
      syncRosterFromLive(false);
      renderSettingsBusinesses();
      renderSettingsCategories();
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
    if (state.currentUser) {
      populateMasterCategoryDropdown();
      renderSettingsRoster();
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
  await initUpdater();
  await initializeAuthModal();
});
