/**
 * Google Apps Script Web App Backend
 * Serves the HTML frontend and acts as the API endpoint for data operations.
 */



/**
 * Serves the web application UI.
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Loja Finance - Business Operations Dashboard')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Helper to retrieve or initialize the spreadsheet database.
 */
function getSpreadsheet() {
  var id = '1G-TFhcsMCb6v4g19IjGIV6wMccDVXUyjgYJvwi3fO9Q'; // Hardcoded as requested
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Cannot access the database. The spreadsheet may have been deleted or permissions changed.');
  }
}

/**
 * Helper to retrieve or initialize the Drive folder for uploads.
 */
function getReceiptsFolder() {
  var properties = PropertiesService.getScriptProperties();
  var id = properties.getProperty('FOLDER_ID');
  
  if (!id) {
    throw new Error('Receipts folder not initialized.');
  }
  
  try {
    return DriveApp.getFolderById(id);
  } catch (e) {
    throw new Error('Cannot access the receipts folder.');
  }
}

function authenticateUser(pin) {
  try {
    var roster = getTeamMembers();
    for (var i = 0; i < roster.length; i++) {
      if (roster[i].pin === pin.toString()) {
        return {
          success: true,
          user: {
            name: roster[i].name,
            role: roster[i].role,
            storeAssignment: roster[i].storeAssignment
          },
          businesses: getBusinesses(),
          categories: getCategories()
        };
      }
    }
    return { success: false, message: 'Invalid PIN.' };
  } catch (e) {
    return { success: false, message: 'Error authenticating: ' + e.message };
  }
}

/**
 * Gets the custom expense categories from properties.
 */
function getCategories() {
  try {
    var stored = PropertiesService.getScriptProperties().getProperty('EXPENSE_CATEGORIES');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch(e) {}
  // Default categories
  return ['Supplies', 'Rent', 'Utilities', 'Salaries', 'Marketing', 'Other'];
}

/**
 * Saves custom expense categories to properties.
 */
function saveCategories(categories) {
  try {
    PropertiesService.getScriptProperties().setProperty('EXPENSE_CATEGORIES', JSON.stringify(categories));
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}


function getBusinesses() {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Businesses');
    if (!sheet) return [{ name: 'Store 1', streams: 'Stone, Rede' }, { name: 'Store 2', streams: 'GetNet' }];
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [{ name: 'Store 1', streams: 'Stone, Rede' }];
    
    var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    var biz = [];
    for (var i = 0; i < values.length; i++) {
      if (values[i][0]) {
        biz.push({ name: values[i][0], streams: values[i][1] || '' });
      }
    }
    return biz;
  } catch(e) {
    return [{ name: 'Store 1', streams: 'Stone, Rede' }];
  }
}

function saveBusinesses(businesses) {
  try {
    var ss = getSpreadsheet();
    var sheet = getOrCreateSheet(ss, 'Businesses');
    
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
    }
    
    var rowsToInsert = businesses.map(function(b) {
      return [b.name, b.streams];
    });
    
    if (rowsToInsert.length > 0) {
      var currentMaxRows = sheet.getMaxRows();
      var neededRows = rowsToInsert.length + 1;
      if (currentMaxRows < neededRows) {
        sheet.insertRowsAfter(currentMaxRows, neededRows - currentMaxRows);
      }
      sheet.getRange(2, 1, rowsToInsert.length, 2).setValues(rowsToInsert);
    }
    return { success: true, message: 'Businesses saved successfully!' };
  } catch(e) {
    return { success: false, message: 'Error saving businesses: ' + e.message };
  }
}

