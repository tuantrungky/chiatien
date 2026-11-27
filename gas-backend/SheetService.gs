/**
 * SheetService.gs
 * Định nghĩa Schema 11 tabs Google Sheets, setupDatabase() (kèm migration & format Plain text),
 * hóa đơn tháng cầu lông, tách biệt công nợ Cầu lông / Ăn nhậu góp món, Lịch tháng và CacheService.
 */

var SHEET_SCHEMA = {
  Members: [
    'member_id',
    'name',
    'aliases',
    'type',
    'phone',
    'bank_bin',
    'bank_name',
    'account_no',
    'account_name',
    'is_active',
    'created_at',
    'updated_at',
    'email'
  ],
  Sessions: [
    'session_id',
    'date',
    'type',
    'title',
    'total_amount',
    'guest_fee',
    'payer_id',
    'per_person_amount',
    'attendee_count',
    'receipt_drive_id',
    'receipt_url',
    'receipt_summary',
    'note',
    'court_amount',
    'shuttle_qty',
    'shuttle_amount',
    'other_amount',
    'cost_detail',
    'venue_type',
    'plan_id',
    'billing_mode',
    'created_by',
    'created_at',
    'updated_at'
  ],
  Attendance: [
    'attendance_id',
    'session_id',
    'session_date',
    'session_type',
    'member_id',
    'member_type_snapshot',
    'fee_amount',
    'creditor_id',
    'contributed_amount',
    'net_amount',
    'is_paid',
    'paid_at',
    'settlement_id',
    'note'
  ],
  Fund_Ledger: [
    'ledger_id',
    'date',
    'type',
    'category',
    'amount',
    'member_id',
    'session_id',
    'attendance_id',
    'period',
    'is_paid',
    'paid_at',
    'settlement_id',
    'receipt_drive_id',
    'receipt_url',
    'description',
    'created_by',
    'created_at'
  ],
  Settlements: [
    'settlement_id',
    'from_member_id',
    'to_member_id',
    'amount',
    'settled_at',
    'method',
    'category',
    'source_attendance_ids',
    'source_ledger_ids',
    'is_reconciled',
    'transfer_content',
    'note',
    'confirmed_by'
  ],
  Settings: [
    'key',
    'value',
    'description',
    'updated_at',
    'updated_by'
  ],
  Editors: [
    'email',
    'name',
    'role',
    'is_active',
    'added_at'
  ],
  Schedule: [
    'plan_id',
    'date',
    'start_time',
    'end_time',
    'courts',
    'planned_member_ids',
    'status',
    'session_id',
    'note',
    'created_at',
    'updated_at'
  ],
  Monthly_Bills: [
    'month',
    'estimate',
    'carry_in',
    'to_collect',
    'member_count',
    'per_member',
    'billed_total',
    'actual_cost',
    'actual_cost_override',
    'guest_income',
    'carry_out',
    'status',
    'created_by',
    'closed_at',
    'updated_at',
    'court_fee',
    'shuttle_tube_qty',
    'shuttle_tube_price',
    'shuttle_tube_amount',
    'prev_overtime_fee',
    'bill_detail',
    'shuttle_contributions',
    'applied_credits_total',
    'carry_over_credits'
  ],
  Monthly_Dues: [
    'due_id',
    'month',
    'member_id',
    'amount',
    'is_paid',
    'paid_at',
    'confirmed_by',
    'base_amount',
    'credit_amount',
    'credit_note'
  ],
  Session_Items: [
    'item_id',
    'session_id',
    'member_id',
    'kind',
    'item_name',
    'amount'
  ]
};

var TEXT_COLUMNS = {
  date: true,
  session_date: true,
  phone: true,
  account_no: true,
  bank_bin: true,
  period: true,
  month: true,
  start_time: true,
  end_time: true,
  billing_mode: true,
  email: true
};

var DEFAULT_SETTINGS_ROWS = [
  {
    key: 'guest_fee',
    value: '50000',
    description: 'Phí vãng lai mặc định mỗi buổi cầu lông (VND)'
  },
  {
    key: 'court_price_per_hour',
    value: '0',
    description: 'Giá thuê 1 sân / 1 giờ mặc định (VND)'
  },
  {
    key: 'shuttle_price',
    value: '0',
    description: 'Giá 1 quả cầu mặc định (VND)'
  },
  {
    key: 'default_court_count',
    value: '2',
    description: 'Số sân mặc định mỗi buổi'
  },
  {
    key: 'default_play_hours',
    value: '1.5',
    description: 'Số giờ chơi mặc định mỗi buổi'
  },
  {
    key: 'drive_folder_id',
    value: '',
    description: 'ID thư mục gốc Google Drive lưu ảnh hóa đơn theo tháng YYYY-MM'
  },
  {
    key: 'club_name',
    value: 'CLB Cầu Lông & Nhậu',
    description: 'Tên câu lạc bộ hiển thị trên Web App'
  },
  {
    key: 'treasurer_member_id',
    value: '',
    description: 'member_id của Thủ quỹ (người giữ tiền và nhận chuyển khoản cầu lông mặc định)'
  },
  {
    key: 'rounding_unit',
    value: '1000',
    description: 'Bội số làm tròn khi chia tiền (VND)'
  },
  {
    key: 'vietqr_template',
    value: 'compact2',
    description: 'Template ảnh VietQR (compact, compact2, qr_only, print)'
  },
  {
    key: 'transfer_prefix',
    value: 'CLN',
    description: 'Tiền tố nội dung chuyển khoản VietQR'
  }
];

/**
 * Hàm khởi tạo & nâng cấp Database 1 chạm (Idempotent + Migration an toàn):
 * - Tạo đủ 11 tabs nếu chưa có
 * - Bổ sung các cột mới vào cuối Row 1 nếu tab cũ đã tồn tại (không mất dữ liệu)
 * - Đặt định dạng Plain Text ('@') cho SĐT, STK, BIN, ngày/tháng/giờ
 * - Đóng băng dòng 1 và chèn Settings mặc định còn thiếu
 */
function setupDatabase() {
  var ss = getSpreadsheet_();
  var now = nowIso_();
  var createdTabs = [];
  var migratedColumns = {};
  var initializedSettings = [];

  var tabNames = Object.keys(SHEET_SCHEMA);
  for (var i = 0; i < tabNames.length; i++) {
    var tabName = tabNames[i];
    var expectedHeaders = SHEET_SCHEMA[tabName];
    var sheet = ss.getSheetByName(tabName);

    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      createdTabs.push(tabName);
    }

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
      var headerRange = sheet.getRange(1, 1, 1, expectedHeaders.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#0f172a');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    } else {
      if (sheet.getFrozenRows() < 1) {
        sheet.setFrozenRows(1);
      }
      var lastCol = Math.max(sheet.getLastColumn(), 1);
      var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var existingHeaderMap = {};
      for (var c = 0; c < currentHeaders.length; c++) {
        var hName = String(currentHeaders[c] || '').trim();
        if (hName) existingHeaderMap[hName] = true;
      }
      var addedCols = [];
      for (var eh = 0; eh < expectedHeaders.length; eh++) {
        if (!existingHeaderMap[expectedHeaders[eh]]) {
          addedCols.push(expectedHeaders[eh]);
        }
      }
      if (addedCols.length > 0) {
        var startCol = currentHeaders.length + 1;
        var addRange = sheet.getRange(1, startCol, 1, addedCols.length);
        addRange.setValues([addedCols]);
        addRange.setFontWeight('bold');
        addRange.setBackground('#0f172a');
        addRange.setFontColor('#ffffff');
        migratedColumns[tabName] = addedCols;
      }
    }

    // Đặt định dạng Plain Text ('@') cho toàn bộ cột TEXT_COLUMNS để không mất số 0 đầu
    applyTextFormatToSheet_(sheet, tabName);
  }

  // Thêm các cấu hình mặc định còn thiếu vào tab Settings
  var existingSettings = getSheetObjects_('Settings');
  var existingKeyMap = {};
  for (var j = 0; j < existingSettings.length; j++) {
    var k = String(existingSettings[j].key || '').trim();
    if (k) existingKeyMap[k] = true;
  }

  var rowsToInsert = [];
  for (var m = 0; m < DEFAULT_SETTINGS_ROWS.length; m++) {
    var def = DEFAULT_SETTINGS_ROWS[m];
    if (!existingKeyMap[def.key]) {
      rowsToInsert.push({
        key: def.key,
        value: def.value,
        description: def.description,
        updated_at: now,
        updated_by: 'setupDatabase'
      });
      initializedSettings.push(def.key);
    }
  }
  if (rowsToInsert.length > 0) {
    appendObjects_('Settings', rowsToInsert);
  }

  // Kiểm tra tab thừa (chỉ cảnh báo, không tự xóa)
  var allSheets = ss.getSheets();
  var extraTabs = [];
  for (var sIdx = 0; sIdx < allSheets.length; sIdx++) {
    var sName = allSheets[sIdx].getName();
    if (!SHEET_SCHEMA[sName]) {
      extraTabs.push(sName);
    }
  }

  bumpCacheVersion_();

  var summary = {
    ok: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    createdTabs: createdTabs,
    migratedColumns: migratedColumns,
    initializedSettings: initializedSettings,
    extraTabsWarning: extraTabs.length > 0
      ? 'Phát hiện tab không thuộc schema (có thể xóa thủ công nếu thừa): ' + extraTabs.join(', ')
      : ''
  };
  Logger.log(JSON.stringify(summary));
  return summary;
}

function applyTextFormatToSheet_(sheet, sheetName) {
  var headers = getSheetHeaders_(sheet, sheetName);
  var numRows = Math.max(sheet.getMaxRows() - 1, 1);
  for (var c = 0; c < headers.length; c++) {
    if (TEXT_COLUMNS[headers[c]]) {
      sheet.getRange(2, c + 1, numRows, 1).setNumberFormat('@');
    }
  }
}

// ============================================================================
// CORE HELPERS & CACHESERVICE
// ============================================================================

function getCacheVersion_() {
  try {
    var cache = CacheService.getScriptCache();
    var ver = cache.get('cln_cache_ver');
    if (!ver) {
      ver = String(Date.now());
      cache.put('cln_cache_ver', ver, 21600);
    }
    return ver;
  } catch (e) {
    return '0';
  }
}

function bumpCacheVersion_() {
  try {
    CacheService.getScriptCache().put('cln_cache_ver', String(Date.now()), 21600);
  } catch (e) {
    // Ignore cache failure
  }
}

function createAppError_(code, message) {
  var err = new Error(message);
  err.code = code || 'INTERNAL_ERROR';
  return err;
}

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var ssId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  if (ssId) {
    return SpreadsheetApp.openById(ssId);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw createAppError_(
      'INTERNAL_ERROR',
      'Không tìm thấy Spreadsheet. Hãy gắn script vào Google Sheet hoặc cấu hình Script Property SPREADSHEET_ID.'
    );
  }
  return active;
}

function getRequiredSheet_(sheetName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw createAppError_(
      'INTERNAL_ERROR',
      'Chưa có tab "' + sheetName + '". Hãy chạy hàm setupDatabase() trong Google Apps Script trước.'
    );
  }
  return sheet;
}

function normalizeCellValue_(key, cellVal) {
  if (cellVal instanceof Date) {
    if (key === 'date' || key === 'session_date') {
      return Utilities.formatDate(cellVal, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    }
    if (key === 'start_time' || key === 'end_time') {
      return Utilities.formatDate(cellVal, 'Asia/Ho_Chi_Minh', 'HH:mm');
    }
    if (key === 'month' || key === 'period') {
      return Utilities.formatDate(cellVal, 'Asia/Ho_Chi_Minh', 'yyyy-MM');
    }
    return Utilities.formatDate(cellVal, 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }

  // Khắc phục trường hợp ô text-số cũ bị Sheets lưu dạng number (970436.0, 6.1001146396E10)
  if (typeof cellVal === 'number' && (key === 'bank_bin' || key === 'account_no' || key === 'phone')) {
    var s = Math.round(cellVal).toString();
    // Nếu SĐT Việt Nam bị mất số 0 đầu (còn 9 chữ số bắt đầu bằng 3/5/7/8/9) -> khôi phục số 0
    if (key === 'phone' && s.length === 9 && /^[35789]/.test(s)) {
      return '0' + s;
    }
    return s;
  }

  if (typeof cellVal === 'string' && (key === 'bank_bin' || key === 'account_no' || key === 'phone')) {
    var trimmed = cellVal.trim();
    if (/^\d+\.0+$/.test(trimmed)) {
      return trimmed.replace(/\.0+$/, '');
    }
    return trimmed;
  }

  return cellVal;
}

var _SHEET_CACHE_ = null;

function beginSheetCache_() {
  _SHEET_CACHE_ = {};
}

function endSheetCache_() {
  _SHEET_CACHE_ = null;
}

function invalidateSheetCache_(sheetName) {
  if (_SHEET_CACHE_ && sheetName) {
    delete _SHEET_CACHE_[sheetName];
  }
}

function getSheetObjects_(sheetName) {
  if (_SHEET_CACHE_ && _SHEET_CACHE_[sheetName]) {
    return _SHEET_CACHE_[sheetName].map(function (row) {
      var copy = {};
      var keys = Object.keys(row);
      for (var k = 0; k < keys.length; k++) {
        copy[keys[k]] = row[keys[k]];
      }
      return copy;
    });
  }

  var sheet = getRequiredSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) {
    if (_SHEET_CACHE_) _SHEET_CACHE_[sheetName] = [];
    return [];
  }

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  var results = [];

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var hasValue = false;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c] || '').trim();
      if (!key) continue;
      var cellVal = normalizeCellValue_(key, row[c]);
      if (cellVal !== '' && cellVal !== null && cellVal !== undefined) {
        hasValue = true;
      }
      obj[key] = cellVal;
    }
    if (hasValue) {
      results.push(obj);
    }
  }
  if (_SHEET_CACHE_) {
    _SHEET_CACHE_[sheetName] = results;
    return results.map(function (row) {
      var copy = {};
      var keys = Object.keys(row);
      for (var k = 0; k < keys.length; k++) {
        copy[keys[k]] = row[keys[k]];
      }
      return copy;
    });
  }
  return results;
}

function appendObjects_(sheetName, objects) {
  if (!objects || objects.length === 0) return;
  var sheet = getRequiredSheet_(sheetName);
  var headers = getSheetHeaders_(sheet, sheetName);

  var rows = [];
  for (var i = 0; i < objects.length; i++) {
    var obj = objects[i];
    var row = [];
    for (var c = 0; c < headers.length; c++) {
      var h = headers[c];
      var val = obj[h] !== undefined && obj[h] !== null ? obj[h] : '';
      row.push(val);
    }
    rows.push(row);
  }

  var startRow = Math.max(sheet.getLastRow() + 1, 2);
  var targetRange = sheet.getRange(startRow, 1, rows.length, headers.length);
  for (var col = 0; col < headers.length; col++) {
    if (TEXT_COLUMNS[headers[col]]) {
      sheet.getRange(startRow, col + 1, rows.length, 1).setNumberFormat('@');
    }
  }
  targetRange.setValues(rows);
  invalidateSheetCache_(sheetName);
}

function updateRowsByCondition_(sheetName, predicate, updater) {
  var sheet = getRequiredSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return 0;

  var range = sheet.getRange(1, 1, lastRow, lastCol);
  var values = range.getValues();
  var headers = values[0];
  var updatedCount = 0;

  for (var r = 1; r < values.length; r++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c] || '').trim();
      if (!key) continue;
      obj[key] = normalizeCellValue_(key, values[r][c]);
    }

    if (predicate(obj)) {
      var nextObj = updater(obj) || obj;
      for (var c2 = 0; c2 < headers.length; c2++) {
        var h = String(headers[c2] || '').trim();
        if (!h) continue;
        values[r][c2] = nextObj[h] !== undefined && nextObj[h] !== null ? nextObj[h] : '';
      }
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    for (var col = 0; col < headers.length; col++) {
      var hName = String(headers[col] || '').trim();
      if (TEXT_COLUMNS[hName]) {
        sheet.getRange(2, col + 1, lastRow - 1, 1).setNumberFormat('@');
      }
    }
    range.setValues(values);
    invalidateSheetCache_(sheetName);
  }
  return updatedCount;
}

function deleteRowsByCondition_(sheetName, predicate) {
  var sheet = getRequiredSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return 0;

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  var deletedCount = 0;

  for (var r = values.length - 1; r >= 1; r--) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c] || '').trim();
      if (!key) continue;
      obj[key] = normalizeCellValue_(key, values[r][c]);
    }
    if (predicate(obj)) {
      sheet.deleteRow(r + 1);
      deletedCount++;
    }
  }
  if (deletedCount > 0) invalidateSheetCache_(sheetName);
  return deletedCount;
}

function getSheetHeaders_(sheet, sheetName) {
  var lastCol = sheet.getLastColumn();
  if (lastCol > 0 && sheet.getLastRow() >= 1) {
    var row1 = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var clean = [];
    for (var i = 0; i < row1.length; i++) {
      clean.push(String(row1[i] || '').trim());
    }
    return clean;
  }
  return SHEET_SCHEMA[sheetName] || [];
}

function nowIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function todayDateStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
}

function nowTimeVN_() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'HH:mm');
}

function generateId_(prefix) {
  var datePart = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyyMMdd_HHmmss');
  var randPart = Math.floor(1000 + Math.random() * 9000);
  return prefix + '_' + datePart + '_' + randPart;
}

function toBoolean_(val) {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') {
    var s = val.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}

function toInt_(val, fallback) {
  var n = Number(val);
  if (isNaN(n)) return fallback !== undefined ? fallback : 0;
  return Math.round(n);
}

function toFloat_(val, fallback) {
  var n = Number(val);
  if (isNaN(n)) return fallback !== undefined ? fallback : 0;
  return n;
}

