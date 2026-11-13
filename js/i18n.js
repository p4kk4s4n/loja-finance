// Bilingual (pt-BR / en-US) translation dictionary and DOM helpers
import { state } from './state.js';

export const translations = {
  pt: {
    nav_log_daily: 'Registrar Vendas',
    nav_log_expense: 'Lançar Despesa',
    nav_dashboard: 'Painel de Lucros',
    nav_portfolio: 'Portfólio',
    nav_history: 'Histórico Geral',
    nav_settings: 'Ajustes',

    daily_title: 'Fechamento de Caixa Diário',
    daily_store: 'Loja',
    daily_date: 'Data do Caixa',
    daily_submitter: 'Lançado Por',
    daily_stream_sales: 'Vendas Totais (R$)',
    daily_cash_in: 'Dinheiro Recebido (R$)',
    daily_cash_out: 'Dinheiro Retirado / Pequenas Despesas (R$)',
    daily_fees: 'Taxas & Tarifas de Cartão (R$)',
    daily_notes: 'Observações / Detalhes de Despesas do Caixa',
    daily_notes_placeholder: 'Descreva retiradas do caixa (ex: material de limpeza), descontos ou ajustes...',
    daily_summary_title: 'Resumo de Vendas (Hoje)',
    daily_summary_desc: 'Calculado: Fluxos Digitais + Dinheiro Líquido',
    daily_submit_btn: 'Enviar Movimento Diário',

    exp_title: 'Lançar Despesa Operacional',
    exp_store: 'Loja',
    exp_submitter: 'Pago Por',
    exp_date: 'Data da Despesa',
    exp_category: 'Categoria',
    exp_category_placeholder: 'Selecione a Categoria',
    exp_master_cat: 'Categoria da Despesa',
    exp_cat_itemized: 'Detalhado (Múltiplas Categorias)',
    exp_method: 'Forma de Pagamento',
    exp_method_placeholder: 'Selecione a Forma',
    exp_desc_placeholder: 'Especifique o que foi comprado, nota fiscal, etc.',
    exp_submit_btn: 'Enviar Registro de Despesa',

    cat_supplies: 'Suprimentos / Estoque',
    cat_rent: 'Aluguel / Espaço',
    cat_utilities: 'Contas (Luz, Água, Net)',
    cat_salaries: 'Salários / Comissões',
    cat_marketing: 'Marketing / Anúncios',
    cat_other: 'Outras Despesas',

    method_bank: 'Transferência Bancária / PIX',
    method_card: 'Cartão de Crédito Empresarial',
    method_drawer: 'Caixa Físico / Dinheiro',

    dash_title: 'Análise do Negócio',
    dash_period: 'Período:',
    dash_store_filter: 'Loja:',
    dash_opt_7: 'Últimos 7 Lançamentos',
    dash_opt_30: 'Últimos 30 Dias',
    dash_opt_all: 'Todo o Histórico',
    dash_kpi_rev: 'Receita Total',
    dash_kpi_exp: 'Despesas Operacionais',
    dash_kpi_profit: 'Lucro Líquido',
    dash_kpi_cards: 'Total Vendas Cartão & PIX',
    dash_chart_title: 'Evolução de Faturamento & Lucro',
    dash_calc_title: 'Divisão de Lucros por Sócio',
    dash_calc_desc: 'Divisão proporcional com base no Lucro Líquido e nas porcentagens configuradas nos Ajustes:',
    port_title: 'Desempenho do Portfólio',
    scope_employee: 'Escopo: Seus Lançamentos',
    scope_store: 'Escopo: ',

    hist_sales_title: 'Registro de Vendas Diárias',
    hist_exp_title: 'Histórico de Despesas Operacionais',
    hist_count: 'Registros:',
    btn_export_all: 'Exportar CSV (Tudo)',

    set_title: 'Configuração do Time & Divisão de Lucros',
    set_desc: 'Gerencie sócios e funcionários. Porcentagens de Sócios devem somar exatamente 100% por loja para salvar.',
    set_btn_save: 'Salvar Configurações',
    set_role_partner: 'Sócio',
    set_role_employee: 'Funcionário',
    set_role_admin: 'Administrador',
    set_add_title: 'Adicionar Membro da Equipe',
    set_add_name: 'Nome Completo',
    set_add_role: 'Cargo / Função',
    set_add_split: 'Participação por Loja (%)',
    set_add_btn: 'Adicionar à Lista',
    set_tbl_name: 'Nome',
    set_tbl_store: 'Loja',
    set_tbl_role: 'Cargo',
    set_tbl_split: 'Participação %',
    set_tbl_salary: 'Salário / Fixo (R$)',
    set_tbl_freq: 'Pagamento',
    set_tbl_payday: 'Dia de Pagamento',
    set_tbl_pin: 'PIN',
    set_tbl_actions: 'Ações',
    opt_freq_none: 'Manual',
    opt_freq_daily: 'Diário',
    opt_freq_weekly: 'Semanal',
    opt_freq_monthly: 'Mensal',
    set_biz_title: 'Gerenciar Empresas e Fontes de Receita',
    set_biz_desc: 'Defina suas empresas e fluxos de pagamento (ex: Stone, PIX). Dinheiro é incluído automaticamente.',
    set_biz_add: 'Adicionar Nova Empresa',
    set_biz_save: 'Salvar Empresas',
    set_cat_title: 'Categorias de Despesas',
    set_cat_desc: 'Gerencie as categorias disponíveis ao lançar despesas.',
    set_cat_add: 'Adicionar Nova Categoria',
    set_cat_save: 'Salvar Categorias',

    upd_title: 'Atualizações do Aplicativo (GitHub)',
    upd_desc: 'Mantenha o aplicativo atualizado automaticamente com a versão mais recente do repositório GitHub.',
    upd_current: 'Versão Instalada:',
    upd_latest: 'Última no GitHub:',
    upd_auto_label: 'Atualizar automaticamente quando houver nova versão',
    upd_check_btn: 'Verificar Atualizações',
    upd_install_btn: 'Atualizar Agora',

    pwa_title: 'Instalar Aplicativo no Dispositivo',
    pwa_desc: 'Instale o Loja Finance como aplicativo nativo (PWA / WebAPK) com URL canônica fixa para evitar duplicidade de instalação.',
    pwa_url_label: 'Link Canônico do App:',
    pwa_id_label: 'ID do WebAPK / Manifesto:',
    pwa_btn_copy: 'Copiar Link',
    pwa_btn_reset: 'Limpar Cache WebAPK',
    pwa_btn_install: 'Instalar no Dispositivo',

    pref_title: 'Preferências Visuais & Acessibilidade',
    pref_theme: 'Modo de Tema',
    pref_theme_dark: 'Modo Escuro (Glow)',
    pref_theme_light: 'Modo Claro (Slate)',
    pref_palette: 'Paleta de Cores',
    pref_palette_indigo: 'Índigo & Violeta Clássico',
    pref_palette_emerald: 'Esmeralda & Menta',
    pref_palette_sunset: 'Pôr do Sol Coral & Rosa',
    pref_palette_cyberpunk: 'Cyberpunk Ciano & Pink',
    pref_fontsize: 'Tamanho da Fonte',
    pref_fontsize_sm: '80% (Pequeno)',
    pref_fontsize_compact: '90% (Compacto)',
    pref_fontsize_normal: '100% (Normal)',
    pref_fontsize_md: '110% (Médio)',
    pref_fontsize_lg: '120% (Grande)',
    pref_fontsize_xl: '130% (Extra Grande)',
    pref_lang: 'Idioma / Language',
    pref_btn_save: 'Salvar Preferências',

    txt_partner_badge: 'Sócio',
    txt_employee_badge: 'Funcionário',
    txt_no_records: 'Nenhum registro encontrado. Envie o caixa diário para visualizar.',
    txt_no_expenses: 'Nenhuma despesa registrada. Adicione despesas para visualizar.',
    txt_no_partners: 'Nenhum parceiro configurado nos Ajustes.',
    opt_all_stores: 'Todas as Lojas',
    status_processing: 'Processando...',
    toast_success: 'Fechamento diário registrado com sucesso!',
    toast_exp_success: 'Despesa lançada com sucesso!',
    toast_saved: 'Preferências salvas com sucesso!',
    toast_roster_saved: 'Configurações da equipe salvas com sucesso!',
    btn_view_receipt: 'Ver Comprovante',
    txt_no_image: 'Sem imagem',
    btn_remove: 'Remover',
    btn_duplicate: 'Duplicar',
    txt_invalid_splits: 'A soma da divisão dos sócios deve ser exatamente 100%.',
    txt_no_partners_warning: 'Nenhum Sócio configurado',
    txt_valid_splits: 'Divisão de Sócios: 100% OK',

    login_title: 'Loja Finance',
    login_subtitle: 'Digite seu PIN para acessar',
    login_pin_label: 'PIN Pessoal',
    login_btn: 'Entrar',
    login_authenticating: 'Autenticando...',
    login_err_empty: 'Por favor, insira seu PIN.',
    login_err_invalid: 'PIN Inválido.'
  },
  en: {
    nav_log_daily: 'Log Daily',
    nav_log_expense: 'Log Expense',
    nav_dashboard: 'Dashboard',
    nav_portfolio: 'Portfolio',
    nav_history: 'History Logs',
    nav_settings: 'Settings',

    daily_title: 'Daily Financial Submission',
    daily_store: 'Store Location',
    daily_date: 'Working Date',
    daily_submitter: 'Submitted By',
    daily_stream_sales: 'Total Sales (R$)',
    daily_cash_in: 'Cash Received (R$)',
    daily_cash_out: 'Cash Paid Out / Small Expenses (R$)',
    daily_fees: 'Taxes & Card Processing Fees (R$)',
    daily_notes: 'Notes / Operating Expenses Detail',
    daily_notes_placeholder: 'Describe cash payouts (e.g. bought cleaner), discounts, or machine adjustments...',
    daily_summary_title: 'Live Sales Summary',
    daily_summary_desc: 'Calculated: Digital Streams + Cash Net',
    daily_submit_btn: 'Submit Daily Financials',

    exp_title: 'Log Business Expense',
    exp_store: 'Store Location',
    exp_submitter: 'Paid By',
    exp_date: 'Expense Date',
    exp_category: 'Category',
    exp_category_placeholder: 'Select Category',
    exp_master_cat: 'Expense Category',
    exp_cat_itemized: 'Itemized (Multiple Categories)',
    exp_method: 'Payment Method',
    exp_method_placeholder: 'Select Payment Method',
    exp_desc_placeholder: 'Specify items bought, invoice reference, etc.',
    exp_submit_btn: 'Submit Expense Record',

    cat_supplies: 'Supplies / Stock',
    cat_rent: 'Rent / Office Space',
    cat_utilities: 'Utilities (Power, Water, Net)',
    cat_salaries: 'Salaries / Commission',
    cat_marketing: 'Marketing / Ads',
    cat_other: 'Other Expenses',

    method_bank: 'Bank Transfer / PIX',
    method_card: 'Business Credit Card',
    method_drawer: 'Cash Drawer',

    dash_title: 'Business Analytics',
    dash_period: 'Period:',
    dash_store_filter: 'Store:',
    dash_opt_7: 'Last 7 Entries',
    dash_opt_30: 'Last 30 Days',
    dash_opt_all: 'All Time Records',
    dash_kpi_rev: 'Total Revenue',
    dash_kpi_exp: 'Operating Expenses',
    dash_kpi_profit: 'Net Profit',
    dash_kpi_cards: 'Total Card & PIX',
    dash_chart_title: 'Revenue & Net Trends',
    dash_calc_title: 'Partner Profit Shares',
    dash_calc_desc: 'Calculated earnings split based on Net Profit and split percentages configured in Settings:',
    port_title: 'Macro-Portfolio Performance',
    scope_employee: 'Scope: Your Entries Only',
    scope_store: 'Scope: ',

    hist_sales_title: 'Daily Financial Logs',
    hist_exp_title: 'Business Expenses Ledger',
    hist_count: 'Entries:',
    btn_export_all: 'Export CSV (All Reports)',

    set_title: 'Team Settings & Profit Splits',
    set_desc: 'Manage partners and employees. Partner percentages must total exactly 100% per store to save.',
    set_btn_save: 'Save Configurations',
    set_role_partner: 'Partner',
    set_role_employee: 'Employee',
    set_role_admin: 'Admin',
    set_add_title: 'Add Team Member',
    set_add_name: 'Full Name',
    set_add_role: 'Business Role',
    set_add_split: 'Partner Equity Matrix (%)',
    set_add_btn: 'Add Member to List',
    set_tbl_name: 'Name',
    set_tbl_store: 'Store',
    set_tbl_role: 'Role',
    set_tbl_split: 'Split %',
    set_tbl_salary: 'Salary / Wage (R$)',
    set_tbl_freq: 'Pay Freq',
    set_tbl_payday: 'Pay Day',
    set_tbl_pin: 'PIN',
    set_tbl_actions: 'Actions',
    opt_freq_none: 'Manual',
    opt_freq_daily: 'Daily',
    opt_freq_weekly: 'Weekly',
    opt_freq_monthly: 'Monthly',
    set_biz_title: 'Manage Businesses & Income Streams',
    set_biz_desc: 'Define your businesses and payment streams (e.g., Stone, Rede, PIX). Cash In/Out are included automatically.',
    set_biz_add: 'Add New Business',
    set_biz_save: 'Save Businesses',
    set_cat_title: 'Expense Categories',
    set_cat_desc: 'Manage the categories available when logging expenses.',
    set_cat_add: 'Add New Category',
    set_cat_save: 'Save Categories',

    upd_title: 'App Updates (GitHub)',
    upd_desc: 'Automatically check and update to the latest published version from the GitHub repository.',
    upd_current: 'Installed Version:',
    upd_latest: 'Latest on GitHub:',
    upd_auto_label: 'Automatically update when a new version is available',
    upd_check_btn: 'Check for Updates',
    upd_install_btn: 'Update Now',

    pwa_title: 'Install App to Device',
    pwa_desc: 'Install Loja Finance on your phone or desktop with a locked canonical WebAPK ID to prevent duplicate or broken shortcuts.',
    pwa_url_label: 'Canonical App Link:',
    pwa_id_label: 'WebAPK / Manifest ID:',
    pwa_btn_copy: 'Copy Share Link',
    pwa_btn_reset: 'Reset WebAPK Cache',
    pwa_btn_install: 'Install to Device',

    pref_title: 'UI Preferences & Accessibility',
    pref_theme: 'Theme Mode',
    pref_theme_dark: 'Dark Mode (Glow)',
    pref_theme_light: 'Light Mode (Classic Slate)',
    pref_palette: 'Color Accent Palette',
    pref_palette_indigo: 'Classic Indigo & Violet',
    pref_palette_emerald: 'Neon Emerald & Mint',
    pref_palette_sunset: 'Sunset Coral & Rose',
    pref_palette_cyberpunk: 'Cyberpunk Neon Cyan & Pink',
    pref_fontsize: 'Font Size Scale',
    pref_fontsize_sm: '80% (Small)',
    pref_fontsize_compact: '90% (Compact)',
    pref_fontsize_normal: '100% (Normal)',
    pref_fontsize_md: '110% (Medium)',
    pref_fontsize_lg: '120% (Large)',
    pref_fontsize_xl: '130% (Extra Large)',
    pref_lang: 'Idioma / Language',
    pref_btn_save: 'Save Preferences',

    txt_partner_badge: 'Partner',
    txt_employee_badge: 'Employee',
    txt_no_records: 'No records found. Submit daily financials to populate.',
    txt_no_expenses: 'No expenses logged. Add expenses to populate.',
    txt_no_partners: 'No partners configured in Settings.',
    opt_all_stores: 'All Stores',
    status_processing: 'Processing...',
    toast_success: 'Daily financials recorded successfully!',
    toast_exp_success: 'Expense logged successfully!',
    toast_saved: 'Preferences saved successfully!',
    toast_roster_saved: 'Team settings saved successfully!',
    btn_view_receipt: 'View Receipt',
    txt_no_image: 'No image',
    btn_remove: 'Remove',
    btn_duplicate: 'Duplicate',
    txt_invalid_splits: 'Partner splits must sum to exactly 100%.',
    txt_no_partners_warning: 'No Partners configured',
    txt_valid_splits: 'Partner Splits: 100% OK',

    login_title: 'Loja Finance',
    login_subtitle: 'Enter your PIN to access',
    login_pin_label: 'Personal PIN Code',
    login_btn: 'Login',
    login_authenticating: 'Authenticating...',
    login_err_empty: 'Please enter your PIN.',
    login_err_invalid: 'Invalid PIN.'
  }
};