function saveSubmission(data) {
  try {
    var ss = getSpreadsheet();
    var sheet = getOrCreateSheet(ss, 'DailySubmissions');
    if (sheet.getLastRow() === 0) {
      var headers = ['Timestamp','Date','Store','Submitter','Entry Type','Amount (R$)','Receipt Link','Notes / Expenses'];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    
    var folder = getReceiptsFolder();
    var timestamp = new Date();
    
    var totalRevVal = 0;
    var rowsToAppend = [];
    
    if (data.streams && data.streams.length > 0) {
      for (var i = 0; i < data.streams.length; i++) {
        var stream = data.streams[i];
        var amt = parseFloat(stream.amount) || 0;
        var link = '';
        
        if (stream.photo && stream.photo.base64) {
          link = uploadImageToDrive(folder, stream.photo, data.date + '_' + stream.name.replace(/[^a-z0-9]/gi, '_') + '_' + data.submitter.replace(/[^a-z0-9]/gi, '_'));
        }
        
        if (stream.name === 'Cash Out') {
           totalRevVal -= amt;
        } else if (stream.name !== 'Cash In') {
           totalRevVal += amt;
        }
        if (stream.name === 'Cash In') {
           totalRevVal += amt;
        }
        
        rowsToAppend.push([
          timestamp,
          data.date,
          data.store || 'Store 1',
          data.submitter,
          stream.name,
          amt,
          link,
          data.notes || ''
        ]);
      }
    }
    
    if (rowsToAppend.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    }
    
    return {
      success: true,
      message: 'Financial submission recorded successfully!',
      totalRevenue: totalRevVal,
      sheetUrl: ss.getUrl()
    };
    
  } catch (error) {
    Logger.log('Error saving submission: ' + error.toString());
    return {
      success: false,
      message: 'Failed to save submission: ' + error.message
    };
  }
}

/**
 * Decodes and uploads base64 image data to Google Drive.
 */
function uploadImageToDrive(folder, fileData, baseName) {
  var base64Content = fileData.base64.split(',')[1] || fileData.base64;
  var decoded = Utilities.base64Decode(base64Content);
  var extension = fileData.mimeType.split('/')[1] || 'jpg';
  if (extension === 'jpeg') extension = 'jpg';
  
  var fileName = baseName + '.' + extension;
  var blob = Utilities.newBlob(decoded, fileData.mimeType, fileName);
  
    var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('Could not set public permissions on uploaded photo: ' + e.message);
  }
  
  return file.getUrl();
}

/**
 * Saves an operational expense (supports multiple line items).
 */
function saveExpense(data) {
  try {
    var ss = getSpreadsheet();
    var sheet = getOrCreateSheet(ss, 'Expenses');
    var headers = ['Date','Store','Submitter','Category','Amount (R$)','Payment Method','Description','Receipt Link','Timestamp'];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    
    var folder = getReceiptsFolder();
    var timestamp = new Date();
    var receiptLink = '';
    
    if (data.receiptPhoto && data.receiptPhoto.base64) {
      var baseName = data.date + '_Expense_' + data.submitter.replace(/[^a-z0-9]/gi, '_') + '_' + Date.now();
      receiptLink = uploadImageToDrive(folder, data.receiptPhoto, baseName);
    }
    
    var rowsToAppend = [];
    if (data.items && data.items.length > 0) {
      for (var i = 0; i < data.items.length; i++) {
        var item = data.items[i];
        var amount = parseFloat(item.amount) || 0;
        if (amount > 0) {
          rowsToAppend.push([
            data.date,
            data.store || 'Store 1',
            data.submitter,
            item.category || data.category,
            amount,
            data.paymentMethod,
            item.description || data.description || '',
            receiptLink,
            timestamp
          ]);
        }
      }
    } else {
      var amount = parseFloat(data.amount) || 0;
      if (amount > 0) {
        rowsToAppend.push([
          data.date,
          data.store || 'Store 1',
          data.submitter,
          data.category,
          amount,
          data.paymentMethod,
          data.description || '',
          receiptLink,
          timestamp
        ]);
      }
    }
    
    if (rowsToAppend.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    } else {
      throw new Error('Expense amount must be greater than 0.');
    }
    
    return {
      success: true,
      message: 'Expense recorded successfully!',
      sheetUrl: ss.getUrl()
    };
  } catch (error) {
    Logger.log('Error saving expense: ' + error.toString());
    return {
      success: false,
      message: 'Failed to save expense: ' + error.message
    };
  }
}

/**
 * Fetches the team roster.
 */
function getTeamMembers() {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('TeamMembers');
    if (!sheet) return [];
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];
    
    var values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    var roster = [];
    
    for (var i = 0; i < values.length; i++) {
      var equityStr = (values[i][2] || '{}').toString();
      var equityObj = {};
      try {
        equityObj = JSON.parse(equityStr);
      } catch(e) {}
      
      roster.push({
        name: values[i][0],
        role: values[i][1],
        equity: equityObj,
        storeAssignment: values[i][3],
        pin: values[i][4],
        salary: values[i][5] || 0,
        payFrequency: values[i][6] || 'None',
        payDay: values[i][7] !== '' ? values[i][7] : null  // null = use defaults
      });
    }
    
    return roster;
  } catch (error) {
    Logger.log('Error fetching team members: ' + error.toString());
    return [];
  }
}

/**
 * Overwrites/updates the team roster in the spreadsheet settings.
 */