function stripVietnameseDiacritics_(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildVietQrUrl_(toMember, amount, transferContent, template) {
  if (!toMember) return null;
  var bankBin = String(toMember.bank_bin || '').trim();
  var accountNo = String(toMember.account_no || '').trim();
  if (!bankBin || !accountNo) return null;

  var tpl = String(template || 'compact2').trim() || 'compact2';
  var accountName = String(toMember.account_name || stripVietnameseDiacritics_(toMember.name)).toUpperCase();
  var cleanContent = stripVietnameseDiacritics_(transferContent).slice(0, 50);

  return 'https://img.vietqr.io/image/' +
    encodeURIComponent(bankBin) + '-' +
    encodeURIComponent(accountNo) + '-' +
    encodeURIComponent(tpl) + '.png' +
    '?amount=' + Math.round(Number(amount) || 0) +
    '&addInfo=' + encodeURIComponent(cleanContent) +
    '&accountName=' + encodeURIComponent(accountName);
}

function getPeriodRange_(periodType, refDateStr) {
  var type = String(periodType || 'MONTH').trim().toUpperCase();
  var refStr = (refDateStr && /^\d{4}-\d{2}-\d{2}$/.test(refDateStr)) ? refDateStr : todayDateStr_();

  if (type === 'ALL') {
    return { type: 'ALL', startDate: null, endDate: null, label: 'Tất cả thời gian' };
  }

  var parts = refStr.split('-');
  var year = Number(parts[0]);
  var month = Number(parts[1]);
  var day = Number(parts[2]);

  var pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
  var fmt = function (d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  };

  if (type === 'WEEK') {
    var d = new Date(year, month - 1, day);
    var jsDay = d.getDay();
    var diffToMon = jsDay === 0 ? -6 : (1 - jsDay);
    var monday = new Date(year, month - 1, day + diffToMon);
    var sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return {
      type: 'WEEK',
      startDate: fmt(monday),
      endDate: fmt(sunday),
      label: 'Tuần ' + pad2(monday.getDate()) + '/' + pad2(monday.getMonth() + 1) +
        ' - ' + pad2(sunday.getDate()) + '/' + pad2(sunday.getMonth() + 1)
    };
  }

  if (type === 'QUARTER') {
    var q = Math.floor((month - 1) / 3) + 1;
    var startM = (q - 1) * 3 + 1;
    var endM = q * 3;
    var lastDayQ = new Date(year, endM, 0).getDate();
    return {
      type: 'QUARTER',
      startDate: year + '-' + pad2(startM) + '-01',
      endDate: year + '-' + pad2(endM) + '-' + pad2(lastDayQ),
      label: 'Quý ' + q + '/' + year
    };
  }

  if (type === 'YEAR') {
    return {
      type: 'YEAR',
      startDate: year + '-01-01',
      endDate: year + '-12-31',
      label: 'Năm ' + year
    };
  }

  var lastDayM = new Date(year, month, 0).getDate();
  return {
    type: 'MONTH',
    startDate: year + '-' + pad2(month) + '-01',
    endDate: year + '-' + pad2(month) + '-' + pad2(lastDayM),
    label: 'Tháng ' + pad2(month) + '/' + year
  };
}

function prevMonthStr_(monthStr) {
  var parts = monthStr.split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var d = new Date(y, m - 2, 1);
  var mm = d.getMonth() + 1;
  return d.getFullYear() + '-' + (mm < 10 ? '0' + mm : String(mm));
}

function durationHours_(startTime, endTime) {
  var parseMin = function (t) {
    var m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  var s = parseMin(startTime);
  var e = parseMin(endTime);
  if (s === null || e === null || e <= s) return 0;
  return Math.round(((e - s) / 60) * 100) / 100;
}

// ============================================================================
// PUBLIC READ SERVICES (Viewer)
// ============================================================================

function getSettingsMap() {
  var rows = getSheetObjects_('Settings');
  var raw = {};
  for (var i = 0; i < rows.length; i++) {
    var k = String(rows[i].key || '').trim();
    if (k) {
      raw[k] = rows[i].value !== undefined && rows[i].value !== null ? String(rows[i].value) : '';
    }
  }

  var guestFee = toInt_(raw.guest_fee !== undefined ? raw.guest_fee : raw.default_guest_fee, 50000);
  var courtPrice = toInt_(raw.court_price_per_hour, 0);
  var shuttlePrice = toInt_(raw.shuttle_price, 0);
  var defaultCourts = toInt_(raw.default_court_count, 2);
  var defaultHours = toFloat_(raw.default_play_hours, 1.5);

  return {
    club_name: raw.club_name || 'CLB Cầu Lông & Nhậu',
    treasurer_member_id: String(raw.treasurer_member_id || '').trim(),
    guest_fee: guestFee,
    default_guest_fee: guestFee,
    court_price_per_hour: courtPrice,
    shuttle_price: shuttlePrice,
    default_court_count: defaultCourts,
    default_play_hours: defaultHours,
    drive_folder_id: String(raw.drive_folder_id || '').trim(),
    rounding_unit: Math.max(1, toInt_(raw.rounding_unit, 1000)),
    vietqr_template: raw.vietqr_template || 'compact2',
    transfer_prefix: raw.transfer_prefix || 'CLN',
    raw: rows
  };
}

function getMembersList(activeOnly) {
  var rows = getSheetObjects_('Members');
  var list = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var isActive = toBoolean_(r.is_active);
    if (activeOnly && !isActive) continue;
    list.push({
      member_id: String(r.member_id || '').trim(),
      name: String(r.name || '').trim(),
      aliases: String(r.aliases || '').trim(),
      type: String(r.type || 'MAIN').trim().toUpperCase(),
      phone: String(r.phone || '').trim(),
      bank_bin: String(r.bank_bin || '').trim(),
      bank_name: String(r.bank_name || '').trim(),
      account_no: String(r.account_no || '').trim(),
      account_name: String(r.account_name || '').trim(),
      email: String(r.email || '').trim().toLowerCase(),
      is_active: isActive,
      created_at: String(r.created_at || ''),
      updated_at: String(r.updated_at || '')
    });
  }
  return list;
}

function getSessionsList(filters) {
  var f = filters || {};
  var typeFilter = String(f.type || f.category || 'ALL').trim().toUpperCase();
  var startDate = f.startDate ? String(f.startDate).trim() : null;
  var endDate = f.endDate ? String(f.endDate).trim() : null;

  var rows = getSheetObjects_('Sessions');
  var membersMap = buildMembersMap_(getMembersList(false));
  var result = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var sType = String(r.type || '').trim().toUpperCase();
    var sDate = String(r.date || '').trim();

    if (typeFilter !== 'ALL' && sType !== typeFilter) continue;
    if (startDate && sDate < startDate) continue;
    if (endDate && sDate > endDate) continue;

    var payerId = String(r.payer_id || '').trim();
    result.push({
      session_id: String(r.session_id || '').trim(),
      date: sDate,
      type: sType,
      title: String(r.title || '').trim(),
      total_amount: toInt_(r.total_amount, 0),
      guest_fee: toInt_(r.guest_fee, 0),
      payer_id: payerId,
      payer_name: membersMap[payerId] ? membersMap[payerId].name : '',
      per_person_amount: toInt_(r.per_person_amount, 0),
      attendee_count: toInt_(r.attendee_count, 0),
      receipt_drive_id: String(r.receipt_drive_id || '').trim(),
      receipt_url: String(r.receipt_url || '').trim(),
      receipt_summary: String(r.receipt_summary || '').trim(),
      note: String(r.note || '').trim(),
      court_amount: toInt_(r.court_amount, 0),
      shuttle_qty: toInt_(r.shuttle_qty, 0),
      shuttle_amount: toInt_(r.shuttle_amount, 0),
      other_amount: toInt_(r.other_amount, 0),
      cost_detail: String(r.cost_detail || '').trim(),
      venue_type: String(r.venue_type || '').trim(),
      plan_id: String(r.plan_id || '').trim(),
      billing_mode: sType === 'BADMINTON'
        ? (String(r.billing_mode || 'MONTHLY').trim().toUpperCase() === 'AD_HOC' ? 'AD_HOC' : 'MONTHLY')
        : '',
      created_by: String(r.created_by || '').trim(),
      created_at: String(r.created_at || ''),
      updated_at: String(r.updated_at || '')
    });
  }

  result.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.created_at < b.created_at ? 1 : -1;
  });

  return result;
}

function getSessionDetail(sessionId) {
  var id = String(sessionId || '').trim();
  if (!id) {
    throw createAppError_('BAD_REQUEST', 'Thiếu tham số sessionId.');
  }

  var sessions = getSessionsList({});
  var target = null;
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].session_id === id) {
      target = sessions[i];
      break;
    }
  }
  if (!target) {
    throw createAppError_('NOT_FOUND', 'Không tìm thấy buổi ' + id);
  }

  var membersMap = buildMembersMap_(getMembersList(false));
  var attRows = getSheetObjects_('Attendance');
  var attendances = [];
  for (var j = 0; j < attRows.length; j++) {
    var a = attRows[j];
    if (String(a.session_id || '').trim() !== id) continue;
    var mId = String(a.member_id || '').trim();
    var cId = String(a.creditor_id || '').trim();
    attendances.push({
      attendance_id: String(a.attendance_id || '').trim(),
      session_id: id,
      session_date: String(a.session_date || '').trim(),
      session_type: String(a.session_type || '').trim().toUpperCase(),
      member_id: mId,
      member_name: membersMap[mId] ? membersMap[mId].name : mId,
      member_type_snapshot: String(a.member_type_snapshot || 'MAIN').trim().toUpperCase(),
      fee_amount: toInt_(a.fee_amount, 0),
      creditor_id: cId,
      creditor_name: membersMap[cId] ? membersMap[cId].name : cId,
      contributed_amount: toInt_(a.contributed_amount, 0),
      net_amount: toInt_(a.net_amount, 0),
      is_paid: toBoolean_(a.is_paid),
      paid_at: String(a.paid_at || ''),
      settlement_id: String(a.settlement_id || '').trim(),
      note: String(a.note || '').trim()
    });
  }

  var itemRows = getSheetObjects_('Session_Items');
  var items = [];
  for (var k = 0; k < itemRows.length; k++) {
    var it = itemRows[k];
    if (String(it.session_id || '').trim() !== id) continue;
    var imId = String(it.member_id || '').trim();
    items.push({
      item_id: String(it.item_id || '').trim(),
      session_id: id,
      member_id: imId,
      member_name: membersMap[imId] ? membersMap[imId].name : imId,
      kind: String(it.kind || 'ITEM').trim().toUpperCase(),
      item_name: String(it.item_name || '').trim(),
      amount: toInt_(it.amount, 0)
    });
  }

  return {
    session: target,
    attendances: attendances,
    items: items
  };
}

function getGuestStatsData(monthStr) {
  var targetMonth = (monthStr && /^\d{4}-\d{2}$/.test(monthStr.trim()))
    ? monthStr.trim()
    : todayDateStr_().slice(0, 7);

  var membersMap = buildMembersMap_(getMembersList(false));
  var badSessions = getSessionsList({ type: 'BADMINTON' });
  var adhocSessionSet = {};
  for (var bs = 0; bs < badSessions.length; bs++) {
    if (badSessions[bs].billing_mode === 'AD_HOC') {
      adhocSessionSet[badSessions[bs].session_id] = true;
    }
  }

  var attRows = getSheetObjects_('Attendance');
  var byGuest = {};

  var sumVisits = 0;
  var sumFee = 0;
  var sumPaid = 0;
  var sumUnpaid = 0;
  var collectedInMonthAmount = 0;

  for (var i = 0; i < attRows.length; i++) {
    var a = attRows[i];
    var sDate = String(a.session_date || '').trim();
    var mType = String(a.member_type_snapshot || '').trim().toUpperCase();
    var sType = String(a.session_type || '').trim().toUpperCase();
    var sId = String(a.session_id || '').trim();
    if (mType !== 'GUEST' || sType !== 'BADMINTON') continue;
    if (adhocSessionSet[sId]) continue;

    var fee = toInt_(a.fee_amount, 0);
    var isPaid = toBoolean_(a.is_paid);
    var paidAt = String(a.paid_at || '').trim();
    var paidRefMonth = (isPaid && paidAt) ? paidAt.slice(0, 7) : sDate.slice(0, 7);
    if (isPaid && paidRefMonth === targetMonth) {
      collectedInMonthAmount += fee;
    }

    if (sDate.slice(0, 7) !== targetMonth) continue;

    var mId = String(a.member_id || '').trim();

    if (!byGuest[mId]) {
      byGuest[mId] = {
        memberId: mId,
        name: membersMap[mId] ? membersMap[mId].name : mId,
        sessionCount: 0,
        dates: [],
        totalFee: 0,
        totalPaid: 0,
        totalUnpaid: 0,
        sessions: []
      };
    }

    var g = byGuest[mId];
    g.sessionCount += 1;
    if (g.dates.indexOf(sDate) === -1) g.dates.push(sDate);
    g.totalFee += fee;
    if (isPaid) {
      g.totalPaid += fee;
      sumPaid += fee;
    } else {
      g.totalUnpaid += fee;
      sumUnpaid += fee;
    }
    sumVisits += 1;
    sumFee += fee;

    g.sessions.push({
      attendanceId: String(a.attendance_id || '').trim(),
      sessionId: String(a.session_id || '').trim(),
      date: sDate,
      sessionType: sType,
      feeAmount: fee,
      isPaid: isPaid
    });
  }

  var guests = Object.keys(byGuest).map(function (k) {
    byGuest[k].dates.sort();
    byGuest[k].sessions.sort(function (x, y) { return x.date < y.date ? -1 : 1; });
    return byGuest[k];
  });

  guests.sort(function (a, b) {
    if (b.totalUnpaid !== a.totalUnpaid) return b.totalUnpaid - a.totalUnpaid;
    return b.sessionCount - a.sessionCount;
  });

  return {
    month: targetMonth,
    summary: {
      totalGuests: guests.length,
      totalVisits: sumVisits,
      totalFee: sumFee,
      totalPaid: sumPaid,
      totalUnpaid: sumUnpaid,
      collectedInMonthAmount: collectedInMonthAmount
    },
    guests: guests
  };
}

/**
 * Tách riêng công nợ Cầu lông (chuyển thẳng Thủ quỹ) và công nợ Ăn nhậu (tối ưu nội bộ nhóm nhậu).
 */
