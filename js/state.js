// Centralized application state shared across modules
export const state = {
  currentUser: null,
  businesses: [],
  globalExpenseCategories: ['Supplies', 'Rent', 'Utilities', 'Salaries', 'Marketing', 'Other'],
  teamRoster: [],
  localTeamRoster: [],
  rawSubmissions: [],
  rawExpenses: [],
  groupedExpenses: [],
  aiApiKey: '',
  sheetsConfig: { spreadsheetId: '', googleClientId: '' },
  currentLanguage: 'pt',
  uploadedImages: {},
  currentDailyReceiptBase64: null,
  currentReceiptBase64: null,
  unsubscribes: [],
  listenersReady: false
};