function saveTeamMembers(roster) {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('TeamMembers');
    if (!sheet) {
      throw new Error('TeamMembers sheet not found.');
    }
    
    // Clear existing data rows without shrinking the sheet
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
    }
    
    var rowsToInsert = roster.map(function(m) {
      return [
        m.name || '',
        m.role || 'Employee',
        m.role === 'Partner' ? JSON.stringify(m.equity || {}) : '{}',
        m.storeAssignment || 'All Stores',
        m.pin || '',
        m.salary || 0,
        m.payFrequency || 'None',
        (m.payDay !== null && m.payDay !== undefined) ? m.payDay : ''
      ];
    });
    
    if (rowsToInsert.length > 0) {
      // Ensure the sheet has enough rows for the insertion
      var currentMaxRows = sheet.getMaxRows();
      var neededRows = rowsToInsert.length + 1;
      if (currentMaxRows < neededRows) {
        sheet.insertRowsAfter(currentMaxRows, neededRows - currentMaxRows);
      }
      
      sheet.getRange(2, 1, rowsToInsert.length, 8).setValues(rowsToInsert);
      sheet.getRange(2, 3, rowsToInsert.length, 1).setNumberFormat('@'); // JSON string
      sheet.getRange(2, 5, rowsToInsert.length, 1).setNumberFormat('@'); // Plain text for PIN
    }
    
    return {
      success: true,
      message: 'Team settings and splits updated successfully!'
    };
  } catch (error) {
    Logger.log('Error saving team roster: ' + error.toString());
    return {
      success: false,
      message: 'Failed to save team roster: ' + error.message
    };
  }
}

/**
 * Reads submitter list dynamically from the active team roster database sheet.
 */
function getSubmitters() {
  var roster = getTeamMembers();
  if (roster.length === 0) {
    return ['Alice (Partner)', 'Bob (Partner)', 'Charlie (Employee)', 'Diana (Employee)'];
  }
  return roster.map(function(member) {
    return member.name;
  });
}

/**
 * Fetches dashboard financial data, expenses, logs, and chart datasets.
 */