function computeDebtsData() {
  var settings = getSettingsMap();
  var treasurerId = settings.treasurer_member_id;
  var members = getMembersList(false);
  var membersMap = buildMembersMap_(members);
  var sessions = getSessionsList({});
  var sessionsMap = {};
  for (var si = 0; si < sessions.length; si++) {
    sessionsMap[sessions[si].session_id] = sessions[si];
  }

  var treasurer = membersMap[treasurerId] || null;
  var treasurerBank = (treasurer && treasurer.bank_bin && treasurer.account_no)
    ? {
        bankBin: treasurer.bank_bin,
        bankName: treasurer.bank_name,
        accountNo: treasurer.account_no,
        accountName: treasurer.account_name || treasurer.name
      }
    : null;

  // --- KHỐI 1: CẦU LÔNG (Monthly_Dues + Attendance GUEST BADMINTON chưa trả -> thẳng Thủ quỹ) ---
  var billRows = getSheetObjects_('Monthly_Bills');
  var billUpdatedAtByMonth = {};
  for (var bri = 0; bri < billRows.length; bri++) {
    var bm = String(billRows[bri].month || '').trim();
    if (bm) billUpdatedAtByMonth[bm] = String(billRows[bri].updated_at || '').trim();
  }

  var rawDues = getSheetObjects_('Monthly_Dues');
  var monthlyDues = [];
  var totalMonthlyUnpaid = 0;
  for (var di = 0; di < rawDues.length; di++) {
    var d = rawDues[di];
    if (toBoolean_(d.is_paid)) continue;
    var dAmt = toInt_(d.amount, 0);
    if (dAmt <= 0) continue;
    var dmId = String(d.member_id || '').trim();
    var dmName = membersMap[dmId] ? membersMap[dmId].name : dmId;
    var dMonth = String(d.month || '').trim();
    var dContent = stripVietnameseDiacritics_(
      settings.transfer_prefix + ' ' + dmName + ' cau T' + dMonth.slice(5, 7)
    ).slice(0, 50);

    totalMonthlyUnpaid += dAmt;
    monthlyDues.push({
      due_id: String(d.due_id || '').trim(),
      month: dMonth,
      member_id: dmId,
      member_name: dmName,
      amount: dAmt,
      base_amount: toInt_(d.base_amount, dAmt),
      credit_amount: toInt_(d.credit_amount, 0),
      credit_note: String(d.credit_note || '').trim(),
      issued_at: billUpdatedAtByMonth[dMonth] ? billUpdatedAtByMonth[dMonth].slice(0, 10) : (dMonth + '-01'),
      is_paid: false,
      paid_at: '',
      transferContent: dContent,
      vietQrUrl: buildVietQrUrl_(treasurer, dAmt, dContent, settings.vietqr_template)
    });
  }

  var attRows = getSheetObjects_('Attendance');
  var guestDues = [];
  var totalGuestUnpaid = 0;
  var adhocDues = [];
  var totalAdhocUnpaid = 0;
  var drinkingUnpaidAttendances = [];
  var drinkingNetMap = {};
  var drinkingAttsBySession = {};
  var edgeMap = {};
  var ensureDrinker = function (id) {
    if (id && drinkingNetMap[id] === undefined) drinkingNetMap[id] = 0;
  };
  var getEdge = function (fromId, toId) {
    return (edgeMap[fromId] && edgeMap[fromId][toId]) ? edgeMap[fromId][toId] : 0;
  };
  var setEdge = function (fromId, toId, val) {
    var rounded = Math.round(val);
    if (rounded <= 0) {
      if (edgeMap[fromId]) {
        delete edgeMap[fromId][toId];
        if (Object.keys(edgeMap[fromId]).length === 0) delete edgeMap[fromId];
      }
      return;
    }
    if (!edgeMap[fromId]) edgeMap[fromId] = {};
    edgeMap[fromId][toId] = rounded;
  };
  var addEdge = function (fromId, toId, delta) {
    if (!fromId || !toId || fromId === toId || delta <= 0) return;
    setEdge(fromId, toId, getEdge(fromId, toId) + delta);
  };
  var cancelOpposites = function () {
    var fromIds = Object.keys(edgeMap);
    for (var fi = 0; fi < fromIds.length; fi++) {
      var u = fromIds[fi];
      if (!edgeMap[u]) continue;
      var toIds = Object.keys(edgeMap[u]);
      for (var ti = 0; ti < toIds.length; ti++) {
        var v = toIds[ti];
        if (u < v && getEdge(v, u) > 0) {
          var wUV = getEdge(u, v);
          var wVU = getEdge(v, u);
          var m = Math.min(wUV, wVU);
          if (m > 0) {
            setEdge(u, v, wUV - m);
            setEdge(v, u, wVU - m);
          }
        }
      }
    }
  };

  for (var ai = 0; ai < attRows.length; ai++) {
    var a = attRows[ai];
    if (toBoolean_(a.is_paid)) continue;
    var sType = String(a.session_type || '').trim().toUpperCase();
    var mId = String(a.member_id || '').trim();

    if (sType === 'BADMINTON') {
      var bSessionId = String(a.session_id || '').trim();
      var gSession = sessionsMap[bSessionId];
      var isAdhoc = gSession && gSession.billing_mode === 'AD_HOC';
      var gFee = toInt_(a.fee_amount, 0);
      if (gFee <= 0) continue;

      var gName = membersMap[mId] ? membersMap[mId].name : mId;
      var sDate = String(a.session_date || '').trim();

      if (isAdhoc) {
        var adhocCreditorId = String(a.creditor_id || (gSession && gSession.payer_id) || treasurerId).trim();
        var adhocCreditor = membersMap[adhocCreditorId] || treasurer;
        var adhocCreditorBank = (adhocCreditor && adhocCreditor.bank_bin && adhocCreditor.account_no)
          ? {
              bankBin: adhocCreditor.bank_bin,
              bankName: adhocCreditor.bank_name,
              accountNo: adhocCreditor.account_no,
              accountName: adhocCreditor.account_name || adhocCreditor.name
            }
          : null;
        var aContent = stripVietnameseDiacritics_(
          settings.transfer_prefix + ' ' + gName + ' cau ps ' + sDate.slice(8, 10) + '/' + sDate.slice(5, 7)
        ).slice(0, 50);

        totalAdhocUnpaid += gFee;
        adhocDues.push({
          attendance_id: String(a.attendance_id || '').trim(),
          session_id: bSessionId,
          session_date: sDate,
          session_title: gSession ? gSession.title : 'Cầu lông phát sinh',
          member_id: mId,
          member_name: gName,
          member_type_snapshot: String(a.member_type_snapshot || 'MAIN').trim().toUpperCase(),
          creditor_id: adhocCreditorId,
          creditor_name: adhocCreditor ? adhocCreditor.name : adhocCreditorId,
          creditorBank: adhocCreditorBank,
          amount: gFee,
          transferContent: aContent,
          vietQrUrl: buildVietQrUrl_(adhocCreditor, gFee, aContent, settings.vietqr_template)
        });
        continue;
      }

      if (String(a.member_type_snapshot || '').toUpperCase() !== 'GUEST') continue;
      var gContent = stripVietnameseDiacritics_(
        settings.transfer_prefix + ' ' + gName + ' san ' + sDate.slice(8, 10) + '/' + sDate.slice(5, 7)
      ).slice(0, 50);

      totalGuestUnpaid += gFee;
      guestDues.push({
        attendance_id: String(a.attendance_id || '').trim(),
        session_id: bSessionId,
        session_date: sDate,
        session_title: gSession ? gSession.title : 'Cầu lông',
        member_id: mId,
        member_name: gName,
        amount: gFee,
        transferContent: gContent,
        vietQrUrl: buildVietQrUrl_(treasurer, gFee, gContent, settings.vietqr_template)
      });
      continue;
    }

    if (sType === 'DRINKING') {
      var dSid = String(a.session_id || '').trim();
      var rawNet = toInt_(a.net_amount, 0);
      var feeAmt = toInt_(a.fee_amount, 0);
      var contribAmt = toInt_(a.contributed_amount, 0);
      var cId = String(a.creditor_id || '').trim();

      if (!drinkingAttsBySession[dSid]) drinkingAttsBySession[dSid] = [];
      drinkingAttsBySession[dSid].push({
        memberId: mId,
        rawNet: rawNet,
        feeAmt: feeAmt,
        creditorId: cId
      });

      if (rawNet !== 0) {
        ensureDrinker(mId);
        // net_amount > 0: con nợ -> trừ vào drinkingNetMap; < 0: chủ nợ -> cộng
        drinkingNetMap[mId] -= rawNet;
      } else if (feeAmt > 0 && cId && cId !== mId) {
        // Tương thích ngược dữ liệu cũ
        ensureDrinker(mId);
        ensureDrinker(cId);
        drinkingNetMap[mId] -= feeAmt;
        drinkingNetMap[cId] += feeAmt;
      }

      drinkingUnpaidAttendances.push({
        attendance_id: String(a.attendance_id || '').trim(),
        session_id: dSid,
        session_date: String(a.session_date || '').trim(),
        session_type: 'DRINKING',
        member_id: mId,
        member_name: membersMap[mId] ? membersMap[mId].name : mId,
        member_type_snapshot: String(a.member_type_snapshot || 'MAIN').trim().toUpperCase(),
        fee_amount: feeAmt,
        creditor_id: cId,
        creditor_name: membersMap[cId] ? membersMap[cId].name : cId,
        contributed_amount: contribAmt,
        net_amount: rawNet !== 0 ? rawNet : feeAmt,
        is_paid: false,
        paid_at: '',
        settlement_id: '',
        note: String(a.note || '').trim()
      });
    }
  }

  // Bước 1: Ghép trực tiếp con nợ -> chủ nợ TRONG CÙNG TỪNG BUỔI NHẬU
  var residualDebtors = [];
  var residualCreditors = [];
  var dSessKeys = Object.keys(drinkingAttsBySession);
  for (var sk = 0; sk < dSessKeys.length; sk++) {
    var dSidKey = dSessKeys[sk];
    var sessAttList = drinkingAttsBySession[dSidKey];
    var sessRef = sessionsMap[dSidKey];
    var sDebtors = [];
    var sCreditors = [];

    for (var sai = 0; sai < sessAttList.length; sai++) {
      var sItem = sessAttList[sai];
      if (!sItem.memberId) continue;
      if (sItem.rawNet > 0) {
        sDebtors.push({ mId: sItem.memberId, remaining: sItem.rawNet });
      } else if (sItem.rawNet < 0) {
        sCreditors.push({ mId: sItem.memberId, remaining: -sItem.rawNet });
      } else {
        var legCredId = sItem.creditorId || (sessRef ? String(sessRef.payer_id || '').trim() : '');
        if (sItem.feeAmt > 0 && legCredId && legCredId !== sItem.memberId) {
          addEdge(sItem.memberId, legCredId, sItem.feeAmt);
        }
      }
    }

    sDebtors.sort(function (x, y) { return y.remaining !== x.remaining ? y.remaining - x.remaining : x.mId.localeCompare(y.mId); });
    sCreditors.sort(function (x, y) { return y.remaining !== x.remaining ? y.remaining - x.remaining : x.mId.localeCompare(y.mId); });

    var sDi = 0;
    var sCi = 0;
    while (sDi < sDebtors.length && sCi < sCreditors.length) {
      var sd = sDebtors[sDi];
      var sc = sCreditors[sCi];
      var matchAmt = Math.min(sd.remaining, sc.remaining);
      if (matchAmt > 0) {
        addEdge(sd.mId, sc.mId, matchAmt);
        sd.remaining -= matchAmt;
        sc.remaining -= matchAmt;
      }
      if (sd.remaining === 0) sDi++;
      if (sc.remaining === 0) sCi++;
    }

    for (var rdi = 0; rdi < sDebtors.length; rdi++) {
      if (sDebtors[rdi].remaining > 0) residualDebtors.push(sDebtors[rdi]);
    }
    for (var rci = 0; rci < sCreditors.length; rci++) {
      if (sCreditors[rci].remaining > 0) residualCreditors.push(sCreditors[rci]);
    }
  }

  if (residualDebtors.length > 0 && residualCreditors.length > 0) {
    residualDebtors.sort(function (x, y) { return y.remaining !== x.remaining ? y.remaining - x.remaining : x.mId.localeCompare(y.mId); });
    residualCreditors.sort(function (x, y) { return y.remaining !== x.remaining ? y.remaining - x.remaining : x.mId.localeCompare(y.mId); });
    var resDi = 0;
    var resCi = 0;
    while (resDi < residualDebtors.length && resCi < residualCreditors.length) {
      var rdItem = residualDebtors[resDi];
      var rcItem = residualCreditors[resCi];
      var resAmt = Math.min(rdItem.remaining, rcItem.remaining);
      if (resAmt > 0) {
        addEdge(rdItem.mId, rcItem.mId, resAmt);
        rdItem.remaining -= resAmt;
        rcItem.remaining -= resAmt;
      }
      if (rdItem.remaining === 0) resDi++;
      if (rcItem.remaining === 0) resCi++;
    }
  }

  // --- KHỐI 2: ĂN NHẬU (chỉ cấn trừ nội bộ nhóm nhậu) + Lịch sử gạch nợ Cầu lông ---
  var settlementRows = getSheetObjects_('Settlements');
  var recentDrinkingSettlements = [];
  var unreconciledDrinkingSettlements = [];
  var recentBadmintonSettlements = [];
  for (var ki = 0; ki < settlementRows.length; ki++) {
    var st = settlementRows[ki];
    var stCat = String(st.category || 'DRINKING').trim().toUpperCase();
    var fromId = String(st.from_member_id || '').trim();
    var toId = String(st.to_member_id || '').trim();
    var sAmt = toInt_(st.amount, 0);
    var isRec = toBoolean_(st.is_reconciled);

    var stObj = {
      settlement_id: String(st.settlement_id || '').trim(),
      from_member_id: fromId,
      from_name: membersMap[fromId] ? membersMap[fromId].name : fromId,
      to_member_id: toId,
      to_name: membersMap[toId] ? membersMap[toId].name : toId,
      amount: sAmt,
      settled_at: String(st.settled_at || ''),
      method: String(st.method || '').trim().toUpperCase(),
      category: stCat === 'BADMINTON' ? 'BADMINTON' : 'DRINKING',
      source_attendance_ids: String(st.source_attendance_ids || ''),
      source_ledger_ids: String(st.source_ledger_ids || ''),
      is_reconciled: isRec,
      transfer_content: String(st.transfer_content || '').trim(),
      note: String(st.note || '').trim(),
      confirmed_by: String(st.confirmed_by || '').trim()
    };

    if (stCat === 'BADMINTON') {
      recentBadmintonSettlements.push(stObj);
      continue;
    }

    if (!isRec && fromId && toId && fromId !== toId && sAmt > 0) {
      ensureDrinker(fromId);
      ensureDrinker(toId);
      drinkingNetMap[fromId] += sAmt;
      drinkingNetMap[toId] -= sAmt;

      var existingForward = getEdge(fromId, toId);
      if (existingForward >= sAmt) {
        setEdge(fromId, toId, existingForward - sAmt);
      } else {
        if (existingForward > 0) setEdge(fromId, toId, 0);
        addEdge(toId, fromId, sAmt - existingForward);
      }
    }
    if (!isRec) {
      unreconciledDrinkingSettlements.push(stObj);
    }
    recentDrinkingSettlements.push(stObj);
  }
  recentDrinkingSettlements.sort(function (a, b) {
    return a.settled_at < b.settled_at ? 1 : -1;
  });
  recentBadmintonSettlements.sort(function (a, b) {
    return a.settled_at < b.settled_at ? 1 : -1;
  });

  cancelOpposites();

  // Bước 3: Rút gọn dây chuyền bắc cầu A -> B -> C CHỈ khi B vừa nợ vừa được nhận
  for (var iter = 0; iter < 500; iter++) {
    var outNodes = Object.keys(edgeMap).sort();
    var reduced = false;
    for (var oni = 0; oni < outNodes.length; oni++) {
      var bNode = outNodes[oni];
      var outTargets = edgeMap[bNode];
      if (!outTargets) continue;

      var incomingFromA = [];
      for (var uKey in edgeMap) {
        if (uKey !== bNode && edgeMap[uKey] && edgeMap[uKey][bNode] > 0) {
          incomingFromA.push({ aNode: uKey, amount: edgeMap[uKey][bNode] });
        }
      }
      if (incomingFromA.length === 0) continue;

      var outgoingToC = [];
      for (var cKey in outTargets) {
        if (cKey !== bNode && outTargets[cKey] > 0) {
          outgoingToC.push({ cNode: cKey, amount: outTargets[cKey] });
        }
      }
      if (outgoingToC.length === 0) continue;

      incomingFromA.sort(function (x, y) { return y.amount !== x.amount ? y.amount - x.amount : x.aNode.localeCompare(y.aNode); });
      outgoingToC.sort(function (x, y) { return y.amount !== x.amount ? y.amount - x.amount : x.cNode.localeCompare(y.cNode); });

      var chosenA = incomingFromA[0];
      var chosenC = outgoingToC[0];
      var foundPref = false;
      for (var ia = 0; ia < incomingFromA.length; ia++) {
        for (var ic = 0; ic < outgoingToC.length; ic++) {
          if (
            incomingFromA[ia].aNode === outgoingToC[ic].cNode ||
            getEdge(incomingFromA[ia].aNode, outgoingToC[ic].cNode) > 0 ||
            incomingFromA[ia].amount === outgoingToC[ic].amount
          ) {
            chosenA = incomingFromA[ia];
            chosenC = outgoingToC[ic];
            foundPref = true;
            break;
          }
        }
        if (foundPref) break;
      }

      var transM = Math.min(chosenA.amount, chosenC.amount);
      setEdge(chosenA.aNode, bNode, chosenA.amount - transM);
      setEdge(bNode, chosenC.cNode, chosenC.amount - transM);
      if (chosenA.aNode !== chosenC.cNode) {
        addEdge(chosenA.aNode, chosenC.cNode, transM);
      }
      cancelOpposites();
      reduced = true;
      break;
    }
    if (!reduced) break;
  }

  var netBalances = [];
  var totalDebtorsAmt = 0;
  var totalCreditorsAmt = 0;
  var dIds = Object.keys(drinkingNetMap);
  for (var p = 0; p < dIds.length; p++) {
    var id = dIds[p];
    var bal = Math.round(drinkingNetMap[id]);
    if (bal === 0) continue;
    var name = membersMap[id] ? membersMap[id].name : id;
    netBalances.push({ memberId: id, name: name, balance: bal });
    if (bal < 0) {
      totalDebtorsAmt += -bal;
    } else {
      totalCreditorsAmt += bal;
    }
  }
  var imbalanceAmount = totalCreditorsAmt - totalDebtorsAmt;

  var rawEdges = [];
  for (var efKey in edgeMap) {
    for (var etKey in edgeMap[efKey]) {
      var eAmt = edgeMap[efKey][etKey];
      if (eAmt > 0) {
        rawEdges.push({ fromId: efKey, toId: etKey, amount: eAmt });
      }
    }
  }
  rawEdges.sort(function (x, y) {
    if (y.amount !== x.amount) return y.amount - x.amount;
    if (x.fromId !== y.fromId) return x.fromId.localeCompare(y.fromId);
    return x.toId.localeCompare(y.toId);
  });

  var simplifiedTransfers = [];
  var totalDrinkingOutstanding = 0;
  var debtorTransferCount = {};
  for (var rei = 0; rei < rawEdges.length; rei++) {
    var re = rawEdges[rei];
    var fromName = membersMap[re.fromId] ? membersMap[re.fromId].name : re.fromId;
    var toName = membersMap[re.toId] ? membersMap[re.toId].name : re.toId;
    var toMember = membersMap[re.toId] || null;
    var content = stripVietnameseDiacritics_(
      settings.transfer_prefix + ' ' + fromName + ' tra ' + toName + ' nhau'
    ).slice(0, 50);

    debtorTransferCount[re.fromId] = (debtorTransferCount[re.fromId] || 0) + 1;
    simplifiedTransfers.push({
      fromMemberId: re.fromId,
      fromName: fromName,
      toMemberId: re.toId,
      toName: toName,
      amount: re.amount,
      transferContent: content,
      isSplitFromMultipleTransfers: false,
      toBank: toMember ? {
        bankBin: toMember.bank_bin,
        bankName: toMember.bank_name,
        accountNo: toMember.account_no,
        accountName: toMember.account_name
      } : null,
      vietQrUrl: buildVietQrUrl_(toMember, re.amount, content, settings.vietqr_template)
    });
    totalDrinkingOutstanding += re.amount;
  }
  for (var sti = 0; sti < simplifiedTransfers.length; sti++) {
    simplifiedTransfers[sti].isSplitFromMultipleTransfers =
      (debtorTransferCount[simplifiedTransfers[sti].fromMemberId] || 0) > 1;
  }

  return {
    treasurerMemberId: treasurerId,
    badminton: {
      treasurerMemberId: treasurerId,
      treasurerBank: treasurerBank,
      monthlyDues: monthlyDues,
      guestDues: guestDues,
      adhocDues: adhocDues,
      totalMonthlyUnpaid: totalMonthlyUnpaid,
      totalGuestUnpaid: totalGuestUnpaid,
      totalAdhocUnpaid: totalAdhocUnpaid,
      totalOutstanding: totalMonthlyUnpaid + totalGuestUnpaid + totalAdhocUnpaid,
      recentSettlements: recentBadmintonSettlements.slice(0, 15)
    },
    drinking: {
      netBalances: netBalances,
      simplifiedTransfers: simplifiedTransfers,
      unpaidAttendances: drinkingUnpaidAttendances,
      recentSettlements: recentDrinkingSettlements.slice(0, 20),
      unreconciledSettlements: unreconciledDrinkingSettlements,
      totalOutstanding: totalDrinkingOutstanding,
      imbalanceAmount: imbalanceAmount
    }
  };
}

// ============================================================================
// SCHEDULE (LỊCH CỐ ĐỊNH ĐẦU THÁNG)
// ============================================================================

function getScheduleData(monthStr) {
  var targetMonth = (monthStr && /^\d{4}-\d{2}$/.test(monthStr.trim()))
    ? monthStr.trim()
    : todayDateStr_().slice(0, 7);

  var fixedSessions = getSessionsList({ type: 'BADMINTON', month: targetMonth });
  var fixedSessionByDate = {};
  for (var si = 0; si < fixedSessions.length; si++) {
    var fs = fixedSessions[si];
    if (fs.billing_mode === 'AD_HOC') continue;
    if (!fixedSessionByDate[fs.date]) {
      fixedSessionByDate[fs.date] = fs;
    }
  }

  var rows = getSheetObjects_('Schedule');
  var days = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var dStr = String(r.date || '').trim();
    if (dStr.slice(0, 7) !== targetMonth) continue;
    var rowStatus = String(r.status || 'PLANNED').trim().toUpperCase();
    var matchedFixed = fixedSessionByDate[dStr] || null;
    var resolvedStatus = (rowStatus !== 'CANCELLED' && matchedFixed) ? 'DONE' : rowStatus;
    var resolvedSessionId = String(r.session_id || '').trim() || (matchedFixed && rowStatus !== 'CANCELLED' ? matchedFixed.session_id : '');
    days.push({
      plan_id: String(r.plan_id || '').trim(),
      date: dStr,
      start_time: String(r.start_time || '20:00').trim(),
      end_time: String(r.end_time || '21:30').trim(),
      courts: toInt_(r.courts, 2),
      planned_member_ids: String(r.planned_member_ids || '').trim(),
      status: resolvedStatus,
      session_id: resolvedSessionId,
      note: String(r.note || '').trim()
    });
  }
  days.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  return {
    month: targetMonth,
    days: days
  };
}

function generateScheduleRecord(payload) {
  var p = payload || {};
  var monthStr = String(p.month || todayDateStr_().slice(0, 7)).trim();
  if (!/^\d{4}-\d{2}$/.test(monthStr)) {
    throw createAppError_('BAD_REQUEST', 'month phải đúng định dạng YYYY-MM.');
  }

  var weekdays = Array.isArray(p.weekdays) ? p.weekdays.map(Number) : [1, 3, 5];
  var weekdayMap = {};
  for (var w = 0; w < weekdays.length; w++) weekdayMap[weekdays[w]] = true;

  var startTime = String(p.startTime || p.start_time || '20:00').trim();
  var endTime = String(p.endTime || p.end_time || '21:30').trim();
  var courts = Math.max(1, toInt_(p.courts, 2));
  var plannedIds = Array.isArray(p.plannedMemberIds || p.planned_member_ids)
    ? (p.plannedMemberIds || p.planned_member_ids).join(',')
    : String(p.planned_member_ids || '').trim();
  var fromDate = String(p.fromDate || p.from_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) fromDate = '';
  var note = String(p.note || '').trim();

  var existing = getScheduleData(monthStr).days;
  var existingDates = {};
  for (var e = 0; e < existing.length; e++) existingDates[existing[e].date] = true;

  var fixedSessions = getSessionsList({ type: 'BADMINTON', month: monthStr });
  var fixedByDate = {};
  for (var fi = 0; fi < fixedSessions.length; fi++) {
    if (fixedSessions[fi].billing_mode === 'AD_HOC') continue;
    if (!fixedByDate[fixedSessions[fi].date]) fixedByDate[fixedSessions[fi].date] = fixedSessions[fi];
  }

  var parts = monthStr.split('-');
  var year = Number(parts[0]);
  var month = Number(parts[1]);
  var daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  var pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
  var now = nowIso_();
  var toAppend = [];

  for (var d = 1; d <= daysInMonth; d++) {
    var dt = new Date(Date.UTC(year, month - 1, d));
    if (!weekdayMap[dt.getUTCDay()]) continue;
    var dateStr = year + '-' + pad2(month) + '-' + pad2(d);
    if (fromDate && dateStr < fromDate) continue;
    if (existingDates[dateStr]) continue;

    var matched = fixedByDate[dateStr] || null;
    toAppend.push({
      plan_id: generateId_('PLN') + '_' + d,
      date: dateStr,
      start_time: startTime,
      end_time: endTime,
      courts: courts,
      planned_member_ids: plannedIds,
      status: matched ? 'DONE' : 'PLANNED',
      session_id: matched ? matched.session_id : '',
      note: note,
      created_at: now,
      updated_at: now
    });
  }

  if (toAppend.length > 0) {
    appendObjects_('Schedule', toAppend);
  }
  return getScheduleData(monthStr);
}

function updateScheduleDayRecord(payload) {
  var p = payload || {};
  var op = String(p.operation || 'UPSERT').trim().toUpperCase();
  var planId = String(p.planId || p.plan_id || '').trim();
  var dateStr = String(p.date || '').trim();
  var now = nowIso_();

  if (op === 'DELETE') {
    if (!planId) throw createAppError_('BAD_REQUEST', 'Thiếu planId để xóa lịch.');
    deleteRowsByCondition_('Schedule', function (row) {
      return String(row.plan_id || '').trim() === planId;
    });
    return { deletedPlanId: planId };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw createAppError_('BAD_REQUEST', 'date phải đúng định dạng YYYY-MM-DD.');
  }

  var plannedIds = Array.isArray(p.plannedMemberIds || p.planned_member_ids)
    ? (p.plannedMemberIds || p.planned_member_ids).join(',')
    : String(p.planned_member_ids || '').trim();

  if (planId) {
    var updated = null;
    updateRowsByCondition_(
      'Schedule',
      function (row) { return String(row.plan_id || '').trim() === planId; },
      function (row) {
        row.date = dateStr;
        if (p.startTime || p.start_time) row.start_time = String(p.startTime || p.start_time).trim();
        if (p.endTime || p.end_time) row.end_time = String(p.endTime || p.end_time).trim();
        if (p.courts !== undefined) row.courts = Math.max(1, toInt_(p.courts, 2));
        if (p.plannedMemberIds !== undefined || p.planned_member_ids !== undefined) row.planned_member_ids = plannedIds;
        if (p.status) row.status = String(p.status).trim().toUpperCase();
        if (p.note !== undefined) row.note = String(p.note).trim();
        row.updated_at = now;
        updated = row;
        return row;
      }
    );
    return { day: updated, schedule: getScheduleData(dateStr.slice(0, 7)) };
  }

  var newDay = {
    plan_id: generateId_('PLN'),
    date: dateStr,
    start_time: String(p.startTime || p.start_time || '20:00').trim(),
    end_time: String(p.endTime || p.end_time || '21:30').trim(),
    courts: Math.max(1, toInt_(p.courts, 2)),
    planned_member_ids: plannedIds,
    status: String(p.status || 'PLANNED').trim().toUpperCase(),
    session_id: '',
    note: String(p.note || '').trim(),
    created_at: now,
    updated_at: now
  };
  appendObjects_('Schedule', [newDay]);
  return { day: newDay, schedule: getScheduleData(dateStr.slice(0, 7)) };
}

// ============================================================================
// MONTHLY BILLS & DUES (CẦU LÔNG THU ĐẦU THÁNG, CỘNG/TRỪ THÁNG SAU)
// ============================================================================