export function t(key, fallback = '') {
  const dict = translations[state.currentLanguage] || translations.en;
  return dict[key] || fallback || key;
}

export function getCategoryTranslation(category, lang = state.currentLanguage) {
  if (!category) return '';
  return category
    .split(',')
    .map((raw) => {
      const c = raw.trim();
      const map = {
        Supplies: 'cat_supplies',
        Rent: 'cat_rent',
        Utilities: 'cat_utilities',
        Salaries: 'cat_salaries',
        Marketing: 'cat_marketing',
        Other: 'cat_other'
      };
      const key = map[c] || 'cat_' + c.toLowerCase().split(' / ')[0].trim().replace(/\s+/g, '_');
      return translations[lang]?.[key] || c;
    })
    .join(', ');
}

export function getPaymentMethodTranslation(method, lang = state.currentLanguage) {
  const map = {
    'Bank Transfer': 'method_bank',
    Card: 'method_card',
    'Cash Drawer': 'method_drawer'
  };
  const key = map[method];
  return (key && translations[lang]?.[key]) || method;
}

export function translatePageLayout(lang = state.currentLanguage) {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang]?.[key]) el.innerText = translations[lang][key];
  });

  const notes = document.getElementById('notes');
  if (notes) notes.placeholder = t('daily_notes_placeholder');
  const newName = document.getElementById('new-member-name');
  if (newName) newName.placeholder = lang === 'pt' ? 'Ex: Alice Silva' : 'e.g. Alice Silva';

  const isPt = lang === 'pt';
  const dailyTh = document.getElementById('hist-daily-th');
  if (dailyTh) {
    dailyTh.innerHTML = isPt
      ? '<th>Data</th><th>Lançado Por</th><th>Loja</th><th>Tipo de Receita</th><th>Valor (R$)</th><th>Comprovante</th><th>Notas</th><th></th>'
      : '<th>Date</th><th>Submitter</th><th>Store</th><th>Entry Type</th><th>Amount (R$)</th><th>Receipt</th><th>Notes</th><th></th>';
  }

  const expTh = document.getElementById('hist-exp-th');
  if (expTh) {
    expTh.innerHTML = isPt
      ? '<th>Data</th><th>Pago Por</th><th>Categoria</th><th>Valor (R$)</th><th>Forma de Pagamento</th><th>Descrição</th><th></th>'
      : '<th>Date</th><th>Paid By</th><th>Category</th><th>Amount (R$)</th><th>Payment Method</th><th>Description</th><th></th>';
  }
}