function getDashboardData(userStoreFilter) {
  userStoreFilter = userStoreFilter || 'All Stores';
  try {
    var ss = getSpreadsheet();
    var sheetDaily = ss.getSheetByName('DailySubmissions');
    var sheetExpenses = ss.getSheetByName('Expenses');
    var teamRoster = getTeamMembers();
    
        if (!sheetDaily || !sheetExpenses) {
      Logger.log('Sheets missing. Auto-running setupProject...');
      setupProject();
      ss = getSpreadsheet();
      sheetDaily = ss.getSheetByName('DailySubmissions');
      sheetExpenses = ss.getSheetByName('Expenses');
      teamRoster = getTeamMembers();
    }
    
    // 1. Fetch Daily Submissions
    var lastRowDaily = sheetDaily.getLastRow();
    var dailyValues = [];
    if (lastRowDaily > 1) {
              var maxColDaily = sheetDaily.getLastColumn();
        if (maxColDaily < 1) maxColDaily = 13;
        dailyValues = sheetDaily.getRange(2, 1, lastRowDaily - 1, maxColDaily).getValues();
        // Sort Date Ascending
        dailyValues.sort(function(a, b) {
          return new Date(parseSafeDateString(a[1])) - new Date(parseSafeDateString(b[1]));
        });
    }
    
    // 2. Fetch Expenses
    var lastRowExp = 0;
    var expenseValues = [];
    if (sheetExpenses) {
      lastRowExp = sheetExpenses.getLastRow();
      if (lastRowExp > 1) {
                  var maxColExp = sheetExpenses.getLastColumn();
          if (maxColExp < 1) maxColExp = 8;
          expenseValues = sheetExpenses.getRange(2, 1, lastRowExp - 1, maxColExp).getValues();
          // Sort Date Ascending
          expenseValues.sort(function(a, b) {
            return new Date(parseSafeDateString(a[0])) - new Date(parseSafeDateString(b[0]));
          });
      }
    }
    
    var totalRevenue = 0;
    var card1Total = 0;
    var card2Total = 0;
    var cashIn = 0;
    var cashOut = 0;
    var cashNet = 0;
    
    var historySubmissions = [];
    var aggregatedDaily = {}; // Date -> { revenue: 0, expenses: 0, card1: 0, card2: 0, cashNet: 0 }
    
    // Map Submissions (Normalized)
    for (var i = 0; i < dailyValues.length; i++) {
      var row = dailyValues[i];
      if (row.join('').trim() === '') continue; // Skip completely empty rows
      var dateStr = parseSafeDateString(row[1]);
      var storeName = (row[2] || 'Store 1').toString().trim();
      if (userStoreFilter !== 'All Stores' && storeName !== userStoreFilter) continue;
      
      var entryType = row[4] || '';
      var amt = parseFloat(row[5]) || 0;
      var link = row[6] || '';
      var notes = row[7] || '';
      
      var isCashOut = (entryType === 'Cash Out');
      var isCashIn = (entryType === 'Cash In');
      var tot = isCashOut ? -amt : amt;
      
      totalRevenue += tot;
      if (isCashOut) {
          cashOut += amt;
      } else if (isCashIn) {
          cashIn += amt;
      } else {
          card1Total += amt; // Generic bucket for digital sales
      }
      
      cashNet = cashIn - cashOut;
      
      if (!aggregatedDaily[dateStr]) {
        aggregatedDaily[dateStr] = { revenue: 0, expenses: 0, card1: 0, card2: 0, cashNet: 0 };
      }
      aggregatedDaily[dateStr].revenue += tot;
      if (isCashOut) aggregatedDaily[dateStr].cashNet -= amt;
      else if (isCashIn) aggregatedDaily[dateStr].cashNet += amt;
      else aggregatedDaily[dateStr].card1 += amt;
      
      historySubmissions.unshift({
        timestamp: (row[0] && typeof row[0].toISOString === 'function') ? row[0].toISOString() : (row[0] || '').toString(),
        date: dateStr,
        store: storeName,
        submitter: row[3],
        entryType: entryType,
        amount: amt,
        link: link,
        notes: notes
      });
    }
    
    // Map Expenses
    var totalExpenses = 0;
    var groupedExpenses = {};
    
    for (var j = 0; j < expenseValues.length; j++) {
      var rowExp = expenseValues[j];
      if (rowExp.join('').trim() === '') continue; // Skip completely empty rows
      var dateStrExp = parseSafeDateString(rowExp[0]);
      var storeNameExp = (rowExp[1] || 'Store 1').toString().trim();
      if (userStoreFilter !== 'All Stores' && storeNameExp !== userStoreFilter) continue;
      var amt = parseFloat(rowExp[4]) || 0;
      
      totalExpenses += amt;
      
      if (!aggregatedDaily[dateStrExp]) {
        aggregatedDaily[dateStrExp] = { revenue: 0, expenses: 0, card1: 0, card2: 0, cashNet: 0 };
      }
      aggregatedDaily[dateStrExp].expenses += amt;
      
      // Determine grouping key using Timestamp (column 8)
      var tsVal = rowExp[8];
      var groupKey = '';
      if (tsVal && typeof tsVal.getTime === 'function') {
        groupKey = tsVal.getTime().toString();
      } else if (tsVal) {
        groupKey = tsVal.toString();
      } else {
        groupKey = 'legacy_' + dateStrExp + '_' + storeNameExp + '_' + rowExp[2] + '_' + rowExp[5];
      }
      
      var category = (rowExp[3] || '').toString().trim();
      var desc = (rowExp[6] || '').toString().trim();
      
      if (!groupedExpenses[groupKey]) {
        groupedExpenses[groupKey] = {
          date: dateStrExp,
          store: storeNameExp,
          submitter: rowExp[2],
          category: category,
          amount: amt,
          paymentMethod: rowExp[5],
          description: desc,
          timestamp: (tsVal && typeof tsVal.toISOString === 'function') ? tsVal.toISOString() : (tsVal || '').toString()
        };
      } else {
        // Group the item!
        groupedExpenses[groupKey].amount += amt;
        
        var existingCats = groupedExpenses[groupKey].category.split(',').map(function(s) { return s.trim(); });
        if (existingCats.indexOf(category) === -1 && category !== '') {
          groupedExpenses[groupKey].category += (groupedExpenses[groupKey].category ? ', ' : '') + category;
        }
        
        if (desc && groupedExpenses[groupKey].description.indexOf(desc) === -1) {
          groupedExpenses[groupKey].description += (groupedExpenses[groupKey].description ? ' | ' : '') + desc;
        }
      }
    }
    
    // Convert object to array and reverse to show newest first
    var historyExpenses = [];
    var keys = Object.keys(groupedExpenses);
    for (var k = 0; k < keys.length; k++) {
       historyExpenses.push(groupedExpenses[keys[k]]);
    }
    historyExpenses.reverse();
    
    // Compile Trends Array
    var sortedDates = Object.keys(aggregatedDaily).sort(function(a,b) {
      return new Date(a) - new Date(b);
    });
    
    var trends = {
      labels: [],
      revenue: [],
      expenses: [],
      netProfit: [],
      card1: [],
      card2: [],
      cashNet: []
    };
    
    sortedDates.forEach(function(date) {
      var dayData = aggregatedDaily[date];
      var netProf = dayData.revenue - dayData.expenses;
      
      trends.labels.push(date);
      trends.revenue.push(dayData.revenue);
      trends.expenses.push(dayData.expenses);
      trends.netProfit.push(netProf);
      trends.card1.push(dayData.card1);
      trends.card2.push(dayData.card2);
      trends.cashNet.push(dayData.cashNet);
    });
    
    // Round figures
    var stats = {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      netProfit: Math.round((totalRevenue - totalExpenses) * 100) / 100,
      card1Total: Math.round(card1Total * 100) / 100,
      card2Total: Math.round(card2Total * 100) / 100,
      cashIn: Math.round(cashIn * 100) / 100,
      cashOut: Math.round(cashOut * 100) / 100,
      cashNet: Math.round(cashNet * 100) / 100,
      countSubmissions: historySubmissions.length,
      countExpenses: historyExpenses.length
    };
    
          return {
        success: true,
        stats: stats,
        historySubmissions: historySubmissions,
      historyExpenses: historyExpenses,
      trends: trends,
      teamRoster: teamRoster,
      businesses: getBusinesses()
    };
    
  } catch (error) {
    Logger.log('Error fetching dashboard: ' + error.toString());
    return {
      success: false,
      message: 'Failed to fetch dashboard: ' + error.message
    };
  }
}
/**
 * Google Apps Script Setup Code
 * Run 'setupProject' from the script editor to initialize the spreadsheet database and Drive folders.
 */