function parseJsonSafe_(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function normalizeContributionsList_(rawList, membersMap) {
  if (!Array.isArray(rawList)) return [];
  var out = [];
  for (var i = 0; i < rawList.length; i++) {
    var it = rawList[i] || {};
    var mId = String(it.member_id || it.memberId || '').trim();
    if (!mId) continue;
    var qty = Math.max(0, toFloat_(it.tube_qty !== undefined ? it.tube_qty : it.tubeQty, 0));
    var unitPrice = Math.max(0, toInt_(it.unit_price !== undefined ? it.unit_price : it.unitPrice, 0));
    var rawAmt = it.amount !== undefined && it.amount !== '' && it.amount !== null ? toInt_(it.amount, 0) : Math.round(qty * unitPrice);
    var amount = Math.max(0, rawAmt);
    if (amount <= 0 && qty <= 0) continue;
    var mName = String(it.member_name || it.memberName || (membersMap && membersMap[mId] ? membersMap[mId].name : mId)).trim();
    out.push({
      id: String(it.id || generateId_('CNT') + '_' + i),
      member_id: mId,
      member_name: mName,
      tube_qty: qty,
      unit_price: unitPrice,
      amount: amount,
      note: String(it.note || '').trim(),
      created_at: String(it.created_at || nowIso_())
    });
  }
  return out;
}

function getMonthlyBillData(monthStr) {
  var targetMonth = (monthStr && /^\d{4}-\d{2}$/.test(monthStr.trim()))
    ? monthStr.trim()
    : todayDateStr_().slice(0, 7);

  var settings = getSettingsMap();
  var members = getMembersList(false);
  var membersMap = buildMembersMap_(members);
  var treasurer = membersMap[settings.treasurer_member_id] || null;

  var allBills = getSheetObjects_('Monthly_Bills');
  var billRow = null;
  var prevBillRow = null;
  var prevMonth = prevMonthStr_(targetMonth);
  for (var bi = 0; bi < allBills.length; bi++) {
    var b = allBills[bi];
    var bMonth = String(b.month || '').trim();
    if (bMonth === targetMonth) billRow = b;
    if (bMonth === prevMonth) prevBillRow = b;
  }

  var allBadmintonSessions = getSessionsList({ type: 'BADMINTON' });
  var adhocSessionSet = {};
  for (var abs = 0; abs < allBadmintonSessions.length; abs++) {
    if (allBadmintonSessions[abs].billing_mode === 'AD_HOC') {
      adhocSessionSet[allBadmintonSessions[abs].session_id] = true;
    }
  }

  var sessionsInMonth = allBadmintonSessions.filter(function (s) {
    return s.date.slice(0, 7) === targetMonth && s.billing_mode !== 'AD_HOC';
  });
  var sessionsTotal = 0;
  for (var si = 0; si < sessionsInMonth.length; si++) {
    sessionsTotal += sessionsInMonth[si].total_amount;
  }

  // Tính phí vãng lai đã thu trong tháng targetMonth (chỉ tính buổi cố định MONTHLY)
  var attRows = getSheetObjects_('Attendance');
  var guestPaidCount = 0;
  var guestPaidAmount = 0;
  var guestUnpaidAmount = 0;
  for (var ai = 0; ai < attRows.length; ai++) {
    var a = attRows[ai];
    if (String(a.session_type || '').toUpperCase() !== 'BADMINTON') continue;
    if (adhocSessionSet[String(a.session_id || '').trim()]) continue;
    if (String(a.member_type_snapshot || '').toUpperCase() !== 'GUEST') continue;
    var fee = toInt_(a.fee_amount, 0);
    if (fee <= 0) continue;
    var isPaid = toBoolean_(a.is_paid);
    var refMonth = isPaid && a.paid_at
      ? String(a.paid_at).slice(0, 7)
      : String(a.session_date || '').slice(0, 7);

    if (refMonth === targetMonth) {
      if (isPaid) {
        guestPaidCount++;
        guestPaidAmount += fee;
      } else {
        guestUnpaidAmount += fee;
      }
    }
  }

  // Gợi ý dự toán từ lịch tháng
  var schedule = getScheduleData(targetMonth);
  var suggestedEstimate = 0;
  for (var sch = 0; sch < schedule.days.length; sch++) {
    var sd = schedule.days[sch];
    if (sd.status === 'CANCELLED') continue;
    suggestedEstimate += Math.round(sd.courts * durationHours_(sd.start_time, sd.end_time) * settings.court_price_per_hour);
  }

  var issuedAtRef = billRow && billRow.updated_at ? String(billRow.updated_at).trim().slice(0, 10) : (targetMonth + '-01');

  // Đọc Monthly_Dues của tháng
  var allDues = getSheetObjects_('Monthly_Dues');
  var dues = [];
  for (var di = 0; di < allDues.length; di++) {
    var d = allDues[di];
    if (String(d.month || '').trim() !== targetMonth) continue;
    var dmId = String(d.member_id || '').trim();
    var dmName = membersMap[dmId] ? membersMap[dmId].name : dmId;
    var dAmt = toInt_(d.amount, 0);
    var dContent = stripVietnameseDiacritics_(
      settings.transfer_prefix + ' ' + dmName + ' cau T' + targetMonth.slice(5, 7)
    ).slice(0, 50);

    dues.push({
      due_id: String(d.due_id || '').trim(),
      month: targetMonth,
      member_id: dmId,
      member_name: dmName,
      amount: dAmt,
      base_amount: toInt_(d.base_amount, dAmt),
      credit_amount: toInt_(d.credit_amount, 0),
      credit_note: String(d.credit_note || '').trim(),
      issued_at: issuedAtRef,
      is_paid: toBoolean_(d.is_paid),
      paid_at: String(d.paid_at || ''),
      transferContent: dContent,
      vietQrUrl: buildVietQrUrl_(treasurer, dAmt, dContent, settings.vietqr_template)
    });
  }

  var carryIn = billRow ? toInt_(billRow.carry_in, 0) : (prevBillRow ? toInt_(prevBillRow.carry_out, 0) : 0);
  var estimate = billRow ? toInt_(billRow.estimate, 0) : suggestedEstimate;
  var hasOverride = billRow && billRow.actual_cost_override !== '' && billRow.actual_cost_override !== null && billRow.actual_cost_override !== undefined;
  var actualCostOverride = hasOverride ? toInt_(billRow.actual_cost_override, 0) : null;
  var billedTotal = billRow ? toInt_(billRow.billed_total, 0) : 0;
  var status = billRow ? String(billRow.status || 'OPEN').toUpperCase() : 'OPEN';
  var isProjectedCost = (status === 'OPEN' && actualCostOverride === null && estimate > 0 && sessionsTotal < estimate);
  var actualCost = actualCostOverride !== null
    ? actualCostOverride
    : (isProjectedCost ? estimate : sessionsTotal);
  var parsedBillDetail = billRow ? parseJsonSafe_(String(billRow.bill_detail || ''), {}) : {};
  var refundCredits = (parsedBillDetail && Array.isArray(parsedBillDetail.refundCredits))
    ? parsedBillDetail.refundCredits
    : [];
  var refundCreditsTotal = (parsedBillDetail && parsedBillDetail.refundCreditsTotal !== undefined)
    ? Math.max(0, toInt_(parsedBillDetail.refundCreditsTotal, 0))
    : refundCredits.reduce(function (sum, r) { return sum + toInt_(r && r.amount, 0); }, 0);
  var hasCarryOutOverride = parsedBillDetail &&
    parsedBillDetail.carryOutOverride !== undefined &&
    parsedBillDetail.carryOutOverride !== null &&
    parsedBillDetail.carryOutOverride !== '' &&
    isFinite(Number(parsedBillDetail.carryOutOverride));
  var carryOut = hasCarryOutOverride
    ? Math.round(Number(parsedBillDetail.carryOutOverride))
    : (carryIn + billedTotal + guestPaidAmount - actualCost - refundCreditsTotal);

  var contributions = normalizeContributionsList_(
    billRow ? parseJsonSafe_(String(billRow.shuttle_contributions || ''), []) : [],
    membersMap
  );
  var prevDirectContributions = normalizeContributionsList_(
    prevBillRow ? parseJsonSafe_(String(prevBillRow.shuttle_contributions || ''), []) : [],
    membersMap
  );
  var prevCarryOverCredits = normalizeContributionsList_(
    prevBillRow ? parseJsonSafe_(String(prevBillRow.carry_over_credits || ''), []) : [],
    membersMap
  );
  var prevMonthContributions = prevDirectContributions.concat(prevCarryOverCredits);

  var bill = {
    month: targetMonth,
    estimate: estimate,
    carry_in: carryIn,
    to_collect: billRow ? toInt_(billRow.to_collect, Math.max(0, estimate - carryIn)) : Math.max(0, estimate - carryIn),
    member_count: billRow ? toInt_(billRow.member_count, 0) : 0,
    per_member: billRow ? toInt_(billRow.per_member, 0) : 0,
    billed_total: billedTotal,
    actual_cost: actualCost,
    logged_sessions_cost: sessionsTotal,
    is_projected_cost: isProjectedCost,
    actual_cost_override: actualCostOverride,
    guest_income: guestPaidAmount,
    carry_out: carryOut,
    status: status,
    created_by: billRow ? String(billRow.created_by || '') : '',
    closed_at: billRow ? String(billRow.closed_at || '') : '',
    updated_at: billRow ? String(billRow.updated_at || '') : '',
    court_fee: billRow ? toInt_(billRow.court_fee, estimate) : suggestedEstimate,
    shuttle_tube_qty: billRow ? toFloat_(billRow.shuttle_tube_qty, 0) : 0,
    shuttle_tube_price: billRow ? toInt_(billRow.shuttle_tube_price, 0) : 0,
    shuttle_tube_amount: billRow ? toInt_(billRow.shuttle_tube_amount, 0) : 0,
    prev_overtime_fee: billRow ? toInt_(billRow.prev_overtime_fee, 0) : 0,
    bill_detail: billRow ? String(billRow.bill_detail || '') : '',
    shuttle_contributions: billRow ? String(billRow.shuttle_contributions || '') : '',
    applied_credits_total: billRow ? toInt_(billRow.applied_credits_total, 0) : 0,
    refund_credits_total: refundCreditsTotal,
    carry_over_credits: billRow ? String(billRow.carry_over_credits || '') : ''
  };

  var suggestedPrevOvertime = 0;
  for (var psi = 0; psi < allBadmintonSessions.length; psi++) {
    var ps = allBadmintonSessions[psi];
    if (ps.date.slice(0, 7) !== prevMonth || ps.billing_mode === 'AD_HOC') continue;
    var parsedCostDetail = ps.cost_detail ? parseJsonSafe_(String(ps.cost_detail), null) : null;
    if (parsedCostDetail && Array.isArray(parsedCostDetail.courtLines)) {
      for (var cl = 0; cl < parsedCostDetail.courtLines.length; cl++) {
        var line = parsedCostDetail.courtLines[cl];
        if (!line || !line.isExtra) continue;
        var lineAmt = line.amount !== undefined
          ? toInt_(line.amount, 0)
          : Math.round(toFloat_(line.courts, 0) * toFloat_(line.hours, 0) * toInt_(line.pricePerHour, 0));
        suggestedPrevOvertime += Math.max(0, lineAmt);
      }
    } else if (ps.court_amount > 0 && ps.shuttle_amount === 0 && ps.other_amount === 0) {
      suggestedPrevOvertime += ps.court_amount;
    }
  }

  return {
    month: targetMonth,
    bill: bill,
    dues: dues,
    sessions: sessionsInMonth,
    guestIncomeDetail: {
      paidCount: guestPaidCount,
      paidAmount: guestPaidAmount,
      unpaidAmount: guestUnpaidAmount
    },
    suggestedEstimateFromSchedule: suggestedEstimate,
    suggestedPrevOvertime: suggestedPrevOvertime,
    contributions: contributions,
    prevMonthContributions: prevMonthContributions,
    refundCredits: refundCredits
  };
}

function issueMonthlyBillRecord(payload, editorEmail) {
  var p = payload || {};
  var targetMonth = String(p.month || todayDateStr_().slice(0, 7)).trim();
  if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
    throw createAppError_('BAD_REQUEST', 'month phải đúng định dạng YYYY-MM.');
  }

  var settings = getSettingsMap();
  var members = getMembersList(false);
  var membersMap = buildMembersMap_(members);
  var unit = settings.rounding_unit || 1000;

  var courtFee = Math.max(0, toInt_(p.courtFee !== undefined ? p.courtFee : p.court_fee, 0));
  var shuttleTubeQty = Math.max(0, toFloat_(p.shuttleTubeQty !== undefined ? p.shuttleTubeQty : p.shuttle_tube_qty, 0));
  var shuttleTubePrice = Math.max(0, toInt_(p.shuttleTubePrice !== undefined ? p.shuttleTubePrice : p.shuttle_tube_price, 0));
  var shuttleTubeAmount = (p.shuttleTubeAmount !== undefined || p.shuttle_tube_amount !== undefined)
    ? Math.max(0, toInt_(p.shuttleTubeAmount !== undefined ? p.shuttleTubeAmount : p.shuttle_tube_amount, 0))
    : Math.round(shuttleTubeQty * shuttleTubePrice);
  var prevOvertimeFee = Math.max(0, toInt_(p.prevOvertimeFee !== undefined ? p.prevOvertimeFee : p.prev_overtime_fee, 0));

  var computedEstimate = courtFee + shuttleTubeAmount + prevOvertimeFee;
  var estimate = (p.estimate !== undefined && p.estimate !== null && p.estimate !== '')
    ? Math.max(0, toInt_(p.estimate, computedEstimate))
    : computedEstimate;

  var memberIds = Array.isArray(p.memberIds || p.member_ids) ? (p.memberIds || p.member_ids) : [];
  if (memberIds.length === 0) {
    var mains = members.filter(function (m) { return m.is_active && m.type === 'MAIN'; });
    memberIds = mains.map(function (m) { return m.member_id; });
  }
  if (memberIds.length === 0) {
    throw createAppError_('BAD_REQUEST', 'Phải chọn ít nhất 1 thành viên để chia hóa đơn tháng.');
  }

  var now = nowIso_();

  // Đồng bộ vai trò thành viên: thành viên được tích -> MAIN, không được tích -> GUEST (chỉ với thành viên đang hoạt động)
  if (toBoolean_(p.syncMemberTypes !== undefined ? p.syncMemberTypes : p.sync_member_types)) {
    var selectedSet = {};
    for (var smi = 0; smi < memberIds.length; smi++) {
      var cleanId = String(memberIds[smi] || '').trim();
      if (cleanId) selectedSet[cleanId] = true;
    }
    updateRowsByCondition_(
      'Members',
      function (row) {
        if (!toBoolean_(row.is_active)) return false;
        var mIdRow = String(row.member_id || '').trim();
        var targetType = selectedSet[mIdRow] ? 'MAIN' : 'GUEST';
        return String(row.type || '').trim().toUpperCase() !== targetType;
      },
      function (row) {
        var mIdRow = String(row.member_id || '').trim();
        row.type = selectedSet[mIdRow] ? 'MAIN' : 'GUEST';
        row.updated_at = now;
        return row;
      }
    );
    members = getMembersList(false);
    membersMap = buildMembersMap_(members);
  }

  var currentData = getMonthlyBillData(targetMonth);
  var carryIn = (p.carryIn !== undefined && p.carryIn !== null && p.carryIn !== '')
    ? toInt_(p.carryIn, currentData.bill.carry_in)
    : currentData.bill.carry_in;

  var memberIdSet = {};
  for (var msi = 0; msi < memberIds.length; msi++) {
    memberIdSet[String(memberIds[msi]).trim()] = true;
  }

  var appliedCredits = normalizeContributionsList_(
    p.appliedCredits !== undefined ? p.appliedCredits : currentData.prevMonthContributions,
    membersMap
  );
  var appliedCreditsTotal = 0;
  var creditByMember = {};
  var creditNotesByMember = {};
  var refundByMember = {};
  var refundOrder = [];
  for (var ci = 0; ci < appliedCredits.length; ci++) {
    var cr = appliedCredits[ci];
    appliedCreditsTotal += cr.amount;
    creditByMember[cr.member_id] = (creditByMember[cr.member_id] || 0) + cr.amount;
    var labelPart = (cr.tube_qty > 0 ? cr.tube_qty + ' ống' : 'góp cầu') + ' (' + cr.amount.toLocaleString('vi-VN') + 'đ)';
    if (!creditNotesByMember[cr.member_id]) creditNotesByMember[cr.member_id] = [];
    creditNotesByMember[cr.member_id].push(cr.note ? cr.note + ' - ' + labelPart : labelPart);

    if (!memberIdSet[cr.member_id]) {
      if (!refundByMember[cr.member_id]) {
        refundByMember[cr.member_id] = {
          name: membersMap[cr.member_id] ? membersMap[cr.member_id].name : (cr.member_name || cr.member_id),
          amount: 0,
          notes: []
        };
        refundOrder.push(cr.member_id);
      }
      refundByMember[cr.member_id].amount += cr.amount;
      refundByMember[cr.member_id].notes.push(cr.note ? cr.note + ' - ' + labelPart : labelPart);
    }
  }

  var refundCredits = [];
  var refundCreditsTotal = 0;
  for (var ri = 0; ri < refundOrder.length; ri++) {
    var rmId = refundOrder[ri];
    var rInfo = refundByMember[rmId];
    refundCreditsTotal += rInfo.amount;
    refundCredits.push({
      id: 'REFUND_' + rmId,
      member_id: rmId,
      member_name: rInfo.name,
      tube_qty: 0,
      unit_price: 0,
      amount: rInfo.amount,
      note: 'Thủ quỹ hoàn riêng (không đánh MAIN): ' + rInfo.notes.join(', '),
      created_at: now
    });
  }

  var grossToDistribute = Math.max(0, estimate + appliedCreditsTotal - carryIn);
  var perMember = grossToDistribute > 0
    ? Math.ceil(grossToDistribute / memberIds.length / unit) * unit
    : 0;
  var toCollect = Math.max(0, estimate - carryIn);

  // Giữ trạng thái is_paid chỉ khi số tiền mới khớp đúng số tiền đã đóng trước đó
  var oldPaidMap = {};
  var oldDues = getSheetObjects_('Monthly_Dues');
  for (var i = 0; i < oldDues.length; i++) {
    if (String(oldDues[i].month || '').trim() === targetMonth && toBoolean_(oldDues[i].is_paid)) {
      oldPaidMap[String(oldDues[i].member_id || '').trim()] = oldDues[i];
    }
  }
  deleteRowsByCondition_('Monthly_Dues', function (row) {
    return String(row.month || '').trim() === targetMonth;
  });

  var billedTotal = 0;
  var duesToAppend = [];
  var carryOverCredits = [];
  for (var j = 0; j < memberIds.length; j++) {
    var mId = String(memberIds[j]).trim();
    var oldPaid = oldPaidMap[mId];
    var creditAmt = creditByMember[mId] || 0;
    var netDue = Math.max(0, perMember - creditAmt);
    var excess = creditAmt > perMember ? creditAmt - perMember : 0;
    var creditNoteStr = '';
    if (creditAmt > 0) {
      creditNoteStr = 'Trừ góp cầu: ' + (creditNotesByMember[mId] || []).join(', ');
      if (excess > 0) {
        creditNoteStr += ' (Còn dư ' + excess.toLocaleString('vi-VN') + 'đ chuyển T.sau)';
        carryOverCredits.push({
          id: 'CARRY_' + targetMonth + '_' + mId,
          member_id: mId,
          member_name: membersMap[mId] ? membersMap[mId].name : mId,
          tube_qty: 0,
          unit_price: 0,
          amount: excess,
          note: 'Dư góp cầu T' + targetMonth.slice(5, 7) + ' chuyển sang',
          created_at: now
        });
      }
    }
    var oldPaidAmt = oldPaid ? toInt_(oldPaid.amount, 0) : 0;
    var isExactMatch = Boolean(oldPaid && (oldPaidAmt === netDue || netDue === 0));
    var isDuePaid = isExactMatch || netDue === 0;
    if (oldPaid && !isExactMatch) {
      var diff = netDue - oldPaidAmt;
      var diffNote = diff > 0
        ? ('Đã đóng trước ' + oldPaidAmt.toLocaleString('vi-VN') + 'đ — thiếu thêm ' + diff.toLocaleString('vi-VN') + 'đ')
        : ('Đã đóng trước ' + oldPaidAmt.toLocaleString('vi-VN') + 'đ — dư ' + (-diff).toLocaleString('vi-VN') + 'đ cần hoàn');
      creditNoteStr = creditNoteStr ? (creditNoteStr + ' • ' + diffNote) : diffNote;
    }
    billedTotal += netDue;

    duesToAppend.push({
      due_id: generateId_('DUE') + '_' + j,
      month: targetMonth,
      member_id: mId,
      amount: netDue,
      base_amount: perMember,
      credit_amount: creditAmt,
      credit_note: creditNoteStr,
      is_paid: isDuePaid,
      paid_at: isExactMatch ? String(oldPaid.paid_at || now) : (netDue === 0 ? now : ''),
      confirmed_by: isExactMatch ? String(oldPaid.confirmed_by || editorEmail) : (netDue === 0 ? editorEmail : '')
    });
  }
  appendObjects_('Monthly_Dues', duesToAppend);

  var carryOut = carryIn + billedTotal + currentData.bill.guest_income - currentData.bill.actual_cost - refundCreditsTotal;
  var billDetailObj = (p.billDetail && typeof p.billDetail === 'object') ? p.billDetail : {};
  billDetailObj.appliedCredits = appliedCredits;
  billDetailObj.refundCredits = refundCredits;
  billDetailObj.refundCreditsTotal = refundCreditsTotal;
  var billDetailStr = JSON.stringify(billDetailObj);
  var carryOverCreditsStr = JSON.stringify(carryOverCredits);

  var billExists = getSheetObjects_('Monthly_Bills').some(function (b) {
    return String(b.month || '').trim() === targetMonth;
  });
  if (billExists) {
    updateRowsByCondition_(
      'Monthly_Bills',
      function (row) { return String(row.month || '').trim() === targetMonth; },
      function (row) {
        row.estimate = estimate;
        row.carry_in = carryIn;
        row.to_collect = toCollect;
        row.member_count = memberIds.length;
        row.per_member = perMember;
        row.billed_total = billedTotal;
        row.actual_cost = currentData.bill.actual_cost;
        row.guest_income = currentData.bill.guest_income;
        row.carry_out = carryOut;
        row.status = 'OPEN';
        row.court_fee = courtFee;
        row.shuttle_tube_qty = shuttleTubeQty;
        row.shuttle_tube_price = shuttleTubePrice;
        row.shuttle_tube_amount = shuttleTubeAmount;
        row.prev_overtime_fee = prevOvertimeFee;
        row.bill_detail = billDetailStr;
        row.applied_credits_total = appliedCreditsTotal;
        row.carry_over_credits = carryOverCreditsStr;
        row.updated_at = now;
        return row;
      }
    );
  } else {
    appendObjects_('Monthly_Bills', [{
      month: targetMonth,
      estimate: estimate,
      carry_in: carryIn,
      to_collect: toCollect,
      member_count: memberIds.length,
      per_member: perMember,
      billed_total: billedTotal,
      actual_cost: currentData.bill.actual_cost,
      actual_cost_override: '',
      guest_income: currentData.bill.guest_income,
      carry_out: carryOut,
      status: 'OPEN',
      created_by: editorEmail,
      closed_at: '',
      updated_at: now,
      court_fee: courtFee,
      shuttle_tube_qty: shuttleTubeQty,
      shuttle_tube_price: shuttleTubePrice,
      shuttle_tube_amount: shuttleTubeAmount,
      prev_overtime_fee: prevOvertimeFee,
      bill_detail: billDetailStr,
      shuttle_contributions: '[]',
      applied_credits_total: appliedCreditsTotal,
      carry_over_credits: carryOverCreditsStr
    }]);
  }

  // Đặt lịch đánh cầu tháng tùy chọn ngay khi phát hành hóa đơn tháng
  var sc = p.scheduleConfig || p.schedule_config;
  if (sc && Array.isArray(sc.weekdays) && sc.weekdays.length > 0) {
    generateScheduleRecord({
      month: targetMonth,
      weekdays: sc.weekdays,
      startTime: sc.startTime || sc.start_time || '20:00',
      endTime: sc.endTime || sc.end_time || '21:30',
      courts: Math.max(1, toInt_(sc.courts, settings.default_court_count || 2)),
      plannedMemberIds: memberIds,
      fromDate: String(sc.fromDate || sc.from_date || '').trim()
    });
    updateRowsByCondition_(
      'Schedule',
      function (row) {
        return (
          String(row.date || '').trim().slice(0, 7) === targetMonth &&
          String(row.status || 'PLANNED').trim().toUpperCase() === 'PLANNED'
        );
      },
      function (row) {
        row.planned_member_ids = memberIds.join(',');
        row.updated_at = now;
        return row;
      }
    );
  }

  return getMonthlyBillData(targetMonth);
}

function saveMonthlyContributionsRecord(payload, editorEmail) {
  var p = payload || {};
  var targetMonth = String(p.month || todayDateStr_().slice(0, 7)).trim();
  if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
    throw createAppError_('BAD_REQUEST', 'month phải đúng định dạng YYYY-MM.');
  }

  var membersMap = buildMembersMap_(getMembersList(false));
  var normalized = normalizeContributionsList_(p.contributions || [], membersMap);
  var serialized = JSON.stringify(normalized);
  var now = nowIso_();

  var billExists = getSheetObjects_('Monthly_Bills').some(function (b) {
    return String(b.month || '').trim() === targetMonth;
  });

  if (billExists) {
    updateRowsByCondition_(
      'Monthly_Bills',
      function (row) { return String(row.month || '').trim() === targetMonth; },
      function (row) {
        row.shuttle_contributions = serialized;
        row.updated_at = now;
        return row;
      }
    );
  } else {
    var current = getMonthlyBillData(targetMonth);
    appendObjects_('Monthly_Bills', [{
      month: targetMonth,
      estimate: current.bill.estimate,
      carry_in: current.bill.carry_in,
      to_collect: current.bill.to_collect,
      member_count: 0,
      per_member: 0,
      billed_total: 0,
      actual_cost: current.bill.actual_cost,
      actual_cost_override: '',
      guest_income: current.bill.guest_income,
      carry_out: current.bill.carry_out,
      status: 'OPEN',
      created_by: editorEmail,
      closed_at: '',
      updated_at: now,
      court_fee: current.bill.court_fee || 0,
      shuttle_tube_qty: 0,
      shuttle_tube_price: 0,
      shuttle_tube_amount: 0,
      prev_overtime_fee: 0,
      bill_detail: '',
      shuttle_contributions: serialized,
      applied_credits_total: 0
    }]);
  }

  return getMonthlyBillData(targetMonth);
}

function markDuePaidRecord(payload, editorEmail) {
  var p = payload || {};
  var dueId = String(p.dueId || p.due_id || '').trim();
  if (!dueId) throw createAppError_('BAD_REQUEST', 'Thiếu dueId.');

  var isPaid = p.isPaid !== undefined ? toBoolean_(p.isPaid) : true;
  var now = nowIso_();
  var targetMonth = '';

  var count = updateRowsByCondition_(
    'Monthly_Dues',
    function (row) { return String(row.due_id || '').trim() === dueId; },
    function (row) {
      targetMonth = String(row.month || '').trim();
      row.is_paid = isPaid;
      row.paid_at = isPaid ? now : '';
      row.confirmed_by = isPaid ? editorEmail : '';
      return row;
    }
  );
  if (count === 0) throw createAppError_('NOT_FOUND', 'Không tìm thấy khoản thu ' + dueId);

  return {
    monthlyBill: getMonthlyBillData(targetMonth),
    debts: computeDebtsData()
  };
}

function closeMonthRecord(payload, editorEmail) {
  var p = payload || {};
  var targetMonth = String(p.month || todayDateStr_().slice(0, 7)).trim();
  var current = getMonthlyBillData(targetMonth);
  var hasCarryOutOverride = (
    p.carryOutOverride !== undefined &&
    p.carryOutOverride !== null &&
    p.carryOutOverride !== '' &&
    isFinite(Number(p.carryOutOverride))
  );
  var overrideVal = (p.actualCostOverride !== undefined && p.actualCostOverride !== null && p.actualCostOverride !== '')
    ? Math.max(0, toInt_(p.actualCostOverride, 0))
    : null;
  var actualCost = hasCarryOutOverride
    ? current.bill.actual_cost
    : (overrideVal !== null ? overrideVal : current.bill.actual_cost);
  var carryOut = hasCarryOutOverride
    ? Math.round(Number(p.carryOutOverride))
    : (current.bill.carry_in + current.bill.billed_total + current.bill.guest_income - actualCost - (current.bill.refund_credits_total || 0));
  var now = nowIso_();

  var existingRows = getSheetObjects_('Monthly_Bills').filter(function (b) {
    return String(b.month || '').trim() === targetMonth;
  });
  var billExists = existingRows.length > 0;
  var detailObj = billExists ? parseJsonSafe_(String(existingRows[0].bill_detail || ''), {}) : {};
  if (!detailObj || typeof detailObj !== 'object' || Array.isArray(detailObj)) {
    detailObj = {};
  }
  if (hasCarryOutOverride) {
    detailObj.carryOutOverride = carryOut;
  } else if (detailObj.carryOutOverride !== undefined) {
    delete detailObj.carryOutOverride;
  }
  var detailStr = Object.keys(detailObj).length > 0 ? JSON.stringify(detailObj) : '';

  if (billExists) {
    updateRowsByCondition_(
      'Monthly_Bills',
      function (row) { return String(row.month || '').trim() === targetMonth; },
      function (row) {
        row.actual_cost = actualCost;
        if (!hasCarryOutOverride) {
          row.actual_cost_override = overrideVal !== null ? overrideVal : '';
        }
        row.guest_income = current.bill.guest_income;
        row.carry_out = carryOut;
        row.bill_detail = detailStr;
        row.status = 'CLOSED';
        row.closed_at = now;
        row.updated_at = now;
        return row;
      }
    );
  } else {
    appendObjects_('Monthly_Bills', [{
      month: targetMonth,
      estimate: current.bill.estimate,
      carry_in: current.bill.carry_in,
      to_collect: current.bill.to_collect,
      member_count: current.bill.member_count,
      per_member: current.bill.per_member,
      billed_total: current.bill.billed_total,
      actual_cost: actualCost,
      actual_cost_override: hasCarryOutOverride ? '' : (overrideVal !== null ? overrideVal : ''),
      guest_income: current.bill.guest_income,
      carry_out: carryOut,
      bill_detail: detailStr,
      status: 'CLOSED',
      created_by: editorEmail,
      closed_at: now,
      updated_at: now
    }]);
  }

  return getMonthlyBillData(targetMonth);
}

// ============================================================================
// DASHBOARD & GETALL (1-SHOT BUNDLE)
// ============================================================================

function getDashboardData(periodType, refDate) {
  var period = getPeriodRange_(periodType || 'MONTH', refDate);
  var sessions = getSessionsList({});
  var debts = computeDebtsData();
  var currentMonth = (refDate && /^\d{4}-\d{2}-\d{2}$/.test(refDate))
    ? refDate.slice(0, 7)
    : todayDateStr_().slice(0, 7);
  var monthlyBill = getMonthlyBillData(currentMonth);

  var badPeriodCost = 0;
  var badSessionCount = 0;
  var fixedSessionCount = 0;
  var adhocSessionCount = 0;
  var drinkPeriodCost = 0;
  var drinkSessionCount = 0;

  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    if (period.startDate && s.date < period.startDate) continue;
    if (period.endDate && s.date > period.endDate) continue;
    if (s.type === 'BADMINTON') {
      badPeriodCost += s.total_amount;
      badSessionCount++;
      if (s.billing_mode === 'AD_HOC') adhocSessionCount++;
      else fixedSessionCount++;
    } else if (s.type === 'DRINKING') {
      drinkPeriodCost += s.total_amount;
      drinkSessionCount++;
    }
  }

  var monthlyBillCostInPeriod = 0;
  if (String(periodType || 'MONTH').trim().toUpperCase() !== 'WEEK') {
    var startMonth = period.startDate ? period.startDate.slice(0, 7) : '';
    var endMonth = period.endDate ? period.endDate.slice(0, 7) : '9999-12';
    var billRowsPeriod = getSheetObjects_('Monthly_Bills');
    var dueRowsPeriod = getSheetObjects_('Monthly_Dues');
    var monthMap = {};
    for (var mbi = 0; mbi < billRowsPeriod.length; mbi++) {
      var bm = String(billRowsPeriod[mbi].month || '').trim();
      if (bm) monthMap[bm] = true;
    }
    for (var mdi = 0; mdi < dueRowsPeriod.length; mdi++) {
      var dm = String(dueRowsPeriod[mdi].month || '').trim();
      if (dm) monthMap[dm] = true;
    }
    var monthKeys = Object.keys(monthMap);
    for (var mki = 0; mki < monthKeys.length; mki++) {
      var mKey = monthKeys[mki];
      if (startMonth && mKey < startMonth) continue;
      if (mKey > endMonth) continue;
      var mbPeriod = getMonthlyBillData(mKey);
      var isIssuedOrClosed = mbPeriod.bill.status === 'CLOSED' || mbPeriod.bill.billed_total > 0 || mbPeriod.dues.length > 0;
      if (isIssuedOrClosed) {
        monthlyBillCostInPeriod += Number(mbPeriod.bill.actual_cost) || 0;
      }
    }
  }

  var paidMembersCount = 0;
  for (var di = 0; di < monthlyBill.dues.length; di++) {
    if (monthlyBill.dues[di].is_paid) paidMembersCount++;
  }

  return {
    period: period,
    currentMonth: currentMonth,
    badminton: {
      periodCost: badPeriodCost + monthlyBillCostInPeriod,
      monthlyBillCostInPeriod: monthlyBillCostInPeriod,
      sessionCount: badSessionCount,
      fixedSessionCount: fixedSessionCount,
      adhocSessionCount: adhocSessionCount,
      guestIncomeInMonth: monthlyBill.bill.guest_income,
      carryIn: monthlyBill.bill.carry_in,
      projectedCarryOut: monthlyBill.bill.carry_out,
      unpaidTotal: debts.badminton.totalOutstanding,
      monthlyBillIssued: monthlyBill.dues.length > 0 || monthlyBill.bill.billed_total > 0,
      monthlyBillStatus: monthlyBill.bill.status,
      estimate: monthlyBill.bill.estimate,
      billedTotal: monthlyBill.bill.billed_total,
      actualCost: monthlyBill.bill.actual_cost,
      perMember: monthlyBill.bill.per_member,
      paidMembersCount: paidMembersCount,
      totalMembersCount: monthlyBill.dues.length
    },
    drinking: {
      periodCost: drinkPeriodCost,
      sessionCount: drinkSessionCount,
      unpaidTotal: debts.drinking.totalOutstanding
    },
    recentSessions: sessions.slice(0, 5)
  };
}

function getAllData(periodType, refDate, monthStr) {
  var rDate = (refDate && /^\d{4}-\d{2}-\d{2}$/.test(refDate)) ? refDate : todayDateStr_();
  var targetMonth = (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) ? monthStr : rDate.slice(0, 7);

  beginSheetCache_();
  try {
    var settings = getSettingsMap();
    var members = getMembersList(false);
    var allSessions = getSessionsList({});
    var debts = computeDebtsData();
    var closedMonths = getSheetObjects_('Monthly_Bills')
      .filter(function (b) { return String(b.status || '').trim().toUpperCase() === 'CLOSED'; })
      .map(function (b) { return String(b.month || '').trim(); })
      .filter(Boolean);

    // Giới hạn danh sách buổi trong 6 tháng gần nhất + buổi còn nợ chưa thu để giữ payload < 95KB CacheService
    var refParts = rDate.split('-');
    var cutoffDateObj = new Date(Number(refParts[0]), Number(refParts[1]) - 7, 1);
    var cM = cutoffDateObj.getMonth() + 1;
    var cutoffDateStr = cutoffDateObj.getFullYear() + '-' + (cM < 10 ? '0' + cM : cM) + '-01';
    var unpaidSessionSet = {};
    for (var ui = 0; ui < debts.drinking.unpaidAttendances.length; ui++) {
      unpaidSessionSet[debts.drinking.unpaidAttendances[ui].session_id] = true;
    }
    for (var gi = 0; gi < debts.badminton.guestDues.length; gi++) {
      unpaidSessionSet[debts.badminton.guestDues[gi].session_id] = true;
    }
    for (var ai = 0; ai < debts.badminton.adhocDues.length; ai++) {
      unpaidSessionSet[debts.badminton.adhocDues[ai].session_id] = true;
    }

    var recentSessions = allSessions.filter(function (s) {
      return s.date >= cutoffDateStr || Boolean(unpaidSessionSet[s.session_id]);
    });

    return {
      bootstrap: {
        settings: settings,
        members: members,
        closedMonths: closedMonths
      },
      dashboard: getDashboardData(periodType || 'MONTH', rDate),
      sessions: recentSessions,
      debts: debts,
      schedule: getScheduleData(targetMonth),
      monthlyBill: getMonthlyBillData(targetMonth),
      guestStats: getGuestStatsData(targetMonth)
    };
  } finally {
    endSheetCache_();
  }
}

// ============================================================================
// WRITE SERVICES (SESSION, PAYMENT, MEMBERS, SETTINGS, EDITORS)
// ============================================================================

function resolveQuickNewGuests_(rawNewGuests, rawPaidImmediate, now) {
  var existingMembers = getMembersList(false);
  var membersByNameLower = {};
  for (var em = 0; em < existingMembers.length; em++) {
    membersByNameLower[existingMembers[em].name.toLowerCase()] = existingMembers[em];
  }

  var paidImmediatelySet = {};
  for (var pi = 0; pi < rawPaidImmediate.length; pi++) {
    paidImmediatelySet[String(rawPaidImmediate[pi]).trim()] = true;
  }

  var createdMembers = [];
  var newGuestMemberIds = [];
  var membersToAppend = [];

  for (var gIdx = 0; gIdx < rawNewGuests.length; gIdx++) {
    var gItem = rawNewGuests[gIdx];
    var gName = typeof gItem === 'string' ? gItem.trim() : String((gItem && gItem.name) || '').trim();
    if (!gName) continue;

    var existing = membersByNameLower[gName.toLowerCase()];
    if (existing) {
      newGuestMemberIds.push(existing.member_id);
      if (typeof gItem === 'object' && gItem && toBoolean_(gItem.paidImmediately || gItem.paid_immediately)) {
        paidImmediatelySet[existing.member_id] = true;
      }
      continue;
    }

    var newId = generateId_('MEM') + '_' + gIdx;
    var newMemObj = {
      member_id: newId,
      name: gName,
      aliases: typeof gItem === 'object' && gItem ? String(gItem.aliases || '').trim() : '',
      type: 'GUEST',
      phone: '',
      bank_bin: '',
      bank_name: '',
      account_no: '',
      account_name: '',
      is_active: true,
      created_at: now,
      updated_at: now
    };
    membersToAppend.push(newMemObj);
    createdMembers.push(newMemObj);
    existingMembers.push(newMemObj);
    membersByNameLower[gName.toLowerCase()] = newMemObj;
    newGuestMemberIds.push(newId);

    if (typeof gItem === 'object' && gItem && toBoolean_(gItem.paidImmediately || gItem.paid_immediately)) {
      paidImmediatelySet[newId] = true;
    }
  }

  if (membersToAppend.length > 0) {
    appendObjects_('Members', membersToAppend);
  }

  return {
    existingMembers: existingMembers,
    createdMembers: createdMembers,
    newGuestMemberIds: newGuestMemberIds,
    paidImmediatelySet: paidImmediatelySet
  };
}

function buildDrinkingSplitRows_(sessionId, dateStr, attendeeIds, rawItems, payerId, totalAmountFallback, roundingUnit, membersMap, now) {
  var contributedByMember = {};
  var computedTotal = 0;
  var itemsToSave = [];

  if (Array.isArray(rawItems) && rawItems.length > 0) {
    for (var i = 0; i < rawItems.length; i++) {
      var it = rawItems[i];
      var amt = Math.max(0, toInt_(it.amount, 0));
      var mId = String(it.member_id || it.memberId || '').trim();
      if (amt <= 0 || !mId) continue;
      computedTotal += amt;
      contributedByMember[mId] = (contributedByMember[mId] || 0) + amt;
      itemsToSave.push({
        item_id: generateId_('ITM') + '_' + i,
        session_id: sessionId,
        member_id: mId,
        kind: String(it.kind || 'ITEM').trim().toUpperCase(),
        item_name: String(it.item_name || it.itemName || 'Đóng góp').trim(),
        amount: amt
      });
    }
  } else if (totalAmountFallback > 0 && payerId) {
    computedTotal = totalAmountFallback;
    contributedByMember[payerId] = totalAmountFallback;
    itemsToSave.push({
      item_id: generateId_('ITM') + '_0',
      session_id: sessionId,
      member_id: payerId,
      kind: 'BILL',
      item_name: 'Hóa đơn quán',
      amount: totalAmountFallback
    });
  }

  // Đảm bảo người góp món cũng nằm trong danh sách tính chia
  var seen = {};
  var participantIds = [];
  var allIds = attendeeIds.concat(Object.keys(contributedByMember));
  for (var p = 0; p < allIds.length; p++) {
    var pid = String(allIds[p] || '').trim();
    if (pid && !seen[pid]) {
      seen[pid] = true;
      participantIds.push(pid);
    }
  }

  var perPerson = (participantIds.length > 0 && computedTotal > 0)
    ? Math.round(computedTotal / participantIds.length / roundingUnit) * roundingUnit
    : 0;

  var attendanceRows = [];
  var netSum = 0;
  var maxContribIdx = 0;
  var maxContribVal = -1;

  for (var k = 0; k < participantIds.length; k++) {
    var id = participantIds[k];
    var m = membersMap[id];
    var contrib = contributedByMember[id] || 0;
    var netAmt = perPerson - contrib;
    netSum += netAmt;
    if (contrib > maxContribVal) {
      maxContribVal = contrib;
      maxContribIdx = k;
    }

    attendanceRows.push({
      attendance_id: generateId_('ATT') + '_' + k,
      session_id: sessionId,
      session_date: dateStr,
      session_type: 'DRINKING',
      member_id: id,
      member_type_snapshot: m && m.type === 'GUEST' ? 'GUEST' : 'MAIN',
      fee_amount: perPerson,
      creditor_id: payerId || '',
      contributed_amount: contrib,
      net_amount: netAmt,
      is_paid: netAmt === 0,
      paid_at: netAmt === 0 ? now : '',
      settlement_id: '',
      note: ''
    });
  }

  // Bù sai số làm tròn vào người góp nhiều nhất để tổng net_amount === 0
  if (netSum !== 0 && attendanceRows.length > 0) {
    attendanceRows[maxContribIdx].net_amount -= netSum;
    attendanceRows[maxContribIdx].is_paid = attendanceRows[maxContribIdx].net_amount === 0;
    attendanceRows[maxContribIdx].paid_at = attendanceRows[maxContribIdx].is_paid ? now : '';
  }

  return {
    totalAmount: computedTotal,
    perPersonAmount: perPerson,
    attendeeCount: participantIds.length,
    attendanceRows: attendanceRows,
    itemsToSave: itemsToSave
  };
}