function setupProject() {
  var properties = PropertiesService.getScriptProperties();
  var folderId = properties.getProperty('FOLDER_ID');
  var spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  
  var folder;
  var spreadsheet;
  
  // 1. Setup Drive Folder for Receipts
  if (!folderId) {
    folder = DriveApp.createFolder('Loja Finance Receipts');
    properties.setProperty('FOLDER_ID', folder.getId());
    Logger.log('Created Drive Folder: ' + folder.getName() + ' (ID: ' + folder.getId() + ')');
  } else {
    try {
      folder = DriveApp.getFolderById(folderId);
      Logger.log('Using existing Drive Folder: ' + folder.getName());
    } catch (e) {
      folder = DriveApp.createFolder('Loja Finance Receipts');
      properties.setProperty('FOLDER_ID', folder.getId());
      Logger.log('Created replacement Drive Folder (previous ID invalid): ' + folder.getId());
    }
  }
  
  // Make folder publicly accessible or link-sharable so photos can be viewed in browser easily
  try {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    Logger.log('Set Drive Folder permissions to: Anyone with link can view.');
  } catch (e) {
    Logger.log('Warning: Could not set folder sharing settings: ' + e.message);
  }

  // 2. Setup Spreadsheet Database
  spreadsheetId = '1G-TFhcsMCb6v4g19IjGIV6wMccDVXUyjgYJvwi3fO9Q'; // Hardcoded as requested
  try {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    properties.setProperty('SPREADSHEET_ID', spreadsheet.getId());
    Logger.log('Using hardcoded Spreadsheet: ' + spreadsheet.getName());
  } catch (e) {
    throw new Error('Failed to open hardcoded Spreadsheet ID ' + spreadsheetId + '. Please check permissions.');
  }

  // 3. Configure Sheet "DailySubmissions" (Normalized)
  var sheetDaily = getOrCreateSheet(spreadsheet, 'DailySubmissions');
  var headersDaily = [
    'Timestamp',
    'Date',
    'Store',
    'Submitter',
    'Entry Type',
    'Amount (R$)',
    'Receipt Link',
    'Notes / Expenses'
  ];
  
  // Clear the old mock/flat entries!
  sheetDaily.clear();
  
  sheetDaily.getRange(1, 1, 1, headersDaily.length).setValues([headersDaily]);
  sheetDaily.getRange(1, 1, 1, headersDaily.length)
       .setFontWeight('bold')
       .setBackground('#1e1b4b')
       .setFontColor('#ffffff')
       .setHorizontalAlignment('center');
       
  sheetDaily.getRange('F2:F').setNumberFormat('$#,##0.00');
  sheetDaily.getRange('B2:B').setNumberFormat('yyyy-mm-dd');
  sheetDaily.autoResizeColumns(1, headersDaily.length);
  
  // 3b. Configure Sheet "Businesses"
  var sheetBiz = getOrCreateSheet(spreadsheet, 'Businesses');
  var headersBiz = ['Business Name', 'Income Streams'];
  if (sheetBiz.getLastRow() === 0) {
    sheetBiz.getRange(1, 1, 1, headersBiz.length).setValues([headersBiz]);
    sheetBiz.getRange(2, 1, 2, 2).setValues([
      ['Store 1', 'Machine 1 Card, Machine 1 PIX, Machine 2 Card, Machine 2 PIX'],
      ['Store 2', 'Machine 1 Card, Machine 1 PIX']
    ]);
  }
  
  // Delete AppSettings if exists
  try {
    var appSettingsSheet = spreadsheet.getSheetByName('AppSettings');
    if (appSettingsSheet) spreadsheet.deleteSheet(appSettingsSheet);
  } catch(e) {}

  // 4. Configure Sheet "Expenses"
  var sheetExpenses = getOrCreateSheet(spreadsheet, 'Expenses');
  var headersExpenses = [
    'Date',
    'Store',
    'Submitter',
    'Category',
    'Amount (R$)',
    'Payment Method',
    'Description',
    'Receipt Link',
    'Timestamp'
  ];
  
  sheetExpenses.getRange(1, 1, 1, headersExpenses.length).setValues([headersExpenses]);
  sheetExpenses.getRange(1, 1, 1, headersExpenses.length)
       .setFontWeight('bold')
       .setBackground('#4c1d95')
       .setFontColor('#ffffff')
       .setHorizontalAlignment('center');
       
  // Formats for Expenses sheet
  sheetExpenses.getRange('E2:E').setNumberFormat('$#,##0.00');
  sheetExpenses.getRange('A2:A').setNumberFormat('yyyy-mm-dd');
  sheetExpenses.autoResizeColumns(1, headersExpenses.length);

  // 5. Configure Sheet "TeamMembers"
  var sheetTeam = getOrCreateSheet(spreadsheet, 'TeamMembers');
  var headersTeam = [
    'Name',
    'Role',
    'Equity Matrix',
    'StoreAssignment',
    'PIN',
    'Salary',
    'Pay Frequency',
    'Pay Day'
  ];
  
  sheetTeam.getRange(1, 1, 1, headersTeam.length).setValues([headersTeam]);
  sheetTeam.getRange(1, 1, 1, headersTeam.length)
       .setFontWeight('bold')
       .setBackground('#065f46')
       .setFontColor('#ffffff')
       .setHorizontalAlignment('center');
       
  // Formats for Team sheet
  sheetTeam.getRange('C2:C').setNumberFormat('@'); // JSON String now
  sheetTeam.autoResizeColumns(1, headersTeam.length);

  // Remove default "Sheet1" if it exists and we have other sheets
  try {
    var defaultSheet = spreadsheet.getSheetByName('Sheet1');
    if (defaultSheet && spreadsheet.getSheets().length > 1) {
      spreadsheet.deleteSheet(defaultSheet);
    }
  } catch (e) {
    Logger.log('Note: ' + e.message);
  }

  // 6. Seed Dynamic Team Data if empty
  if (sheetTeam.getLastRow() <= 1) {
    var initialTeam = [
      ['Alice (Partner)', 'Partner', JSON.stringify({"Store 1": 0.50, "Store 2": 0.50}), 'All Stores', '1234'],
      ['Bob (Partner)', 'Partner', JSON.stringify({"Store 1": 0.50, "Store 2": 0.50}), 'Store 1', '1234'],
      ['Charlie (Employee)', 'Employee', '{}', 'Store 2', '1234'],
      ['Diana (Employee)', 'Employee', '{}', 'All Stores', '1234']
    ];
    sheetTeam.getRange(2, 1, initialTeam.length, 5).setValues(initialTeam);
    sheetTeam.getRange(2, 5, initialTeam.length, 1).setNumberFormat('@');
    Logger.log('Seeded dynamic team roster with Equity Matrix.');
  }

  // 7. Seed Daily Submissions if empty
  // (Mock entries disabled for normalized schema to keep ledger clean)

  // 8. Seed Expenses if empty
  if (sheetExpenses.getLastRow() <= 1) {
    seedMockExpenses(sheetExpenses);
    Logger.log('Seeded mock expenses database.');
  }
  
  Logger.log('Setup completed successfully!');
  Logger.log('Spreadsheet URL: ' + spreadsheet.getUrl());
  Logger.log('Folder URL: ' + folder.getUrl());
  
  return {
    spreadsheetUrl: spreadsheet.getUrl(),
    folderUrl: folder.getUrl(),
    spreadsheetId: spreadsheet.getId(),
    folderId: folder.getId()
  };
}