function createSessionRecord(payload, editorEmail) {
  var p = payload || {};
  var settings = getSettingsMap();
  var now = nowIso_();

  var sessionType = String(p.type || p.category || '').trim().toUpperCase();
  if (sessionType !== 'BADMINTON' && sessionType !== 'DRINKING') {
    throw createAppError_('BAD_REQUEST', 'type phải là BADMINTON hoặc DRINKING.');
  }

  var dateStr = String(p.date || todayDateStr_()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw createAppError_('BAD_REQUEST', 'Định dạng date phải là YYYY-MM-DD.');
  }

  var title = String(p.title || (sessionType === 'BADMINTON' ? 'Cầu lông ' + dateStr : 'Ăn nhậu ' + dateStr)).trim();
  var guestFee = Math.max(0, toInt_(p.guestFee !== undefined ? p.guestFee : p.guest_fee, settings.guest_fee));
  var treasurerId = settings.treasurer_member_id;
  var payerId = String(p.payerId || p.payer_id || treasurerId || '').trim();
  var planId = String(p.planId || p.plan_id || '').trim();

  var guestRes = resolveQuickNewGuests_(
    Array.isArray(p.new_guests) ? p.new_guests : (Array.isArray(p.quickNewGuests) ? p.quickNewGuests : []),
    Array.isArray(p.paidImmediatelyMemberIds) ? p.paidImmediatelyMemberIds : (Array.isArray(p.paid_immediately_member_ids) ? p.paid_immediately_member_ids : []),
    now
  );

  var rawAttIds = Array.isArray(p.attendeeIds) ? p.attendeeIds : (Array.isArray(p.attendee_ids) ? p.attendee_ids : []);
  var seen = {};
  var attendeeIds = [];
  var combined = rawAttIds.concat(guestRes.newGuestMemberIds);
  for (var ai = 0; ai < combined.length; ai++) {
    var id = String(combined[ai] || '').trim();
    if (id && !seen[id]) {
      seen[id] = true;
      attendeeIds.push(id);
    }
  }

  var membersMap = buildMembersMap_(guestRes.existingMembers);
  var sessionId = generateId_('SES');
  var attendanceRows = [];
  var itemsToSave = [];
  var totalAmount = Math.max(0, toInt_(p.totalAmount !== undefined ? p.totalAmount : p.total_amount, 0));
  var perPersonAmount = 0;
  var attendeeCount = attendeeIds.length;
  var courtAmount = Math.max(0, toInt_(p.courtAmount !== undefined ? p.courtAmount : p.court_amount, 0));
  var shuttleQty = Math.max(0, toInt_(p.shuttleQty !== undefined ? p.shuttleQty : p.shuttle_qty, 0));
  var shuttleAmount = Math.max(0, toInt_(p.shuttleAmount !== undefined ? p.shuttleAmount : p.shuttle_amount, 0));
  var otherAmount = Math.max(0, toInt_(p.otherAmount !== undefined ? p.otherAmount : p.other_amount, 0));
  var costDetailStr = p.costDetail ? JSON.stringify(p.costDetail) : String(p.cost_detail || '').trim();
  var billingMode = sessionType === 'BADMINTON'
    ? (String(p.billingMode || p.billing_mode || 'MONTHLY').trim().toUpperCase() === 'AD_HOC' ? 'AD_HOC' : 'MONTHLY')
    : '';
  if (sessionType === 'BADMINTON' && billingMode !== 'AD_HOC' && !planId) {
    var scheduleRows = getSheetObjects_('Schedule');
    for (var sr = 0; sr < scheduleRows.length; sr++) {
      var sRow = scheduleRows[sr];
      if (String(sRow.date || '').trim() === dateStr && String(sRow.status || '').toUpperCase() !== 'CANCELLED') {
        planId = String(sRow.plan_id || '').trim();
        break;
      }
    }
  }
  var venueType = sessionType === 'DRINKING' ? String(p.venueType || p.venue_type || 'RESTAURANT').trim().toUpperCase() : '';
  var unit = settings.rounding_unit || 1000;

  if (sessionType === 'BADMINTON') {
    if (billingMode === 'AD_HOC') {
      perPersonAmount = (attendeeIds.length > 0 && totalAmount > 0)
        ? Math.ceil(totalAmount / attendeeIds.length / unit) * unit
        : 0;
      payerId = String(p.payerId || p.payer_id || treasurerId || '').trim();
      for (var i = 0; i < attendeeIds.length; i++) {
        var mId = attendeeIds[i];
        var member = membersMap[mId];
        if (!member) throw createAppError_('NOT_FOUND', 'Không tìm thấy thành viên ' + mId);
        var mType = member.type === 'GUEST' ? 'GUEST' : 'MAIN';
        var isPaid = (mId === payerId) || Boolean(guestRes.paidImmediatelySet[mId]) || perPersonAmount === 0;

        attendanceRows.push({
          attendance_id: generateId_('ATT') + '_' + i,
          session_id: sessionId,
          session_date: dateStr,
          session_type: 'BADMINTON',
          member_id: mId,
          member_type_snapshot: mType,
          fee_amount: perPersonAmount,
          creditor_id: payerId,
          contributed_amount: 0,
          net_amount: isPaid ? 0 : perPersonAmount,
          is_paid: isPaid,
          paid_at: isPaid ? now : '',
          settlement_id: '',
          note: ''
        });
      }
    } else {
      for (var i = 0; i < attendeeIds.length; i++) {
        var mId = attendeeIds[i];
        var member = membersMap[mId];
        if (!member) throw createAppError_('NOT_FOUND', 'Không tìm thấy thành viên ' + mId);
        var mType = member.type === 'GUEST' ? 'GUEST' : 'MAIN';
        var fee = mType === 'GUEST' ? guestFee : 0;
        var isPaid = mType === 'MAIN' || Boolean(guestRes.paidImmediatelySet[mId]) || fee === 0;

        attendanceRows.push({
          attendance_id: generateId_('ATT') + '_' + i,
          session_id: sessionId,
          session_date: dateStr,
          session_type: 'BADMINTON',
          member_id: mId,
          member_type_snapshot: mType,
          fee_amount: fee,
          creditor_id: treasurerId || payerId,
          contributed_amount: 0,
          net_amount: isPaid ? 0 : fee,
          is_paid: isPaid,
          paid_at: isPaid ? now : '',
          settlement_id: '',
          note: ''
        });
      }
    }
  } else {
    var split = buildDrinkingSplitRows_(
      sessionId,
      dateStr,
      attendeeIds,
      p.items,
      payerId,
      totalAmount,
      unit,
      membersMap,
      now
    );
    if (split.attendeeCount === 0) {
      throw createAppError_('BAD_REQUEST', 'Buổi Ăn nhậu phải có ít nhất 1 người tham gia.');
    }
    totalAmount = split.totalAmount;
    perPersonAmount = split.perPersonAmount;
    attendeeCount = split.attendeeCount;
    attendanceRows = split.attendanceRows;
    itemsToSave = split.itemsToSave;
  }

  var sessionObj = {
    session_id: sessionId,
    date: dateStr,
    type: sessionType,
    title: title,
    total_amount: totalAmount,
    guest_fee: (sessionType === 'BADMINTON' && billingMode === 'MONTHLY') ? guestFee : 0,
    payer_id: (sessionType === 'BADMINTON' && billingMode === 'MONTHLY') ? (treasurerId || payerId) : payerId,
    per_person_amount: perPersonAmount,
    attendee_count: attendeeCount,
    receipt_drive_id: String(p.receiptDriveId || p.receipt_drive_id || '').trim(),
    receipt_url: String(p.receiptUrl || p.receipt_url || '').trim(),
    receipt_summary: String(p.receiptSummary || p.receipt_summary || '').trim(),
    note: String(p.note || '').trim(),
    court_amount: sessionType === 'BADMINTON' ? courtAmount : 0,
    shuttle_qty: sessionType === 'BADMINTON' ? shuttleQty : 0,
    shuttle_amount: sessionType === 'BADMINTON' ? shuttleAmount : 0,
    other_amount: sessionType === 'BADMINTON' ? otherAmount : 0,
    cost_detail: sessionType === 'BADMINTON' ? costDetailStr : '',
    venue_type: venueType,
    plan_id: planId,
    billing_mode: billingMode,
    created_by: editorEmail,
    created_at: now,
    updated_at: now
  };

  appendObjects_('Sessions', [sessionObj]);
  if (attendanceRows.length > 0) appendObjects_('Attendance', attendanceRows);
  if (itemsToSave.length > 0) appendObjects_('Session_Items', itemsToSave);

  if (planId) {
    updateRowsByCondition_(
      'Schedule',
      function (row) { return String(row.plan_id || '').trim() === planId; },
      function (row) {
        row.status = 'DONE';
        row.session_id = sessionId;
        row.planned_member_ids = attendeeIds.join(',');
        row.updated_at = now;
        return row;
      }
    );
  }

  return {
    session: sessionObj,
    createdMembers: guestRes.createdMembers,
    attendances: attendanceRows,
    items: itemsToSave
  };
}

function updateSessionRecord(payload, editorEmail) {
  var p = payload || {};
  var sessionId = String(p.sessionId || p.session_id || '').trim();
  if (!sessionId) throw createAppError_('BAD_REQUEST', 'Thiếu sessionId cần cập nhật.');

  var existingSessions = getSessionsList({});
  var oldSession = null;
  for (var sIdx = 0; sIdx < existingSessions.length; sIdx++) {
    if (existingSessions[sIdx].session_id === sessionId) {
      oldSession = existingSessions[sIdx];
      break;
    }
  }
  if (!oldSession) throw createAppError_('NOT_FOUND', 'Không tìm thấy buổi ' + sessionId);

  // Bảo vệ nếu đã có Settlement gắn vào buổi: chỉ cho phép sửa thông tin mô tả / ảnh biên lai
  var allAttRows = getSheetObjects_('Attendance');
  var oldSessionAtts = [];
  var hasSettledAtt = false;
  for (var ca = 0; ca < allAttRows.length; ca++) {
    if (String(allAttRows[ca].session_id || '').trim() === sessionId) {
      oldSessionAtts.push(allAttRows[ca]);
      if (String(allAttRows[ca].settlement_id || '').trim()) {
        hasSettledAtt = true;
      }
    }
  }

  var settings = getSettingsMap();
  var now = nowIso_();
  var sessionType = String(p.type || p.category || oldSession.type).trim().toUpperCase();
  var dateStr = String(p.date || oldSession.date).trim();
  var title = String(p.title || oldSession.title).trim();
  var guestFee = Math.max(0, toInt_(p.guestFee !== undefined ? p.guestFee : p.guest_fee, oldSession.guest_fee || settings.guest_fee));
  var treasurerId = settings.treasurer_member_id;
  var payerId = String(p.payerId || p.payer_id || oldSession.payer_id || treasurerId).trim();
  var billingMode = sessionType === 'BADMINTON'
    ? (String(p.billingMode || p.billing_mode || oldSession.billing_mode || 'MONTHLY').trim().toUpperCase() === 'AD_HOC' ? 'AD_HOC' : 'MONTHLY')
    : '';
  var venueType = sessionType === 'DRINKING' ? String(p.venueType || p.venue_type || oldSession.venue_type || 'RESTAURANT').trim().toUpperCase() : '';

  if (hasSettledAtt) {
    var oldAttIdSet = {};
    var oldAttIdList = [];
    for (var oa = 0; oa < oldSessionAtts.length; oa++) {
      var oMid = String(oldSessionAtts[oa].member_id || '').trim();
      if (oMid && !oldAttIdSet[oMid]) {
        oldAttIdSet[oMid] = true;
        oldAttIdList.push(oMid);
      }
    }
    oldAttIdList.sort();

    var rawCheckIds = Array.isArray(p.attendeeIds) ? p.attendeeIds : (Array.isArray(p.attendee_ids) ? p.attendee_ids : []);
    var newAttIdSet = {};
    var newAttIdList = [];
    for (var na = 0; na < rawCheckIds.length; na++) {
      var nMid = String(rawCheckIds[na] || '').trim();
      if (nMid && !newAttIdSet[nMid]) {
        newAttIdSet[nMid] = true;
        newAttIdList.push(nMid);
      }
    }
    newAttIdList.sort();

    var sameAtts = oldAttIdList.length === newAttIdList.length;
    if (sameAtts) {
      for (var ci = 0; ci < oldAttIdList.length; ci++) {
        if (oldAttIdList[ci] !== newAttIdList[ci]) {
          sameAtts = false;
          break;
        }
      }
    }

    var reqNewGuests = Array.isArray(p.new_guests) ? p.new_guests : (Array.isArray(p.quickNewGuests) ? p.quickNewGuests : []);
    var nextTotalCheck = (p.totalAmount !== undefined || p.total_amount !== undefined)
      ? Math.max(0, toInt_(p.totalAmount !== undefined ? p.totalAmount : p.total_amount, oldSession.total_amount))
      : oldSession.total_amount;
    var sameModeCheck = sessionType !== 'BADMINTON' || (billingMode === (oldSession.billing_mode || 'MONTHLY'));
    var samePayerCheck = sessionType === 'DRINKING' || billingMode !== 'AD_HOC' || (payerId === (oldSession.payer_id || treasurerId || ''));
    var sameGuestFeeCheck = sessionType !== 'BADMINTON' || billingMode !== 'MONTHLY' || (guestFee === (oldSession.guest_fee || settings.guest_fee));

    var sameDrinkingItems = true;
    if (sessionType === 'DRINKING' && Array.isArray(p.items)) {
      var oldSessionItems = getSheetObjects_('Session_Items').filter(function (it) {
        return String(it.session_id || '').trim() === sessionId && toInt_(it.amount, 0) > 0 && String(it.member_id || '').trim() !== '';
      });
      var normOld = oldSessionItems.map(function (it) {
        return String(it.member_id).trim() + '|' + String(it.kind || 'ITEM').trim().toUpperCase() + '|' + toInt_(it.amount, 0) + '|' + String(it.item_name || '').trim();
      }).sort();
      var normNew = p.items.filter(function (it) {
        return toInt_(it.amount, 0) > 0 && String(it.member_id || '').trim() !== '';
      }).map(function (it) {
        return String(it.member_id).trim() + '|' + (String(it.kind || 'ITEM').trim().toUpperCase() === 'BILL' ? 'BILL' : 'ITEM') + '|' + toInt_(it.amount, 0) + '|' + String(it.item_name || '').trim();
      }).sort();
      sameDrinkingItems = normOld.length === normNew.length;
      if (sameDrinkingItems) {
        for (var sii = 0; sii < normOld.length; sii++) {
          if (normOld[sii] !== normNew[sii]) {
            sameDrinkingItems = false;
            break;
          }
        }
      }
    }

    var financialUnchanged = (
      sessionType === oldSession.type &&
      dateStr === oldSession.date &&
      sameModeCheck &&
      nextTotalCheck === oldSession.total_amount &&
      sameGuestFeeCheck &&
      samePayerCheck &&
      sameAtts &&
      reqNewGuests.length === 0 &&
      sameDrinkingItems
    );

    if (!financialUnchanged) {
      throw createAppError_('BAD_REQUEST', 'Buổi đã có khoản thanh toán đối soát, chỉ được sửa Tiêu đề, Ghi chú hoặc Ảnh hóa đơn (không sửa được số tiền / người tham gia).');
    }

    var metaUpdatedSession = null;
    updateRowsByCondition_(
      'Sessions',
      function (row) { return String(row.session_id || '').trim() === sessionId; },
      function (row) {
        row.title = title;
        row.receipt_drive_id = p.receiptDriveId !== undefined ? String(p.receiptDriveId) : row.receipt_drive_id;
        row.receipt_url = p.receiptUrl !== undefined ? String(p.receiptUrl) : row.receipt_url;
        row.receipt_summary = p.receiptSummary !== undefined ? String(p.receiptSummary) : row.receipt_summary;
        row.note = p.note !== undefined ? String(p.note) : row.note;
        if (sessionType === 'DRINKING') row.venue_type = venueType;
        row.updated_at = now;
        metaUpdatedSession = row;
        return row;
      }
    );
    var oldSessItemsRet = getSheetObjects_('Session_Items').filter(function (it) {
      return String(it.session_id || '').trim() === sessionId;
    });
    return { session: metaUpdatedSession, attendances: oldSessionAtts, items: oldSessItemsRet };
  }

  var guestRes = resolveQuickNewGuests_(
    Array.isArray(p.new_guests) ? p.new_guests : (Array.isArray(p.quickNewGuests) ? p.quickNewGuests : []),
    Array.isArray(p.paidImmediatelyMemberIds) ? p.paidImmediatelyMemberIds : (Array.isArray(p.paid_immediately_member_ids) ? p.paid_immediately_member_ids : []),
    now
  );

  var rawAttIds = Array.isArray(p.attendeeIds) ? p.attendeeIds : (Array.isArray(p.attendee_ids) ? p.attendee_ids : []);
  var seen = {};
  var attendeeIds = [];
  var combined = rawAttIds.concat(guestRes.newGuestMemberIds);
  for (var ai = 0; ai < combined.length; ai++) {
    var id = String(combined[ai] || '').trim();
    if (id && !seen[id]) {
      seen[id] = true;
      attendeeIds.push(id);
    }
  }

  var membersMap = buildMembersMap_(guestRes.existingMembers);
  var attendanceRows = [];
  var itemsToSave = [];
  var totalAmount = Math.max(0, toInt_(p.totalAmount !== undefined ? p.totalAmount : p.total_amount, oldSession.total_amount));
  var perPersonAmount = 0;
  var attendeeCount = attendeeIds.length;
  var courtAmount = Math.max(0, toInt_(p.courtAmount !== undefined ? p.courtAmount : p.court_amount, oldSession.court_amount));
  var shuttleQty = Math.max(0, toInt_(p.shuttleQty !== undefined ? p.shuttleQty : p.shuttle_qty, oldSession.shuttle_qty));
  var shuttleAmount = Math.max(0, toInt_(p.shuttleAmount !== undefined ? p.shuttleAmount : p.shuttle_amount, oldSession.shuttle_amount));
  var otherAmount = Math.max(0, toInt_(p.otherAmount !== undefined ? p.otherAmount : p.other_amount, oldSession.other_amount));
  var costDetailStr = p.costDetail ? JSON.stringify(p.costDetail) : (p.cost_detail !== undefined ? String(p.cost_detail) : oldSession.cost_detail);
  var unit = settings.rounding_unit || 1000;

  if (sessionType === 'BADMINTON') {
    if (billingMode === 'AD_HOC') {
      perPersonAmount = (attendeeIds.length > 0 && totalAmount > 0)
        ? Math.ceil(totalAmount / attendeeIds.length / unit) * unit
        : 0;
      for (var i = 0; i < attendeeIds.length; i++) {
        var mId = attendeeIds[i];
        var member = membersMap[mId];
        if (!member) continue;
        var mType = member.type === 'GUEST' ? 'GUEST' : 'MAIN';
        var isPaid = (mId === payerId) || Boolean(guestRes.paidImmediatelySet[mId]) || perPersonAmount === 0;
        attendanceRows.push({
          attendance_id: generateId_('ATT') + '_U_' + i,
          session_id: sessionId,
          session_date: dateStr,
          session_type: 'BADMINTON',
          member_id: mId,
          member_type_snapshot: mType,
          fee_amount: perPersonAmount,
          creditor_id: payerId,
          contributed_amount: 0,
          net_amount: isPaid ? 0 : perPersonAmount,
          is_paid: isPaid,
          paid_at: isPaid ? now : '',
          settlement_id: '',
          note: ''
        });
      }
    } else {
      for (var i = 0; i < attendeeIds.length; i++) {
        var mId = attendeeIds[i];
        var member = membersMap[mId];
        if (!member) continue;
        var mType = member.type === 'GUEST' ? 'GUEST' : 'MAIN';
        var fee = mType === 'GUEST' ? guestFee : 0;
        var isPaid = mType === 'MAIN' || Boolean(guestRes.paidImmediatelySet[mId]) || fee === 0;
        attendanceRows.push({
          attendance_id: generateId_('ATT') + '_U_' + i,
          session_id: sessionId,
          session_date: dateStr,
          session_type: 'BADMINTON',
          member_id: mId,
          member_type_snapshot: mType,
          fee_amount: fee,
          creditor_id: treasurerId || payerId,
          contributed_amount: 0,
          net_amount: isPaid ? 0 : fee,
          is_paid: isPaid,
          paid_at: isPaid ? now : '',
          settlement_id: '',
          note: ''
        });
      }
    }
  } else {
    var split = buildDrinkingSplitRows_(
      sessionId,
      dateStr,
      attendeeIds,
      p.items,
      payerId,
      totalAmount,
      unit,
      membersMap,
      now
    );
    totalAmount = split.totalAmount;
    perPersonAmount = split.perPersonAmount;
    attendeeCount = split.attendeeCount;
    attendanceRows = split.attendanceRows;
    itemsToSave = split.itemsToSave;
  }

  deleteRowsByCondition_('Attendance', function (row) {
    return String(row.session_id || '').trim() === sessionId;
  });
  deleteRowsByCondition_('Session_Items', function (row) {
    return String(row.session_id || '').trim() === sessionId;
  });

  if (attendanceRows.length > 0) appendObjects_('Attendance', attendanceRows);
  if (itemsToSave.length > 0) appendObjects_('Session_Items', itemsToSave);

  var updatedSession = null;
  updateRowsByCondition_(
    'Sessions',
    function (row) { return String(row.session_id || '').trim() === sessionId; },
    function (row) {
      row.date = dateStr;
      row.type = sessionType;
      row.title = title;
      row.total_amount = totalAmount;
      row.guest_fee = (sessionType === 'BADMINTON' && billingMode === 'MONTHLY') ? guestFee : 0;
      row.payer_id = (sessionType === 'BADMINTON' && billingMode === 'MONTHLY') ? (treasurerId || payerId) : payerId;
      row.per_person_amount = perPersonAmount;
      row.attendee_count = attendeeCount;
      row.receipt_drive_id = p.receiptDriveId !== undefined ? String(p.receiptDriveId) : row.receipt_drive_id;
      row.receipt_url = p.receiptUrl !== undefined ? String(p.receiptUrl) : row.receipt_url;
      row.receipt_summary = p.receiptSummary !== undefined ? String(p.receiptSummary) : row.receipt_summary;
      row.note = p.note !== undefined ? String(p.note) : row.note;
      row.court_amount = sessionType === 'BADMINTON' ? courtAmount : 0;
      row.shuttle_qty = sessionType === 'BADMINTON' ? shuttleQty : 0;
      row.shuttle_amount = sessionType === 'BADMINTON' ? shuttleAmount : 0;
      row.other_amount = sessionType === 'BADMINTON' ? otherAmount : 0;
      row.cost_detail = sessionType === 'BADMINTON' ? costDetailStr : '';
      row.venue_type = venueType;
      row.billing_mode = billingMode;
      row.updated_at = now;
      updatedSession = row;
      return row;
    }
  );

  return { session: updatedSession, attendances: attendanceRows, items: itemsToSave };
}

function deleteSessionRecord(payload) {
  var p = payload || {};
  var sessionId = String(p.sessionId || p.session_id || '').trim();
  if (!sessionId) throw createAppError_('BAD_REQUEST', 'Thiếu sessionId cần xóa.');

  var attRows = getSheetObjects_('Attendance');
  for (var i = 0; i < attRows.length; i++) {
    if (String(attRows[i].session_id || '').trim() === sessionId && String(attRows[i].settlement_id || '').trim()) {
      throw createAppError_('BAD_REQUEST', 'Không thể xóa buổi đã có khoản thanh toán được đối soát.');
    }
  }

  var sessions = getSessionsList({});
  var target = null;
  for (var si = 0; si < sessions.length; si++) {
    if (sessions[si].session_id === sessionId) {
      target = sessions[si];
      break;
    }
  }
  if (!target) throw createAppError_('NOT_FOUND', 'Không tìm thấy buổi ' + sessionId);

  deleteRowsByCondition_('Sessions', function (row) {
    return String(row.session_id || '').trim() === sessionId;
  });
  deleteRowsByCondition_('Attendance', function (row) {
    return String(row.session_id || '').trim() === sessionId;
  });
  deleteRowsByCondition_('Session_Items', function (row) {
    return String(row.session_id || '').trim() === sessionId;
  });

  if (target.plan_id) {
    updateRowsByCondition_(
      'Schedule',
      function (row) { return String(row.plan_id || '').trim() === target.plan_id; },
      function (row) {
        row.status = 'PLANNED';
        row.session_id = '';
        row.updated_at = nowIso_();
        return row;
      }
    );
  }

  return { deletedSessionId: sessionId };
}