/**
 * Gets sheet by name or creates it if missing.
 */
function getOrCreateSheet(spreadsheet, name) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  return sheet;
}

function seedMockExpenses(sheet) {
  var today = new Date();
  var mockRows = [];
  var categories = ['Supplies', 'Rent', 'Utilities', 'Salaries', 'Other'];
  var submitters = ['Alice (Partner)', 'Bob (Partner)'];
  
  // Seed 4 mock expenses
  var rentDate = new Date(today);
  rentDate.setDate(today.getDate() - 6);
      mockRows.push([
      Utilities.formatDate(rentDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      'Store 1',
      'Alice (Partner)',
      'Rent',
      600.00,
      'Bank Transfer',
      'Monthly office rent',
      new Date()
    ]);

  var utilityDate = new Date(today);
  utilityDate.setDate(today.getDate() - 4);
  mockRows.push([
    Utilities.formatDate(utilityDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    'Bob (Partner)',
    'Utilities',
    85.20,
    'Card',
    'Electricity and Wi-Fi bill',
    new Date()
  ]);

  var suppliesDate = new Date(today);
  suppliesDate.setDate(today.getDate() - 2);
  mockRows.push([
    Utilities.formatDate(suppliesDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    'Alice (Partner)',
    'Supplies',
    42.80,
    'Cash Drawer',
    'Cleaning supplies and garbage bags',
    new Date()
  ]);

  sheet.getRange(2, 1, mockRows.length, mockRows[0].length).setValues(mockRows);
  sheet.autoResizeColumns(1, mockRows[0].length);
}

function parseSafeDateString(val) {
  if (!val) return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (Object.prototype.toString.call(val) === '[object Date]') {
    if (isNaN(val.getTime())) return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var str = val.toString().trim();
  var brMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (brMatch) {
    str = brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1];
  }
  var d = new Date(str);
  if (isNaN(d.getTime())) d = new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}


/**
 * Uses Gemini AI to extract line items from a receipt image.
 */
function analyzeReceiptAI(base64Image) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return { success: false, message: 'GEMINI_API_KEY is not set in Script Properties. Please follow the implementation guide.' };
    }
    
    var base64Data = base64Image;
    var mimeType = "image/jpeg";
    if (base64Image.indexOf(',') !== -1) {
      var parts = base64Image.split(',');
      var match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      base64Data = parts[1];
    }
    
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey;
    
    var prompt = "Analyze this receipt image. Extract each individual line item purchased. Do NOT include taxes, tips, or subtotals as items. For each item, provide a short description, assign an exact category (must be exactly one of: 'Supplies', 'Rent', 'Utilities', 'Salaries', 'Other'), and the numerical price. Return the result strictly as a valid JSON array of objects, with each object having keys: 'description', 'category', 'amount'. Do not include markdown formatting or backticks around the JSON.";
    
    var payload = {
      "contents": [
        {
          "parts": [
            { "text": prompt },
            {
              "inline_data": {
                "mime_type": mimeType,
                "data": base64Data
              }
            }
          ]
        }
      ],
      "generationConfig": {
        "temperature": 0.1
      }
    };
    
    var options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());
    
    if (json.error) {
      return { success: false, message: 'Gemini API Error: ' + json.error.message };
    }
    
    var rawText = json.candidates[0].content.parts[0].text;
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    try {
      var parsedItems = JSON.parse(rawText);
      return { success: true, items: parsedItems };
    } catch(err) {
      return { success: false, message: 'AI returned malformed JSON: ' + rawText };
    }
  } catch(e) {
    return { success: false, message: 'AI Analysis Failed: ' + e.message };
  }
}


/**
 * Uses Gemini AI to extract Z-Report totals from a POS receipt.
 */
function analyzeZReportAI(base64Image) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return { success: false, message: 'GEMINI_API_KEY is not set in Script Properties.' };
    }
    
    var base64Data = base64Image;
    var mimeType = "image/jpeg";
    if (base64Image.indexOf(',') !== -1) {
      var parts = base64Image.split(',');
      var match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      base64Data = parts[1];
    }
    
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey;
    
    var prompt = "Analyze this Point of Sale (POS) batch settlement receipt (Z-Report). Look for the following totals across the machine's summary: Total Credit/Debit Card Sales, Total PIX Sales, Total Cash Sales, and any explicit Taxes or Processing Fees printed on the slip. Do NOT confuse PIX with normal Debit. Return the result strictly as a valid JSON object with the following keys mapped to their numerical values (no currency symbols): 'card', 'pix', 'cash', 'fee'. If a value is missing, return 0. Do not include markdown formatting or backticks.";
    
    var payload = {
      "contents": [
        {
          "parts": [
            { "text": prompt },
            {
              "inline_data": {
                "mime_type": mimeType,
                "data": base64Data
              }
            }
          ]
        }
      ],
      "generationConfig": {
        "temperature": 0.1
      }
    };
    
    var options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());
    
    if (json.error) {
      return { success: false, message: 'Gemini API Error: ' + json.error.message };
    }
    
    var rawText = json.candidates[0].content.parts[0].text;
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    try {
      var parsedData = JSON.parse(rawText);
      return { success: true, data: parsedData };
    } catch(err) {
      return { success: false, message: 'AI returned malformed JSON: ' + rawText };
    }
  } catch(e) {
    return { success: false, message: 'AI Analysis Failed: ' + e.message };
  }
}