function confirmPaymentRecord(payload, editorEmail) {
  var p = payload || {};
  var category = String(p.category || 'DRINKING').trim().toUpperCase();
  var mode = String(p.mode || (category === 'BADMINTON' ? 'ITEMS' : 'SIMPLIFIED_TRANSFER')).trim().toUpperCase();
  var fromMemberId = String(p.fromMemberId || p.from_member_id || '').trim();
  var toMemberId = String(p.toMemberId || p.to_member_id || '').trim();
  var method = String(p.method || 'VIETQR').trim().toUpperCase();
  var transferContent = String(p.transferContent || p.transfer_content || '').trim();
  var note = String(p.note || '').trim();
  var now = nowIso_();
  var settlementId = generateId_('SET');

  if (!fromMemberId || !toMemberId) {
    throw createAppError_('BAD_REQUEST', 'Thiếu fromMemberId hoặc toMemberId.');
  }

  if (category === 'BADMINTON') {
    var badAttIds = Array.isArray(p.attendanceIds || p.attendance_ids) ? (p.attendanceIds || p.attendance_ids) : [];
    var badSet = {};
    for (var b = 0; b < badAttIds.length; b++) badSet[String(badAttIds[b]).trim()] = true;
    var paidSum = 0;

    updateRowsByCondition_(
      'Attendance',
      function (row) {
        return String(row.session_type || '').toUpperCase() === 'BADMINTON' &&
          badSet[String(row.attendance_id || '').trim()] &&
          !toBoolean_(row.is_paid);
      },
      function (row) {
        paidSum += toInt_(row.fee_amount, 0);
        row.net_amount = 0;
        row.is_paid = true;
        row.paid_at = now;
        row.settlement_id = settlementId;
        return row;
      }
    );

    var stBad = {
      settlement_id: settlementId,
      from_member_id: fromMemberId,
      to_member_id: toMemberId,
      amount: paidSum || toInt_(p.amount, 0),
      settled_at: now,
      method: method,
      category: 'BADMINTON',
      source_attendance_ids: badAttIds.join(','),
      source_ledger_ids: '',
      is_reconciled: true,
      transfer_content: transferContent,
      note: note,
      confirmed_by: editorEmail
    };
    appendObjects_('Settlements', [stBad]);
    return { settlement: stBad, updatedDebts: computeDebtsData() };
  }

  // --- CATEGORY = DRINKING ---
  function encodeReconciledIds_(ids) {
    var seenIds = {};
    var uniqueIds = [];
    for (var ei = 0; ei < ids.length; ei++) {
      var val = String(ids[ei] || '').trim();
      if (val && !seenIds[val]) {
        seenIds[val] = true;
        uniqueIds.push(val);
      }
    }
    return uniqueIds.length > 0 ? ('REC:' + uniqueIds.join(',')) : '';
  }

  function parseReconciledIds_(raw) {
    var txt = String(raw || '').trim();
    if (txt.indexOf('REC:') !== 0) return [];
    return txt.slice(4).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function applyDrinkingItemsPaymentToRows_(rows, sId, srcSet, prefToMemberId, stId, paidAtStr) {
    var reduction = 0;
    var nextRows = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri];
      var clone = {};
      for (var k in r) {
        if (Object.prototype.hasOwnProperty.call(r, k)) clone[k] = r[k];
      }
      var rAttId = String(clone.attendance_id || '').trim();
      if (String(clone.session_id || '').trim() === sId && srcSet[rAttId] && !toBoolean_(clone.is_paid)) {
        var rAmt = Math.abs(toInt_(clone.net_amount, 0) || toInt_(clone.fee_amount, 0));
        reduction += rAmt;
        clone.net_amount = 0;
        clone.is_paid = true;
        clone.paid_at = paidAtStr;
        clone.settlement_id = stId;
      }
      nextRows.push(clone);
    }
    if (reduction <= 0) return nextRows;

    var creditorEntries = [];
    for (var ci = 0; ci < nextRows.length; ci++) {
      var cr = nextRows[ci];
      if (String(cr.session_id || '').trim() === sId && !toBoolean_(cr.is_paid) && toInt_(cr.net_amount, 0) < 0) {
        creditorEntries.push({ idx: ci, row: cr });
      }
    }
    creditorEntries.sort(function (x, y) {
      var xPref = String(x.row.member_id || '').trim() === prefToMemberId ? 0 : 1;
      var yPref = String(y.row.member_id || '').trim() === prefToMemberId ? 0 : 1;
      if (xPref !== yPref) return xPref - yPref;
      return toInt_(x.row.net_amount, 0) - toInt_(y.row.net_amount, 0);
    });

    var rem = reduction;
    for (var cei = 0; cei < creditorEntries.length; cei++) {
      if (rem <= 0) break;
      var cIdx = creditorEntries[cei].idx;
      var cRow = nextRows[cIdx];
      var cNet = toInt_(cRow.net_amount, 0);
      var canAbsorb = Math.abs(cNet);
      var applyAmt = Math.min(rem, canAbsorb);
      var nextNet = Math.round(cNet + applyAmt);
      var isClosed = nextNet >= 0;
      cRow.net_amount = isClosed ? 0 : nextNet;
      cRow.is_paid = isClosed;
      if (isClosed) {
        cRow.paid_at = paidAtStr;
        cRow.settlement_id = stId;
      }
      rem -= applyAmt;
    }
    return nextRows;
  }

  if (mode === 'ITEMS') {
    var dAttIds = Array.isArray(p.attendanceIds || p.attendance_ids) ? (p.attendanceIds || p.attendance_ids) : [];
    var dSet = {};
    for (var i = 0; i < dAttIds.length; i++) dSet[String(dAttIds[i]).trim()] = true;
    var totalPaid = 0;
    var affectedSidsMap = {};
    var allAttForItems = getSheetObjects_('Attendance');
    for (var ai = 0; ai < allAttForItems.length; ai++) {
      var rowIt = allAttForItems[ai];
      var attIdIt = String(rowIt.attendance_id || '').trim();
      if (String(rowIt.session_type || '').toUpperCase() === 'DRINKING' && dSet[attIdIt] && !toBoolean_(rowIt.is_paid)) {
        totalPaid += Math.abs(toInt_(rowIt.net_amount, 0) || toInt_(rowIt.fee_amount, 0));
        var sidIt = String(rowIt.session_id || '').trim();
        if (sidIt) affectedSidsMap[sidIt] = true;
      }
    }

    var updatedAttById = {};
    var affectedSidKeys = Object.keys(affectedSidsMap);
    for (var ski = 0; ski < affectedSidKeys.length; ski++) {
      var targetSid = affectedSidKeys[ski];
      var sessRows = allAttForItems.filter(function (a) {
        return String(a.session_id || '').trim() === targetSid && String(a.session_type || '').toUpperCase() === 'DRINKING';
      });
      var nextSessRows = applyDrinkingItemsPaymentToRows_(sessRows, targetSid, dSet, toMemberId, settlementId, now);
      for (var nri = 0; nri < nextSessRows.length; nri++) {
        updatedAttById[String(nextSessRows[nri].attendance_id || '').trim()] = nextSessRows[nri];
      }
    }

    updateRowsByCondition_(
      'Attendance',
      function (row) { return Boolean(updatedAttById[String(row.attendance_id || '').trim()]); },
      function (row) {
        var upd = updatedAttById[String(row.attendance_id || '').trim()];
        if (!upd) return row;
        row.net_amount = upd.net_amount;
        row.is_paid = upd.is_paid;
        row.paid_at = upd.paid_at;
        row.settlement_id = upd.settlement_id;
        return row;
      }
    );

    var stItem = {
      settlement_id: settlementId,
      from_member_id: fromMemberId,
      to_member_id: toMemberId,
      amount: totalPaid || toInt_(p.amount, 0),
      settled_at: now,
      method: method,
      category: 'DRINKING',
      source_attendance_ids: dAttIds.join(','),
      source_ledger_ids: '',
      is_reconciled: true,
      transfer_content: transferContent,
      note: note,
      confirmed_by: editorEmail
    };
    appendObjects_('Settlements', [stItem]);
    return { settlement: stItem, updatedDebts: computeDebtsData() };
  }

  // mode = SIMPLIFIED_TRANSFER
  var amount = toInt_(p.amount, 0);
  if (amount <= 0) throw createAppError_('BAD_REQUEST', 'Số tiền thanh toán phải lớn hơn 0.');

  var stSimp = {
    settlement_id: settlementId,
    from_member_id: fromMemberId,
    to_member_id: toMemberId,
    amount: amount,
    settled_at: now,
    method: method,
    category: 'DRINKING',
    source_attendance_ids: '',
    source_ledger_ids: '',
    is_reconciled: false,
    transfer_content: transferContent,
    note: note,
    confirmed_by: editorEmail
  };
  appendObjects_('Settlements', [stSimp]);

  var debtsAfter = computeDebtsData();
  if (debtsAfter.drinking.simplifiedTransfers.length === 0) {
    var allStsAfter = getSheetObjects_('Settlements');
    var batchIds = [];
    for (var bi = 0; bi < allStsAfter.length; bi++) {
      var bRow = allStsAfter[bi];
      if (String(bRow.category || 'DRINKING').toUpperCase() === 'DRINKING' && !toBoolean_(bRow.is_reconciled)) {
        batchIds.push(String(bRow.settlement_id || '').trim());
      }
    }
    var encodedBatch = encodeReconciledIds_(batchIds);
    stSimp.is_reconciled = true;
    stSimp.source_ledger_ids = encodedBatch;

    updateRowsByCondition_(
      'Attendance',
      function (row) { return String(row.session_type || '').toUpperCase() === 'DRINKING' && !toBoolean_(row.is_paid); },
      function (row) {
        row.is_paid = true;
        row.paid_at = now;
        row.settlement_id = settlementId;
        return row;
      }
    );
    updateRowsByCondition_(
      'Settlements',
      function (row) { return String(row.category || 'DRINKING').toUpperCase() === 'DRINKING' && !toBoolean_(row.is_reconciled); },
      function (row) {
        row.is_reconciled = true;
        if (String(row.settlement_id || '').trim() === settlementId) {
          row.source_ledger_ids = encodedBatch;
        }
        return row;
      }
    );
  }

  return {
    settlement: stSimp,
    updatedDebts: computeDebtsData()
  };
}

/**
 * Hoàn tác một giao dịch thanh toán đã xác nhận trong Settlements (Cầu lông & Ăn nhậu).
 */
function undoSettlementRecord(payload) {
  var p = payload || {};
  var settlementId = String(p.settlementId || p.settlement_id || '').trim();
  if (!settlementId) throw createAppError_('BAD_REQUEST', 'Thiếu settlementId cần hoàn tác.');

  var settlements = getSheetObjects_('Settlements');
  var target = null;
  for (var i = 0; i < settlements.length; i++) {
    if (String(settlements[i].settlement_id || '').trim() === settlementId) {
      target = settlements[i];
      break;
    }
  }
  if (!target) throw createAppError_('NOT_FOUND', 'Không tìm thấy giao dịch thanh toán ' + settlementId);

  function parseRecIds_(raw) {
    var txt = String(raw || '').trim();
    if (txt.indexOf('REC:') !== 0) return [];
    return txt.slice(4).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function applyItemsReplay_(rows, sId, srcSet, prefToMemberId, stId, paidAtStr) {
    var reduction = 0;
    var nextRows = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri];
      var clone = {};
      for (var k in r) {
        if (Object.prototype.hasOwnProperty.call(r, k)) clone[k] = r[k];
      }
      var rAttId = String(clone.attendance_id || '').trim();
      if (String(clone.session_id || '').trim() === sId && srcSet[rAttId] && !toBoolean_(clone.is_paid)) {
        var rAmt = Math.abs(toInt_(clone.net_amount, 0) || toInt_(clone.fee_amount, 0));
        reduction += rAmt;
        clone.net_amount = 0;
        clone.is_paid = true;
        clone.paid_at = paidAtStr;
        clone.settlement_id = stId;
      }
      nextRows.push(clone);
    }
    if (reduction <= 0) return nextRows;

    var creditorEntries = [];
    for (var ci = 0; ci < nextRows.length; ci++) {
      var cr = nextRows[ci];
      if (String(cr.session_id || '').trim() === sId && !toBoolean_(cr.is_paid) && toInt_(cr.net_amount, 0) < 0) {
        creditorEntries.push({ idx: ci, row: cr });
      }
    }
    creditorEntries.sort(function (x, y) {
      var xPref = String(x.row.member_id || '').trim() === prefToMemberId ? 0 : 1;
      var yPref = String(y.row.member_id || '').trim() === prefToMemberId ? 0 : 1;
      if (xPref !== yPref) return xPref - yPref;
      return toInt_(x.row.net_amount, 0) - toInt_(y.row.net_amount, 0);
    });

    var rem = reduction;
    for (var cei = 0; cei < creditorEntries.length; cei++) {
      if (rem <= 0) break;
      var cIdx = creditorEntries[cei].idx;
      var cRow = nextRows[cIdx];
      var cNet = toInt_(cRow.net_amount, 0);
      var canAbsorb = Math.abs(cNet);
      var applyAmt = Math.min(rem, canAbsorb);
      var nextNet = Math.round(cNet + applyAmt);
      var isClosed = nextNet >= 0;
      cRow.net_amount = isClosed ? 0 : nextNet;
      cRow.is_paid = isClosed;
      if (isClosed) {
        cRow.paid_at = paidAtStr;
        cRow.settlement_id = stId;
      }
      rem -= applyAmt;
    }
    return nextRows;
  }

  var category = String(target.category || 'DRINKING').trim().toUpperCase();
  var sourceIds = String(target.source_attendance_ids || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
  var sourceSet = {};
  for (var s = 0; s < sourceIds.length; s++) sourceSet[sourceIds[s]] = true;

  if (category === 'BADMINTON') {
    updateRowsByCondition_(
      'Attendance',
      function (row) {
        var attId = String(row.attendance_id || '').trim();
        var sid = String(row.settlement_id || '').trim();
        return sid === settlementId || Boolean(sourceSet[attId]);
      },
      function (row) {
        var fee = toInt_(row.fee_amount, 0);
        row.is_paid = false;
        row.paid_at = '';
        row.settlement_id = '';
        row.net_amount = fee;
        return row;
      }
    );
  } else if (sourceIds.length === 0) {
    // DRINKING SIMPLIFIED_TRANSFER
    if (toBoolean_(target.is_reconciled)) {
      var ownBatchIds = parseRecIds_(target.source_ledger_ids);
      var closingSt = ownBatchIds.length > 0 ? target : null;
      if (!closingSt) {
        for (var si = 0; si < settlements.length; si++) {
          var cand = settlements[si];
          var candIds = parseRecIds_(cand.source_ledger_ids);
          if (candIds.indexOf(settlementId) >= 0) {
            closingSt = cand;
            break;
          }
        }
      }

      if (closingSt) {
        var closingId = String(closingSt.settlement_id || '').trim();
        var batchIds = parseRecIds_(closingSt.source_ledger_ids);
        var batchSet = {};
        for (var bi = 0; bi < batchIds.length; bi++) {
          if (batchIds[bi] !== settlementId) batchSet[batchIds[bi]] = true;
        }
        updateRowsByCondition_(
          'Attendance',
          function (row) { return String(row.settlement_id || '').trim() === closingId; },
          function (row) {
            row.is_paid = false;
            row.paid_at = '';
            row.settlement_id = '';
            return row;
          }
        );
        updateRowsByCondition_(
          'Settlements',
          function (row) { return Boolean(batchSet[String(row.settlement_id || '').trim()]); },
          function (row) {
            row.is_reconciled = false;
            if (String(row.settlement_id || '').trim() === closingId) {
              row.source_ledger_ids = '';
            }
            return row;
          }
        );
      } else {
        updateRowsByCondition_(
          'Attendance',
          function (row) { return String(row.settlement_id || '').trim() === settlementId; },
          function (row) {
            row.is_paid = false;
            row.paid_at = '';
            row.settlement_id = '';
            return row;
          }
        );
      }
    }
  } else {
    // DRINKING ITEMS: tính lại gốc buổi bị ảnh hưởng và replay các giao dịch ITEMS còn lại
    var allAttUndo = getSheetObjects_('Attendance');
    var affectedSessionSet = {};
    for (var ui = 0; ui < allAttUndo.length; ui++) {
      var aRow = allAttUndo[ui];
      var aAttId = String(aRow.attendance_id || '').trim();
      var aSid = String(aRow.settlement_id || '').trim();
      if (aSid === settlementId || Boolean(sourceSet[aAttId])) {
        var sIdVal = String(aRow.session_id || '').trim();
        if (sIdVal) affectedSessionSet[sIdVal] = true;
      }
    }

    var affectedSids = Object.keys(affectedSessionSet);
    if (affectedSids.length > 0) {
      var membersMap = buildMembersMap_(getMembersList(false));
      var allItems = getSheetObjects_('Session_Items');
      var allSessions = getSessionsList({});
      var settings = getSettingsMap();
      var unit = settings.rounding_unit || 1000;
      var now = nowIso_();

      var settlementMap = {};
      var remainingItemSettlements = [];
      for (var sti = 0; sti < settlements.length; sti++) {
        var stRow = settlements[sti];
        var stRowId = String(stRow.settlement_id || '').trim();
        settlementMap[stRowId] = stRow;
        if (
          stRowId !== settlementId &&
          String(stRow.category || 'DRINKING').trim().toUpperCase() === 'DRINKING' &&
          String(stRow.source_attendance_ids || '').trim() !== ''
        ) {
          remainingItemSettlements.push(stRow);
        }
      }
      remainingItemSettlements.sort(function (a, b) {
        return String(a.settled_at || '').localeCompare(String(b.settled_at || ''));
      });

      var updatedUndoAttById = {};
      for (var asi = 0; asi < affectedSids.length; asi++) {
        var sId = affectedSids[asi];
        var sess = null;
        for (var k = 0; k < allSessions.length; k++) {
          if (allSessions[k].session_id === sId) {
            sess = allSessions[k];
            break;
          }
        }
        if (!sess) continue;

        var sessAtts = allAttUndo.filter(function (a) {
          return String(a.session_id || '').trim() === sId;
        });
        if (sessAtts.length === 0) continue;

        var sessItems = allItems.filter(function (it) {
          return String(it.session_id || '').trim() === sId;
        });
        var attendeeIds = sessAtts.map(function (a) { return String(a.member_id || '').trim(); });
        var recomputed = buildDrinkingSplitRows_(
          sId,
          sess.date,
          attendeeIds,
          sessItems,
          sess.payer_id,
          sess.total_amount,
          unit,
          membersMap,
          now
        );

        var netByMember = {};
        for (var ri = 0; ri < recomputed.attendanceRows.length; ri++) {
          netByMember[recomputed.attendanceRows[ri].member_id] = recomputed.attendanceRows[ri];
        }

        var workingRows = [];
        for (var wi = 0; wi < sessAtts.length; wi++) {
          var orig = sessAtts[wi];
          var wClone = {};
          for (var ok in orig) {
            if (Object.prototype.hasOwnProperty.call(orig, ok)) wClone[ok] = orig[ok];
          }
          var rRow = netByMember[String(orig.member_id || '').trim()];
          if (rRow) {
            var isZero = rRow.net_amount === 0;
            wClone.net_amount = rRow.net_amount;
            wClone.is_paid = isZero;
            wClone.paid_at = isZero ? (orig.paid_at || now) : '';
            wClone.settlement_id = '';
          }
          workingRows.push(wClone);
        }

        for (var rmi = 0; rmi < remainingItemSettlements.length; rmi++) {
          var remSt = remainingItemSettlements[rmi];
          var remIds = String(remSt.source_attendance_ids || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
          var remSet = {};
          var hasMatch = false;
          for (var rii = 0; rii < remIds.length; rii++) remSet[remIds[rii]] = true;
          for (var wci = 0; wci < workingRows.length; wci++) {
            if (remSet[String(workingRows[wci].attendance_id || '').trim()]) {
              hasMatch = true;
              break;
            }
          }
          if (!hasMatch) continue;
          workingRows = applyItemsReplay_(
            workingRows,
            sId,
            remSet,
            String(remSt.to_member_id || '').trim(),
            String(remSt.settlement_id || '').trim(),
            String(remSt.settled_at || now)
          );
        }

        for (var fi = 0; fi < workingRows.length; fi++) {
          var wFin = workingRows[fi];
          var origFin = sessAtts[fi];
          if (
            origFin &&
            !toBoolean_(wFin.is_paid) &&
            toBoolean_(origFin.is_paid) &&
            String(origFin.settlement_id || '').trim() &&
            String(origFin.settlement_id || '').trim() !== settlementId
          ) {
            var origSt = settlementMap[String(origFin.settlement_id || '').trim()];
            if (origSt && toBoolean_(origSt.is_reconciled) && !String(origSt.source_attendance_ids || '').trim()) {
              wFin.is_paid = true;
              wFin.paid_at = origFin.paid_at;
              wFin.settlement_id = origFin.settlement_id;
            }
          }
          updatedUndoAttById[String(wFin.attendance_id || '').trim()] = wFin;
        }
      }

      updateRowsByCondition_(
        'Attendance',
        function (row) { return Boolean(updatedUndoAttById[String(row.attendance_id || '').trim()]); },
        function (row) {
          var upd = updatedUndoAttById[String(row.attendance_id || '').trim()];
          if (!upd) return row;
          row.net_amount = upd.net_amount;
          row.is_paid = upd.is_paid;
          row.paid_at = upd.paid_at;
          row.settlement_id = upd.settlement_id;
          return row;
        }
      );
    }
  }

  deleteRowsByCondition_('Settlements', function (row) {
    return String(row.settlement_id || '').trim() === settlementId;
  });

  return {
    undoneSettlementId: settlementId,
    updatedDebts: computeDebtsData()
  };
}

/**
 * Liên kết email Google của người dùng thường với 1 thành viên trong tab Members.
 */
function linkMemberEmailRecord(payload, userEmail) {
  var p = payload || {};
  var memberId = String(p.memberId || p.member_id || '').trim();
  var email = String(userEmail || '').trim().toLowerCase();
  if (!memberId) throw createAppError_('BAD_REQUEST', 'Thiếu memberId cần liên kết.');
  if (!email) throw createAppError_('UNAUTHORIZED', 'Thiếu email tài khoản Google.');

  var members = getMembersList(false);
  var target = null;
  for (var i = 0; i < members.length; i++) {
    if (members[i].member_id === memberId) {
      target = members[i];
      break;
    }
  }
  if (!target) throw createAppError_('NOT_FOUND', 'Không tìm thấy thành viên ' + memberId);
  if (target.email && target.email !== email) {
    throw createAppError_('BAD_REQUEST', 'Thành viên ' + target.name + ' đã được liên kết với tài khoản Google khác.');
  }

  var now = nowIso_();
  // Gỡ liên kết cũ của chính userEmail nếu trước đó gắn nhầm thành viên khác
  updateRowsByCondition_(
    'Members',
    function (row) {
      return String(row.email || '').trim().toLowerCase() === email &&
        String(row.member_id || '').trim() !== memberId;
    },
    function (row) {
      row.email = '';
      row.updated_at = now;
      return row;
    }
  );

  var updatedMember = null;
  updateRowsByCondition_(
    'Members',
    function (row) { return String(row.member_id || '').trim() === memberId; },
    function (row) {
      row.email = email;
      row.updated_at = now;
      updatedMember = row;
      return row;
    }
  );

  return {
    linkedMemberId: memberId,
    email: email,
    member: updatedMember
  };
}

function upsertMemberRecord(payload) {
  var p = payload || {};
  var name = String(p.name || '').trim();
  if (!name) throw createAppError_('BAD_REQUEST', 'Tên thành viên không được để trống.');

  var memberId = String(p.memberId || p.member_id || '').trim();
  var now = nowIso_();
  var type = String(p.type || 'MAIN').trim().toUpperCase();
  if (type !== 'MAIN' && type !== 'GUEST') type = 'MAIN';

  var isActive = p.isActive !== undefined ? toBoolean_(p.isActive)
    : (p.is_active !== undefined ? toBoolean_(p.is_active) : true);

  if (!memberId) {
    var newMember = {
      member_id: generateId_('MEM'),
      name: name,
      aliases: String(p.aliases || '').trim(),
      type: type,
      phone: String(p.phone || '').trim(),
      bank_bin: String(p.bankBin || p.bank_bin || '').trim(),
      bank_name: String(p.bankName || p.bank_name || '').trim(),
      account_no: String(p.accountNo || p.account_no || '').trim(),
      account_name: String(p.accountName || p.account_name || '').trim().toUpperCase(),
      email: String(p.email || '').trim().toLowerCase(),
      is_active: isActive,
      created_at: now,
      updated_at: now
    };
    appendObjects_('Members', [newMember]);
    return { member: newMember };
  }

  var updatedObj = null;
  var count = updateRowsByCondition_(
    'Members',
    function (row) { return String(row.member_id || '').trim() === memberId; },
    function (row) {
      row.name = name;
      row.aliases = p.aliases !== undefined ? String(p.aliases).trim() : row.aliases;
      row.type = type;
      row.phone = p.phone !== undefined ? String(p.phone).trim() : row.phone;
      row.bank_bin = (p.bankBin !== undefined || p.bank_bin !== undefined)
        ? String(p.bankBin !== undefined ? p.bankBin : p.bank_bin).trim() : row.bank_bin;
      row.bank_name = (p.bankName !== undefined || p.bank_name !== undefined)
        ? String(p.bankName !== undefined ? p.bankName : p.bank_name).trim() : row.bank_name;
      row.account_no = (p.accountNo !== undefined || p.account_no !== undefined)
        ? String(p.accountNo !== undefined ? p.accountNo : p.account_no).trim() : row.account_no;
      row.account_name = (p.accountName !== undefined || p.account_name !== undefined)
        ? String(p.accountName !== undefined ? p.accountName : p.account_name).trim().toUpperCase() : row.account_name;
      row.is_active = isActive;
      row.updated_at = now;
      updatedObj = row;
      return row;
    }
  );

  if (count === 0) throw createAppError_('NOT_FOUND', 'Không tìm thấy thành viên ' + memberId);
  return { member: updatedObj };
}

function updateSettingsRecord(payload, editorEmail) {
  var p = payload || {};
  var incoming = (p.settings && typeof p.settings === 'object') ? p.settings : p;
  var keys = Object.keys(incoming);
  if (keys.length === 0) throw createAppError_('BAD_REQUEST', 'Không có khóa cấu hình nào để cập nhật.');

  var now = nowIso_();
  var existing = getSheetObjects_('Settings');
  var existingKeys = {};
  for (var i = 0; i < existing.length; i++) {
    existingKeys[String(existing[i].key || '').trim()] = true;
  }

  var toAppend = [];
  for (var k = 0; k < keys.length; k++) {
    var key = String(keys[k]).trim();
    if (!key || key === 'action' || key === 'idToken' || key === 'id_token') continue;
    var valStr = String(incoming[key] !== undefined && incoming[key] !== null ? incoming[key] : '');

    if (existingKeys[key]) {
      updateRowsByCondition_(
        'Settings',
        function (row) { return String(row.key || '').trim() === key; },
        function (row) {
          row.value = valStr;
          row.updated_at = now;
          row.updated_by = editorEmail;
          return row;
        }
      );
    } else {
      toAppend.push({
        key: key,
        value: valStr,
        description: '',
        updated_at: now,
        updated_by: editorEmail
      });
    }
  }

  if (toAppend.length > 0) appendObjects_('Settings', toAppend);
  return { settings: getSettingsMap() };
}

function getEditorsList() {
  var rows = getSheetObjects_('Editors');
  var list = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    list.push({
      email: String(r.email || '').trim().toLowerCase(),
      name: String(r.name || '').trim(),
      role: String(r.role || 'EDITOR').trim().toUpperCase(),
      is_active: toBoolean_(r.is_active),
      added_at: String(r.added_at || '')
    });
  }
  return list;
}

function manageEditorsRecord(payload, authInfo) {
  if (!authInfo || authInfo.role !== 'ADMIN') {
    throw createAppError_('FORBIDDEN', 'Chỉ tài khoản có vai trò ADMIN mới được quản lý danh sách Editors.');
  }

  var p = payload || {};
  var operation = String(p.operation || 'UPSERT').trim().toUpperCase();
  var email = String(p.email || '').trim().toLowerCase();
  if (!email) throw createAppError_('BAD_REQUEST', 'Thiếu email của Editor.');

  if (operation === 'DELETE') {
    if (email === String(authInfo.email || '').trim().toLowerCase()) {
      throw createAppError_('BAD_REQUEST', 'Không thể tự xóa chính tài khoản ADMIN đang đăng nhập.');
    }
    deleteRowsByCondition_('Editors', function (row) {
      return String(row.email || '').trim().toLowerCase() === email;
    });
    return { editors: getEditorsList() };
  }

  var name = String(p.name || email).trim();
  var role = String(p.role || 'EDITOR').trim().toUpperCase();
  if (role !== 'ADMIN' && role !== 'EDITOR') role = 'EDITOR';
  var isActive = p.isActive !== undefined ? toBoolean_(p.isActive)
    : (p.is_active !== undefined ? toBoolean_(p.is_active) : true);

  var existing = getSheetObjects_('Editors');
  var found = false;
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i].email || '').trim().toLowerCase() === email) {
      found = true;
      break;
    }
  }

  if (found) {
    updateRowsByCondition_(
      'Editors',
      function (row) { return String(row.email || '').trim().toLowerCase() === email; },
      function (row) {
        if (operation !== 'TOGGLE_ACTIVE') {
          row.name = name;
          row.role = role;
        }
        row.is_active = isActive;
        return row;
      }
    );
  } else {
    appendObjects_('Editors', [{
      email: email,
      name: name,
      role: role,
      is_active: isActive,
      added_at: nowIso_()
    }]);
  }

  return { editors: getEditorsList() };
}

function buildMembersMap_(membersList) {
  var map = {};
  for (var i = 0; i < membersList.length; i++) {
    map[membersList[i].member_id] = membersList[i];
  }
  return map;
}

// ============================================================================
// HYBRID SYNC (EXPORT / IMPORT RAW TABLES - ADMIN ONLY)
// ============================================================================

function exportRawTablesRecord(authInfo) {
  if (!authInfo || authInfo.role !== 'ADMIN') {
    throw createAppError_('FORBIDDEN', 'Chỉ ADMIN mới được xuất toàn bộ dữ liệu thô để đồng bộ.');
  }

  beginSheetCache_();
  try {
    var membersRaw = getSheetObjects_('Members').map(function (r) {
      return {
        member_id: String(r.member_id || '').trim(),
        name: String(r.name || '').trim(),
        aliases: String(r.aliases || '').trim(),
        type: String(r.type || 'MAIN').trim().toUpperCase() === 'GUEST' ? 'GUEST' : 'MAIN',
        phone: String(r.phone || '').trim(),
        bank_bin: String(r.bank_bin || '').trim(),
        bank_name: String(r.bank_name || '').trim(),
        account_no: String(r.account_no || '').trim(),
        account_name: String(r.account_name || '').trim(),
        email: String(r.email || '').trim().toLowerCase(),
        is_active: toBoolean_(r.is_active),
        created_at: String(r.created_at || ''),
        updated_at: String(r.updated_at || '')
      };
    });

    var sessionsRaw = getSheetObjects_('Sessions').map(function (r) {
      return {
        session_id: String(r.session_id || '').trim(),
        date: String(r.date || '').trim(),
        type: String(r.type || '').trim().toUpperCase(),
        title: String(r.title || '').trim(),
        total_amount: toInt_(r.total_amount, 0),
        guest_fee: toInt_(r.guest_fee, 0),
        payer_id: String(r.payer_id || '').trim(),
        per_person_amount: toInt_(r.per_person_amount, 0),
        attendee_count: toInt_(r.attendee_count, 0),
        receipt_drive_id: String(r.receipt_drive_id || '').trim(),
        receipt_url: String(r.receipt_url || '').trim(),
        receipt_summary: String(r.receipt_summary || '').trim(),
        note: String(r.note || '').trim(),
        court_amount: toInt_(r.court_amount, 0),
        shuttle_qty: toInt_(r.shuttle_qty, 0),
        shuttle_amount: toInt_(r.shuttle_amount, 0),
        other_amount: toInt_(r.other_amount, 0),
        cost_detail: String(r.cost_detail || ''),
        venue_type: String(r.venue_type || '').trim(),
        plan_id: String(r.plan_id || '').trim(),
        billing_mode: String(r.billing_mode || '').trim().toUpperCase(),
        created_by: String(r.created_by || '').trim(),
        created_at: String(r.created_at || ''),
        updated_at: String(r.updated_at || '')
      };
    });

    var attendanceRaw = getSheetObjects_('Attendance').map(function (r) {
      return {
        attendance_id: String(r.attendance_id || '').trim(),
        session_id: String(r.session_id || '').trim(),
        session_date: String(r.session_date || '').trim(),
        session_type: String(r.session_type || '').trim().toUpperCase(),
        member_id: String(r.member_id || '').trim(),
        member_type_snapshot: String(r.member_type_snapshot || 'MAIN').trim().toUpperCase(),
        fee_amount: toInt_(r.fee_amount, 0),
        creditor_id: String(r.creditor_id || '').trim(),
        contributed_amount: toInt_(r.contributed_amount, 0),
        net_amount: toInt_(r.net_amount, 0),
        is_paid: toBoolean_(r.is_paid),
        paid_at: String(r.paid_at || ''),
        settlement_id: String(r.settlement_id || '').trim(),
        note: String(r.note || '').trim()
      };
    });

    var sessionItemsRaw = getSheetObjects_('Session_Items').map(function (r) {
      return {
        item_id: String(r.item_id || '').trim(),
        session_id: String(r.session_id || '').trim(),
        member_id: String(r.member_id || '').trim(),
        kind: String(r.kind || 'ITEM').trim().toUpperCase(),
        item_name: String(r.item_name || '').trim(),
        amount: toInt_(r.amount, 0)
      };
    });

    var scheduleRaw = getSheetObjects_('Schedule').map(function (r) {
      return {
        plan_id: String(r.plan_id || '').trim(),
        date: String(r.date || '').trim(),
        start_time: String(r.start_time || '20:00').trim(),
        end_time: String(r.end_time || '21:30').trim(),
        courts: toInt_(r.courts, 2),
        planned_member_ids: String(r.planned_member_ids || '').trim(),
        status: String(r.status || 'PLANNED').trim().toUpperCase(),
        session_id: String(r.session_id || '').trim(),
        note: String(r.note || '').trim(),
        created_at: String(r.created_at || ''),
        updated_at: String(r.updated_at || '')
      };
    });

    var monthlyBillsRaw = getSheetObjects_('Monthly_Bills').map(function (r) {
      var hasOverride = r.actual_cost_override !== '' && r.actual_cost_override !== null && r.actual_cost_override !== undefined;
      return {
        month: String(r.month || '').trim(),
        estimate: toInt_(r.estimate, 0),
        carry_in: toInt_(r.carry_in, 0),
        to_collect: toInt_(r.to_collect, 0),
        member_count: toInt_(r.member_count, 0),
        per_member: toInt_(r.per_member, 0),
        billed_total: toInt_(r.billed_total, 0),
        actual_cost: toInt_(r.actual_cost, 0),
        actual_cost_override: hasOverride ? toInt_(r.actual_cost_override, 0) : null,
        guest_income: toInt_(r.guest_income, 0),
        carry_out: toInt_(r.carry_out, 0),
        status: String(r.status || 'OPEN').trim().toUpperCase(),
        created_by: String(r.created_by || '').trim(),
        closed_at: String(r.closed_at || ''),
        updated_at: String(r.updated_at || ''),
        court_fee: toInt_(r.court_fee, 0),
        shuttle_tube_qty: toFloat_(r.shuttle_tube_qty, 0),
        shuttle_tube_price: toInt_(r.shuttle_tube_price, 0),
        shuttle_tube_amount: toInt_(r.shuttle_tube_amount, 0),
        prev_overtime_fee: toInt_(r.prev_overtime_fee, 0),
        bill_detail: String(r.bill_detail || ''),
        shuttle_contributions: String(r.shuttle_contributions || ''),
        applied_credits_total: toInt_(r.applied_credits_total, 0),
        carry_over_credits: String(r.carry_over_credits || '')
      };
    });

    var monthlyDuesRaw = getSheetObjects_('Monthly_Dues').map(function (r) {
      var amt = toInt_(r.amount, 0);
      return {
        due_id: String(r.due_id || '').trim(),
        month: String(r.month || '').trim(),
        member_id: String(r.member_id || '').trim(),
        amount: amt,
        base_amount: toInt_(r.base_amount, amt),
        credit_amount: toInt_(r.credit_amount, 0),
        credit_note: String(r.credit_note || '').trim(),
        is_paid: toBoolean_(r.is_paid),
        paid_at: String(r.paid_at || ''),
        confirmed_by: String(r.confirmed_by || '').trim()
      };
    });

    var settlementsRaw = getSheetObjects_('Settlements').map(function (r) {
      return {
        settlement_id: String(r.settlement_id || '').trim(),
        from_member_id: String(r.from_member_id || '').trim(),
        to_member_id: String(r.to_member_id || '').trim(),
        amount: toInt_(r.amount, 0),
        settled_at: String(r.settled_at || ''),
        method: String(r.method || 'VIETQR').trim().toUpperCase(),
        category: String(r.category || 'DRINKING').trim().toUpperCase(),
        source_attendance_ids: String(r.source_attendance_ids || '').trim(),
        source_ledger_ids: String(r.source_ledger_ids || '').trim(),
        is_reconciled: toBoolean_(r.is_reconciled),
        transfer_content: String(r.transfer_content || '').trim(),
        note: String(r.note || '').trim(),
        confirmed_by: String(r.confirmed_by || '').trim()
      };
    });

    var fundLedgerRaw = getSheetObjects_('Fund_Ledger').map(function (r) {
      return {
        ledger_id: String(r.ledger_id || '').trim(),
        date: String(r.date || '').trim(),
        type: String(r.type || '').trim(),
        category: String(r.category || '').trim(),
        amount: toInt_(r.amount, 0),
        member_id: String(r.member_id || '').trim(),
        session_id: String(r.session_id || '').trim(),
        attendance_id: String(r.attendance_id || '').trim(),
        period: String(r.period || '').trim(),
        is_paid: toBoolean_(r.is_paid),
        paid_at: String(r.paid_at || ''),
        settlement_id: String(r.settlement_id || '').trim(),
        receipt_drive_id: String(r.receipt_drive_id || '').trim(),
        receipt_url: String(r.receipt_url || '').trim(),
        description: String(r.description || '').trim(),
        created_by: String(r.created_by || '').trim(),
        created_at: String(r.created_at || '')
      };
    });

    var settingsRaw = getSheetObjects_('Settings').map(function (r) {
      return {
        key: String(r.key || '').trim(),
        value: String(r.value !== undefined && r.value !== null ? r.value : ''),
        description: String(r.description || '').trim(),
        updated_at: String(r.updated_at || ''),
        updated_by: String(r.updated_by || '').trim()
      };
    });

    var editorsRaw = getEditorsList();

    return {
      tables: {
        members: membersRaw,
        sessions: sessionsRaw,
        attendance: attendanceRaw,
        session_items: sessionItemsRaw,
        schedule: scheduleRaw,
        monthly_bills: monthlyBillsRaw,
        monthly_dues: monthlyDuesRaw,
        settlements: settlementsRaw,
        fund_ledger: fundLedgerRaw,
        settings: settingsRaw,
        editors: editorsRaw
      },
      exportedAt: nowIso_()
    };
  } finally {
    endSheetCache_();
  }
}

function replaceSheetWithObjects_(sheetName, objects) {
  var sheet = getRequiredSheet_(sheetName);
  var headers = getSheetHeaders_(sheet, sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), headers.length);

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }

  if (!objects || objects.length === 0) {
    invalidateSheetCache_(sheetName);
    return 0;
  }

  var rows = [];
  for (var i = 0; i < objects.length; i++) {
    var obj = objects[i] || {};
    var row = [];
    for (var c = 0; c < headers.length; c++) {
      var h = headers[c];
      var val = obj[h] !== undefined && obj[h] !== null ? obj[h] : '';
      row.push(val);
    }
    rows.push(row);
  }

  for (var col = 0; col < headers.length; col++) {
    if (TEXT_COLUMNS[headers[col]]) {
      sheet.getRange(2, col + 1, rows.length, 1).setNumberFormat('@');
    }
  }
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  invalidateSheetCache_(sheetName);
  return rows.length;
}

function importRawTablesRecord(payload, authInfo) {
  if (!authInfo || authInfo.role !== 'ADMIN') {
    throw createAppError_('FORBIDDEN', 'Chỉ ADMIN mới được ghi đè dữ liệu từ Firebase sang Google Sheet.');
  }

  var p = payload || {};
  var tables = p.tables;
  if (!tables || typeof tables !== 'object') {
    throw createAppError_('BAD_REQUEST', 'Thiếu object tables trong payload importRawTables.');
  }

  if (!Array.isArray(tables.editors) || tables.editors.length === 0) {
    throw createAppError_('BAD_REQUEST', 'Từ chối đồng bộ vì danh sách Editors trống (tránh tự khóa quyền ADMIN).');
  }

  // Đảm bảo đủ 11 tabs và cột mới nhất trước khi ghi
  setupDatabase();

  var mapping = [
    ['Members', tables.members || []],
    ['Sessions', tables.sessions || []],
    ['Attendance', tables.attendance || []],
    ['Session_Items', tables.session_items || []],
    ['Schedule', tables.schedule || []],
    ['Monthly_Bills', tables.monthly_bills || []],
    ['Monthly_Dues', tables.monthly_dues || []],
    ['Settlements', tables.settlements || []],
    ['Fund_Ledger', tables.fund_ledger || []],
    ['Settings', tables.settings || []],
    ['Editors', tables.editors || []]
  ];

  var importedCounts = {};
  for (var i = 0; i < mapping.length; i++) {
    var tabName = mapping[i][0];
    var rows = mapping[i][1];
    importedCounts[tabName] = replaceSheetWithObjects_(tabName, rows);
  }

  return {
    importedCounts: importedCounts,
    importedAt: nowIso_()
  };
}