/**
 * Automates logging of salary expenses based on PayFrequency setting.
 * Meant to be run on a Time-Driven Trigger daily.
 */
function runAutomatedPayroll() {
  var roster = getTeamMembers();
  if (!roster || roster.length === 0) return;
  
  var today = new Date();
  var dayOfWeek = today.getDay();   // 0 = Sunday … 6 = Saturday
  var dateOfMonth = today.getDate(); // 1–31
  var formattedToday = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var nowTimestamp = new Date(); // for col 9
  
  var ss = getSpreadsheet();
  var expSheet = getOrCreateSheet(ss, 'Expenses');
  
  // ── Duplicate guard: load last 30 rows to check ───────────────────────────
  var lastRow = expSheet.getLastRow();
  var recentKeys = {};
  if (lastRow > 1) {
    var lookback = Math.min(30, lastRow - 1);
    var recentRows = expSheet.getRange(lastRow - lookback + 1, 1, lookback, 3).getValues();
    recentRows.forEach(function(r) {
      // Key = date|submitter|store
      recentKeys[r[0] + '|' + r[2] + '|' + r[1]] = true;
    });
  }
  
  var expensesLogged = 0;
  
  for (var i = 0; i < roster.length; i++) {
    var member = roster[i];
    if (!member.salary || member.salary <= 0) continue;
    
    var freq = (member.payFrequency || '').trim().toLowerCase();
    var isPayday = false;
    
    // payDay: for Weekly = day-of-week (0–6), for Monthly = date-of-month (1–28)
    // null / '' means use defaults (Friday for weekly, 1st for monthly)
    var configuredDay = (member.payDay !== null && member.payDay !== undefined && member.payDay !== '')
      ? parseInt(member.payDay, 10) : null;
    
    if (freq === 'daily') {
      isPayday = true;
    } else if (freq === 'weekly') {
      var targetWeekDay = (configuredDay !== null) ? configuredDay : 5; // default Friday
      if (dayOfWeek === targetWeekDay) isPayday = true;
    } else if (freq === 'monthly') {
      var targetDate = (configuredDay !== null) ? configuredDay : 1; // default 1st
      if (dateOfMonth === targetDate) isPayday = true;
    }
    
    if (!isPayday) continue;
    
    // ── Duplicate check ──────────────────────────────────────────────────────
    var dupeKey = formattedToday + '|' + member.name + '|' + (member.storeAssignment || 'All Stores');
    if (recentKeys[dupeKey]) {
      Logger.log('Skipping duplicate payroll entry for ' + member.name + ' on ' + formattedToday);
      continue;
    }
    
    // ── Append expense row (correct column order matches saveExpense) ─────────
    // Col: Date | Store | Submitter | Category | Amount | Payment Method | Description | Receipt | Timestamp
    expSheet.appendRow([
      formattedToday,                                          // 1. Date
      member.storeAssignment || 'All Stores',                  // 2. Store  ← fixed
      member.name,                                             // 3. Submitter ← fixed (employee name)
      'Salaries',                                              // 4. Category
      member.salary,                                           // 5. Amount
      'Bank Transfer',                                         // 6. Payment Method
      'Auto-Pay (' + member.payFrequency + '): ' + member.name, // 7. Description
      '',                                                      // 8. Receipt Link
      nowTimestamp                                             // 9. Timestamp ← added
    ]);
    
    recentKeys[dupeKey] = true; // prevent same member double-logging in one run
    expensesLogged++;
  }
  
  Logger.log('Automated Payroll Run Complete. Logged ' + expensesLogged + ' expense(s) for ' + formattedToday + '.');
}

/**
 * Installs the daily trigger for automated payroll.
 */
function setupPayrollTrigger() {
  // First, delete any existing trigger for this function to prevent duplicates
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runAutomatedPayroll') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // Create a new daily trigger (runs around 1 AM)
  ScriptApp.newTrigger('runAutomatedPayroll')
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .create();
    
  Logger.log('Payroll Trigger installed successfully.');
}
