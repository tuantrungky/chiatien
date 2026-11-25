/**
 * SheetService.gs
 * Định nghĩa Schema 7 tabs Google Sheets, hàm setupDatabase() 1 chạm,
 * các truy vấn báo cáo/thống kê, thuật toán Debt Simplification và nghiệp vụ ghi dữ liệu.
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
    'updated_at'
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
  ]
};

var DEFAULT_SETTINGS_ROWS = [
  {
    key: 'monthly_fee',
    value: '300000',
    description: 'Mức đóng quỹ tháng cố định cho thành viên chính MAIN (VND)'
  },
  {
    key: 'guest_fee',
    value: '50000',
    description: 'Phí vãng lai mặc định mỗi buổi cầu lông (VND)'
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
    description: 'member_id của Thủ quỹ (người giữ quỹ và nhận chuyển khoản mặc định)'
  },
  {
    key: 'rounding_unit',
    value: '1000',
    description: 'Bội số làm tròn khi chia tiền ăn nhậu (VND)'
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
 * Hàm khởi tạo Database 1 chạm:
 * - Tự động tạo đủ 7 tabs nếu chưa có
 * - Ghi dòng header chuẩn, định dạng đẹp và đóng băng dòng 1
 * - Chèn các giá trị mặc định cho Settings nếu chưa tồn tại
 */
function setupDatabase() {
  var ss = getSpreadsheet_();
  var now = nowIso_();
  var createdTabs = [];
  var initializedSettings = [];

  var tabNames = Object.keys(SHEET_SCHEMA);
  for (var i = 0; i < tabNames.length; i++) {
    var tabName = tabNames[i];
    var headers = SHEET_SCHEMA[tabName];
    var sheet = ss.getSheetByName(tabName);

    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      createdTabs.push(tabName);
    }

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#0f172a');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    } else {
      // Đảm bảo luôn đóng băng dòng 1
      if (sheet.getFrozenRows() < 1) {
        sheet.setFrozenRows(1);
      }
    }
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

  var summary = {
    ok: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    createdTabs: createdTabs,
    initializedSettings: initializedSettings
  };
  Logger.log(JSON.stringify(summary));
  return summary;
}

// ============================================================================
// CORE HELPERS
// ============================================================================

/**
 * Tạo đối tượng Error chuẩn có gắn mã code.
 *
 * @param {string} code
 * @param {string} message
 * @return {Error}
 */
function createAppError_(code, message) {
  var err = new Error(message);
  err.code = code || 'INTERNAL_ERROR';
  return err;
}

/**
 * Lấy Google Spreadsheet đang gắn với dự án.
 *
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
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

/**
 * Lấy sheet theo tên, ném lỗi nếu chưa chạy setupDatabase().
 *
 * @param {string} sheetName
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
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

/**
 * Đọc toàn bộ dòng dữ liệu của một tab thành mảng object theo header Row 1.
 *
 * @param {string} sheetName
 * @return {Array<Object>}
 */
function getSheetObjects_(sheetName) {
  var sheet = getRequiredSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) {
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
      var cellVal = row[c];
      if (cellVal instanceof Date) {
        if (key === 'date' || key === 'session_date') {
          cellVal = Utilities.formatDate(cellVal, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
        } else {
          cellVal = Utilities.formatDate(cellVal, 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ssXXX");
        }
      }
      if (cellVal !== '' && cellVal !== null && cellVal !== undefined) {
        hasValue = true;
      }
      obj[key] = cellVal;
    }
    if (hasValue) {
      results.push(obj);
    }
  }
  return results;
}

/**
 * Nối một mảng object vào cuối tab tương ứng (theo đúng thứ tự cột trong SHEET_SCHEMA).
 *
 * @param {string} sheetName
 * @param {Array<Object>} objects
 */
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
      // Giữ dạng text cho cột ngày/SĐT/STK để Google Sheets không tự đổi kiểu
      if (
        typeof val === 'string' &&
        val !== '' &&
        (h === 'date' || h === 'session_date' || h === 'phone' || h === 'account_no' || h === 'bank_bin' || h === 'period') &&
        val.charAt(0) !== "'"
      ) {
        val = "'" + val;
      }
      row.push(val);
    }
    rows.push(row);
  }

  var startRow = Math.max(sheet.getLastRow() + 1, 2);
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
}

/**
 * Cập nhật các dòng thỏa mãn điều kiện trong một tab.
 *
 * @param {string} sheetName
 * @param {function(Object): boolean} predicate
 * @param {function(Object): Object} updater
 * @return {number} Số dòng đã cập nhật
 */
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
      var val = values[r][c];
      if (val instanceof Date) {
        if (key === 'date' || key === 'session_date') {
          val = Utilities.formatDate(val, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
        } else {
          val = Utilities.formatDate(val, 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ssXXX");
        }
      }
      obj[key] = val;
    }

    if (predicate(obj)) {
      var nextObj = updater(obj) || obj;
      for (var c2 = 0; c2 < headers.length; c2++) {
        var h = String(headers[c2] || '').trim();
        if (!h) continue;
        var nextVal = nextObj[h] !== undefined && nextObj[h] !== null ? nextObj[h] : '';
        if (
          typeof nextVal === 'string' &&
          nextVal !== '' &&
          (h === 'date' || h === 'session_date' || h === 'phone' || h === 'account_no' || h === 'bank_bin' || h === 'period') &&
          nextVal.charAt(0) !== "'"
        ) {
          nextVal = "'" + nextVal;
        }
        values[r][c2] = nextVal;
      }
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    range.setValues(values);
  }
  return updatedCount;
}

/**
 * Xóa các dòng thỏa mãn điều kiện trong một tab (duyệt từ dưới lên).
 *
 * @param {string} sheetName
 * @param {function(Object): boolean} predicate
 * @return {number} Số dòng đã xóa
 */
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
      var val = values[r][c];
      if (val instanceof Date) {
        if (key === 'date' || key === 'session_date') {
          val = Utilities.formatDate(val, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
        } else {
          val = Utilities.formatDate(val, 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ssXXX");
        }
      }
      obj[key] = val;
    }

    if (predicate(obj)) {
      sheet.deleteRow(r + 1);
      deletedCount++;
    }
  }
  return deletedCount;
}

/**
 * Lấy danh sách header của sheet (Row 1).
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} sheetName
 * @return {string[]}
 */
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

/**
 * Tính khoảng thời gian startDate..endDate theo periodType (WEEK, MONTH, QUARTER, YEAR, ALL).
 *
 * @param {string=} periodType
 * @param {string=} refDateStr
 * @return {{type: string, startDate: string|null, endDate: string|null, label: string}}
 */
function getPeriodRange_(periodType, refDateStr) {
  var type = String(periodType || 'MONTH').trim().toUpperCase();
  var refStr = (refDateStr && /^\d{4}-\d{2}-\d{2}$/.test(refDateStr)) ? refDateStr : todayDateStr_();

  if (type === 'ALL') {
    return { type: 'ALL', startDate: null, endDate: null, label: 'Tất cả thời gian' };
  }

  var parts = refStr.split('-');
  var year = Number(parts[0]);
  var month = Number(parts[1]); // 1..12
  var day = Number(parts[2]);

  var pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
  var fmt = function (d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  };

  if (type === 'WEEK') {
    var d = new Date(year, month - 1, day);
    var jsDay = d.getDay(); // 0=CN, 1=T2..6=T7
    var diffToMon = jsDay === 0 ? -6 : (1 - jsDay);
    var monday = new Date(year, month - 1, day + diffToMon);
    var sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    var startW = fmt(monday);
    var endW = fmt(sunday);
    return {
      type: 'WEEK',
      startDate: startW,
      endDate: endW,
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

  // Mặc định MONTH
  var lastDayM = new Date(year, month, 0).getDate();
  return {
    type: 'MONTH',
    startDate: year + '-' + pad2(month) + '-01',
    endDate: year + '-' + pad2(month) + '-' + pad2(lastDayM),
    label: 'Tháng ' + pad2(month) + '/' + year
  };
}

// ============================================================================
// PUBLIC READ SERVICES (Viewer)
// ============================================================================

/**
 * Trả về map Settings đã chuẩn hóa cả key cũ & key alias.
 *
 * @return {Object}
 */
function getSettingsMap() {
  var rows = getSheetObjects_('Settings');
  var raw = {};
  for (var i = 0; i < rows.length; i++) {
    var k = String(rows[i].key || '').trim();
    if (k) {
      raw[k] = rows[i].value !== undefined && rows[i].value !== null ? String(rows[i].value) : '';
    }
  }

  var monthlyFee = toInt_(raw.monthly_fee !== undefined ? raw.monthly_fee : raw.default_monthly_fund, 300000);
  var guestFee = toInt_(raw.guest_fee !== undefined ? raw.guest_fee : raw.default_guest_fee, 50000);

  return {
    club_name: raw.club_name || 'CLB Cầu Lông & Nhậu',
    treasurer_member_id: String(raw.treasurer_member_id || '').trim(),
    monthly_fee: monthlyFee,
    guest_fee: guestFee,
    default_monthly_fund: monthlyFee,
    default_guest_fee: guestFee,
    drive_folder_id: String(raw.drive_folder_id || '').trim(),
    rounding_unit: Math.max(1, toInt_(raw.rounding_unit, 1000)),
    vietqr_template: raw.vietqr_template || 'compact2',
    transfer_prefix: raw.transfer_prefix || 'CLN',
    raw: rows
  };
}

/**
 * Lấy danh sách thành viên (mặc định trả về tất cả, kèm cờ boolean is_active).
 *
 * @param {boolean=} activeOnly
 * @return {Array<Object>}
 */
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
      is_active: isActive,
      created_at: String(r.created_at || ''),
      updated_at: String(r.updated_at || '')
    });
  }
  return list;
}

/**
 * Lấy danh sách các buổi cầu lông / ăn nhậu.
 *
 * @param {Object=} filters
 * @return {Array<Object>}
 */
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

/**
 * Lấy chi tiết 1 buổi kèm danh sách điểm danh và chi phí quỹ liên quan.
 *
 * @param {string} sessionId
 * @return {Object}
 */
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
      is_paid: toBoolean_(a.is_paid),
      paid_at: String(a.paid_at || ''),
      settlement_id: String(a.settlement_id || '').trim(),
      note: String(a.note || '').trim()
    });
  }

  var ledgerRows = getSheetObjects_('Fund_Ledger');
  var linkedExpenses = [];
  for (var k = 0; k < ledgerRows.length; k++) {
    var l = ledgerRows[k];
    if (String(l.session_id || '').trim() !== id) continue;
    var lmId = String(l.member_id || '').trim();
    linkedExpenses.push({
      ledger_id: String(l.ledger_id || '').trim(),
      date: String(l.date || '').trim(),
      type: String(l.type || '').trim().toUpperCase(),
      category: String(l.category || '').trim().toUpperCase(),
      amount: toInt_(l.amount, 0),
      member_id: lmId,
      member_name: membersMap[lmId] ? membersMap[lmId].name : lmId,
      is_paid: toBoolean_(l.is_paid),
      description: String(l.description || '').trim(),
      receipt_url: String(l.receipt_url || '').trim()
    });
  }

  return {
    session: target,
    attendances: attendances,
    linkedExpenses: linkedExpenses
  };
}

/**
 * Lấy dữ liệu Sổ quỹ Fund_Ledger theo bộ lọc Tuần/Tháng/Quý/Năm/Tất cả.
 *
 * @param {string=} periodType
 * @param {string=} refDate
 * @param {string=} typeFilter ALL | INCOME | EXPENSE
 * @return {Object}
 */
function getFundLedgerData(periodType, refDate, typeFilter) {
  var period = getPeriodRange_(periodType || 'MONTH', refDate);
  var filterType = String(typeFilter || 'ALL').trim().toUpperCase();

  var membersMap = buildMembersMap_(getMembersList(false));
  var rows = getSheetObjects_('Fund_Ledger');

  var openingBalance = 0;
  var totalIncome = 0;
  var totalExpense = 0;
  var entries = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var rDate = String(r.date || '').trim();
    var rType = String(r.type || '').trim().toUpperCase();
    var amount = toInt_(r.amount, 0);
    var mId = String(r.member_id || '').trim();

    if (period.startDate && rDate < period.startDate) {
      openingBalance += (rType === 'INCOME' ? amount : -amount);
      continue;
    }
    if (period.endDate && rDate > period.endDate) {
      continue;
    }

    if (rType === 'INCOME') totalIncome += amount;
    if (rType === 'EXPENSE') totalExpense += amount;

    if (filterType !== 'ALL' && rType !== filterType) continue;

    entries.push({
      ledger_id: String(r.ledger_id || '').trim(),
      date: rDate,
      type: rType,
      category: String(r.category || '').trim().toUpperCase(),
      amount: amount,
      member_id: mId,
      member_name: membersMap[mId] ? membersMap[mId].name : mId,
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
    });
  }

  entries.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.created_at < b.created_at ? 1 : -1;
  });

  return {
    period: period,
    summary: {
      openingBalance: openingBalance,
      totalIncome: totalIncome,
      totalExpense: totalExpense,
      closingBalance: openingBalance + totalIncome - totalExpense
    },
    entries: entries
  };
}

/**
 * Bảng thống kê riêng cho Khách vãng lai (GUEST) theo tháng YYYY-MM.
 *
 * @param {string=} monthStr YYYY-MM
 * @return {Object}
 */
function getGuestStatsData(monthStr) {
  var targetMonth = (monthStr && /^\d{4}-\d{2}$/.test(monthStr.trim()))
    ? monthStr.trim()
    : todayDateStr_().slice(0, 7);

  var membersMap = buildMembersMap_(getMembersList(false));
  var attRows = getSheetObjects_('Attendance');
  var byGuest = {};

  var sumVisits = 0;
  var sumFee = 0;
  var sumPaid = 0;
  var sumUnpaid = 0;

  for (var i = 0; i < attRows.length; i++) {
    var a = attRows[i];
    var sDate = String(a.session_date || '').trim();
    var mType = String(a.member_type_snapshot || '').trim().toUpperCase();
    if (mType !== 'GUEST' || sDate.slice(0, 7) !== targetMonth) continue;

    var mId = String(a.member_id || '').trim();
    var fee = toInt_(a.fee_amount, 0);
    var isPaid = toBoolean_(a.is_paid);

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
    if (g.dates.indexOf(sDate) === -1) {
      g.dates.push(sDate);
    }
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
      sessionType: String(a.session_type || '').trim().toUpperCase(),
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
      totalUnpaid: sumUnpaid
    },
    guests: guests
  };
}

/**
 * Thuật toán tính công nợ ròng & Debt Simplification (cấn trừ vòng tròn), kèm VietQR.
 *
 * @return {Object}
 */
function computeDebtsData() {
  var settings = getSettingsMap();
  var treasurerId = settings.treasurer_member_id;
  var members = getMembersList(false);
  var membersMap = buildMembersMap_(members);

  var netMap = {};
  var ensureMember = function (id) {
    if (id && netMap[id] === undefined) netMap[id] = 0;
  };

  var attRows = getSheetObjects_('Attendance');
  var unpaidAttendances = [];
  for (var i = 0; i < attRows.length; i++) {
    var a = attRows[i];
    if (toBoolean_(a.is_paid)) continue;
    var fee = toInt_(a.fee_amount, 0);
    if (fee <= 0) continue;

    var mId = String(a.member_id || '').trim();
    var cId = String(a.creditor_id || treasurerId).trim();
    if (!mId || !cId || mId === cId) continue;

    ensureMember(mId);
    ensureMember(cId);
    netMap[mId] -= fee;
    netMap[cId] += fee;

    unpaidAttendances.push({
      attendance_id: String(a.attendance_id || '').trim(),
      session_id: String(a.session_id || '').trim(),
      session_date: String(a.session_date || '').trim(),
      session_type: String(a.session_type || '').trim().toUpperCase(),
      member_id: mId,
      member_name: membersMap[mId] ? membersMap[mId].name : mId,
      member_type_snapshot: String(a.member_type_snapshot || 'MAIN').trim().toUpperCase(),
      fee_amount: fee,
      creditor_id: cId,
      creditor_name: membersMap[cId] ? membersMap[cId].name : cId
    });
  }

  var ledgerRows = getSheetObjects_('Fund_Ledger');
  var unpaidReimbursements = [];
  for (var j = 0; j < ledgerRows.length; j++) {
    var l = ledgerRows[j];
    var lType = String(l.type || '').trim().toUpperCase();
    if (lType !== 'EXPENSE' || toBoolean_(l.is_paid)) continue;
    var amt = toInt_(l.amount, 0);
    var lmId = String(l.member_id || '').trim();
    if (!amt || !lmId || !treasurerId || lmId === treasurerId) continue;

    ensureMember(treasurerId);
    ensureMember(lmId);
    netMap[treasurerId] -= amt;
    netMap[lmId] += amt;

    unpaidReimbursements.push({
      ledger_id: String(l.ledger_id || '').trim(),
      date: String(l.date || '').trim(),
      category: String(l.category || '').trim().toUpperCase(),
      amount: amt,
      member_id: lmId,
      member_name: membersMap[lmId] ? membersMap[lmId].name : lmId,
      description: String(l.description || '').trim()
    });
  }

  var settlementRows = getSheetObjects_('Settlements');
  var recentSettlements = [];
  for (var k = 0; k < settlementRows.length; k++) {
    var s = settlementRows[k];
    var fromId = String(s.from_member_id || '').trim();
    var toId = String(s.to_member_id || '').trim();
    var sAmt = toInt_(s.amount, 0);
    var isRec = toBoolean_(s.is_reconciled);

    if (!isRec && fromId && toId && sAmt > 0) {
      ensureMember(fromId);
      ensureMember(toId);
      netMap[fromId] += sAmt;
      netMap[toId] -= sAmt;
    }

    recentSettlements.push({
      settlement_id: String(s.settlement_id || '').trim(),
      from_member_id: fromId,
      from_name: membersMap[fromId] ? membersMap[fromId].name : fromId,
      to_member_id: toId,
      to_name: membersMap[toId] ? membersMap[toId].name : toId,
      amount: sAmt,
      settled_at: String(s.settled_at || ''),
      method: String(s.method || '').trim().toUpperCase(),
      is_reconciled: isRec,
      transfer_content: String(s.transfer_content || '').trim(),
      confirmed_by: String(s.confirmed_by || '').trim()
    });
  }

  recentSettlements.sort(function (a, b) {
    return a.settled_at < b.settled_at ? 1 : -1;
  });

  // Phân tách Debtors (<0) & Creditors (>0)
  var netBalances = [];
  var debtors = [];
  var creditors = [];

  var memberIds = Object.keys(netMap);
  for (var p = 0; p < memberIds.length; p++) {
    var id = memberIds[p];
    var bal = Math.round(netMap[id]);
    if (bal === 0) continue;

    var mInfo = membersMap[id];
    var name = mInfo ? mInfo.name : id;
    netBalances.push({ memberId: id, name: name, balance: bal });

    if (bal < 0) {
      debtors.push({ memberId: id, name: name, amount: -bal });
    } else {
      creditors.push({ memberId: id, name: name, amount: bal });
    }
  }

  debtors.sort(function (a, b) { return b.amount - a.amount; });
  creditors.sort(function (a, b) { return b.amount - a.amount; });

  // Greedy Debt Simplification
  var simplifiedTransfers = [];
  var iD = 0;
  var iC = 0;
  while (iD < debtors.length && iC < creditors.length) {
    var d = debtors[iD];
    var c = creditors[iC];
    var transferAmt = Math.min(d.amount, c.amount);

    if (transferAmt > 0) {
      var toMember = membersMap[c.memberId] || null;
      var content = settings.transfer_prefix + ' ' +
        stripVietnameseDiacritics_(d.name) + ' tra ' +
        stripVietnameseDiacritics_(c.name);
      content = content.slice(0, 50).trim();

      simplifiedTransfers.push({
        fromMemberId: d.memberId,
        fromName: d.name,
        toMemberId: c.memberId,
        toName: c.name,
        amount: transferAmt,
        transferContent: content,
        toBank: toMember ? {
          bankBin: toMember.bank_bin,
          bankName: toMember.bank_name,
          accountNo: toMember.account_no,
          accountName: toMember.account_name
        } : null,
        vietQrUrl: buildVietQrUrl_(toMember, transferAmt, content, settings.vietqr_template)
      });
    }

    d.amount -= transferAmt;
    c.amount -= transferAmt;
    if (d.amount === 0) iD++;
    if (c.amount === 0) iC++;
  }

  return {
    treasurerMemberId: treasurerId,
    netBalances: netBalances,
    simplifiedTransfers: simplifiedTransfers,
    unpaidAttendances: unpaidAttendances,
    unpaidReimbursements: unpaidReimbursements,
    recentSettlements: recentSettlements.slice(0, 20)
  };
}

/**
 * Tổng hợp dữ liệu cho màn hình Tổng quan (Dashboard).
 *
 * @param {string=} periodType
 * @param {string=} refDate
 * @return {Object}
 */
function getDashboardData(periodType, refDate) {
  var period = getPeriodRange_(periodType || 'MONTH', refDate);
  var ledgerData = getFundLedgerData(period.type, refDate, 'ALL');
  var allLedger = getFundLedgerData('ALL', refDate, 'ALL');
  var debts = computeDebtsData();
  var sessions = getSessionsList({});
  var members = getMembersList(true);

  var currentMonth = (refDate && /^\d{4}-\d{2}-\d{2}$/.test(refDate))
    ? refDate.slice(0, 7)
    : todayDateStr_().slice(0, 7);

  var allLedgerRows = getSheetObjects_('Fund_Ledger');
  var paidMonthlyByMember = {};
  var pendingReimbursement = 0;

  for (var i = 0; i < allLedgerRows.length; i++) {
    var l = allLedgerRows[i];
    var lType = String(l.type || '').trim().toUpperCase();
    var lCat = String(l.category || '').trim().toUpperCase();
    var amt = toInt_(l.amount, 0);
    var mId = String(l.member_id || '').trim();

    if (lType === 'INCOME' && (lCat === 'MONTHLY_FUND' || lCat === 'MONTHLY_FEE') && String(l.period || '').trim() === currentMonth) {
      paidMonthlyByMember[mId] = (paidMonthlyByMember[mId] || 0) + amt;
    }
    if (lType === 'EXPENSE' && !toBoolean_(l.is_paid)) {
      pendingReimbursement += amt;
    }
  }

  var monthlyFundStatus = [];
  for (var j = 0; j < members.length; j++) {
    var m = members[j];
    if (m.type !== 'MAIN') continue;
    var paidAmt = paidMonthlyByMember[m.member_id] || 0;
    monthlyFundStatus.push({
      member_id: m.member_id,
      name: m.name,
      paidAmount: paidAmt,
      isPaid: paidAmt > 0
    });
  }

  var totalOutstanding = 0;
  for (var k = 0; k < debts.simplifiedTransfers.length; k++) {
    totalOutstanding += debts.simplifiedTransfers[k].amount;
  }

  return {
    period: period,
    currentMonth: currentMonth,
    fund: {
      currentBalance: allLedger.summary.closingBalance,
      periodIncome: ledgerData.summary.totalIncome,
      periodExpense: ledgerData.summary.totalExpense,
      pendingReimbursement: pendingReimbursement
    },
    debtsSummary: {
      totalOutstanding: totalOutstanding,
      pendingTransferCount: debts.simplifiedTransfers.length
    },
    simplifiedTransfers: debts.simplifiedTransfers,
    recentSessions: sessions.slice(0, 5),
    monthlyFundStatus: monthlyFundStatus
  };
}

// ============================================================================
// WRITE SERVICES (Yêu cầu LockService từ Code.gs)
// ============================================================================

/**
 * Tạo buổi chơi mới (BADMINTON hoặc DRINKING).
 * Tự động tạo Member GUEST mới nếu payload có new_guests.
 *
 * @param {Object} payload
 * @param {string} editorEmail
 * @return {Object}
 */
function createSessionRecord(payload, editorEmail) {
  var p = payload || {};
  var settings = getSettingsMap();
  var now = nowIso_();

  var sessionCategory = String(p.category || p.type || '').trim().toUpperCase();
  if (sessionCategory !== 'BADMINTON' && sessionCategory !== 'DRINKING') {
    throw createAppError_('BAD_REQUEST', 'category/type phải là BADMINTON hoặc DRINKING.');
  }

  var dateStr = String(p.date || todayDateStr_()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw createAppError_('BAD_REQUEST', 'Định dạng date phải là YYYY-MM-DD.');
  }

  var title = String(p.title || (sessionCategory === 'BADMINTON' ? 'Cầu lông ' + dateStr : 'Ăn nhậu ' + dateStr)).trim();
  var totalAmount = Math.max(0, toInt_(p.total_amount !== undefined ? p.total_amount : p.totalAmount, 0));
  var guestFee = Math.max(0, toInt_(p.guest_fee !== undefined ? p.guest_fee : p.guestFee, settings.guest_fee));
  var payerId = String(p.payer_id || p.payerId || settings.treasurer_member_id || '').trim();
  var receiptDriveId = String(p.receipt_drive_id || p.receiptDriveId || '').trim();
  var receiptUrl = String(p.receipt_url || p.receiptUrl || '').trim();
  var receiptSummary = String(p.receipt_summary || p.receiptSummary || '').trim();
  var note = String(p.note || '').trim();

  // 1. Tự động tạo Member mới loại GUEST nếu payload có new_guests
  var rawNewGuests = Array.isArray(p.new_guests)
    ? p.new_guests
    : (Array.isArray(p.quickNewGuests) ? p.quickNewGuests : []);

  var createdMembers = [];
  var paidImmediatelySet = {};

  var rawPaidImmediate = Array.isArray(p.paid_immediately_member_ids)
    ? p.paid_immediately_member_ids
    : (Array.isArray(p.paidImmediatelyMemberIds) ? p.paidImmediatelyMemberIds : []);
  for (var pi = 0; pi < rawPaidImmediate.length; pi++) {
    paidImmediatelySet[String(rawPaidImmediate[pi]).trim()] = true;
  }

  var existingMembers = getMembersList(false);
  var membersByNameLower = {};
  for (var em = 0; em < existingMembers.length; em++) {
    membersByNameLower[existingMembers[em].name.toLowerCase()] = existingMembers[em];
  }

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
    var gAliases = typeof gItem === 'object' && gItem ? String(gItem.aliases || '').trim() : '';
    var newMemObj = {
      member_id: newId,
      name: gName,
      aliases: gAliases,
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

  // 2. Gộp attendee_ids + newGuestMemberIds và khử trùng
  var rawAttendeeIds = Array.isArray(p.attendee_ids)
    ? p.attendee_ids
    : (Array.isArray(p.attendeeIds) ? p.attendeeIds : []);
  var combinedIds = rawAttendeeIds.concat(newGuestMemberIds);
  var seenAttendee = {};
  var attendeeIds = [];
  for (var aIdx = 0; aIdx < combinedIds.length; aIdx++) {
    var aid = String(combinedIds[aIdx] || '').trim();
    if (aid && !seenAttendee[aid]) {
      seenAttendee[aid] = true;
      attendeeIds.push(aid);
    }
  }

  var membersMap = buildMembersMap_(existingMembers);
  var attendeeCount = attendeeIds.length;
  var perPersonAmount = 0;

  if (sessionCategory === 'DRINKING') {
    if (attendeeCount === 0) {
      throw createAppError_('BAD_REQUEST', 'Buổi Ăn nhậu (DRINKING) phải có ít nhất 1 người tham gia.');
    }
    if (!payerId) {
      throw createAppError_('BAD_REQUEST', 'Thiếu payer_id cho buổi Ăn nhậu (chưa cấu hình Thủ quỹ hoặc người trả tiền).');
    }
    var unit = settings.rounding_unit || 1000;
    perPersonAmount = Math.round(totalAmount / attendeeCount / unit) * unit;
  }

  var sessionId = generateId_('SES');
  var sessionObj = {
    session_id: sessionId,
    date: dateStr,
    type: sessionCategory,
    title: title,
    total_amount: totalAmount,
    guest_fee: sessionCategory === 'BADMINTON' ? guestFee : 0,
    payer_id: payerId,
    per_person_amount: perPersonAmount,
    attendee_count: attendeeCount,
    receipt_drive_id: receiptDriveId,
    receipt_url: receiptUrl,
    receipt_summary: receiptSummary,
    note: note,
    created_by: editorEmail,
    created_at: now,
    updated_at: now
  };
  appendObjects_('Sessions', [sessionObj]);

  // 3. Tạo bản ghi Attendance & Fund_Ledger
  var attendanceRows = [];
  var ledgerRows = [];
  var treasurerId = settings.treasurer_member_id;

  for (var i = 0; i < attendeeIds.length; i++) {
    var memberId = attendeeIds[i];
    var member = membersMap[memberId];
    if (!member) {
      throw createAppError_('NOT_FOUND', 'Không tìm thấy thành viên ' + memberId);
    }

    var attId = generateId_('ATT') + '_' + i;
    var memberType = member.type === 'GUEST' ? 'GUEST' : 'MAIN';
    var feeAmount = 0;
    var creditorId = '';
    var isPaid = true;
    var paidAt = now;

    if (sessionCategory === 'BADMINTON') {
      if (memberType === 'GUEST') {
        feeAmount = guestFee;
        creditorId = treasurerId || payerId;
        isPaid = Boolean(paidImmediatelySet[memberId]) || feeAmount === 0;
        paidAt = isPaid ? now : '';

        if (isPaid && feeAmount > 0) {
          ledgerRows.push({
            ledger_id: generateId_('LED') + '_G_' + i,
            date: dateStr,
            type: 'INCOME',
            category: 'GUEST_FEE',
            amount: feeAmount,
            member_id: memberId,
            session_id: sessionId,
            attendance_id: attId,
            period: dateStr.slice(0, 7),
            is_paid: true,
            paid_at: now,
            settlement_id: '',
            receipt_drive_id: '',
            receipt_url: '',
            description: 'Phí vãng lai tại sân: ' + member.name + ' (' + title + ')',
            created_by: editorEmail,
            created_at: now
          });
        }
      } else {
        // Thành viên MAIN đi cầu lông: fee_amount = 0, is_paid = true
        feeAmount = 0;
        creditorId = treasurerId || payerId;
        isPaid = true;
        paidAt = now;
      }
    } else {
      // DRINKING: chia đều cho tất cả người có mặt
      feeAmount = perPersonAmount;
      creditorId = payerId;
      isPaid = (memberId === payerId) || feeAmount === 0;
      paidAt = isPaid ? now : '';
    }

    attendanceRows.push({
      attendance_id: attId,
      session_id: sessionId,
      session_date: dateStr,
      session_type: sessionCategory,
      member_id: memberId,
      member_type_snapshot: memberType,
      fee_amount: feeAmount,
      creditor_id: creditorId,
      is_paid: isPaid,
      paid_at: paidAt,
      settlement_id: '',
      note: ''
    });
  }

  if (attendanceRows.length > 0) {
    appendObjects_('Attendance', attendanceRows);
  }

  // 4. Với BADMINTON: tạo dòng chi phí vào Fund_Ledger nếu total_amount > 0 hoặc có danh sách expenses
  if (sessionCategory === 'BADMINTON') {
    var expensesList = Array.isArray(p.expenses) ? p.expenses : [];
    if (expensesList.length > 0) {
      for (var eIdx = 0; eIdx < expensesList.length; eIdx++) {
        var exp = expensesList[eIdx];
        var expAmt = Math.max(0, toInt_(exp.amount, 0));
        if (expAmt <= 0) continue;
        var expPayer = String(exp.memberId || exp.member_id || payerId || treasurerId).trim();
        var isReimbursed = !treasurerId || expPayer === treasurerId;
        ledgerRows.push({
          ledger_id: generateId_('LED') + '_E_' + eIdx,
          date: dateStr,
          type: 'EXPENSE',
          category: String(exp.category || 'COURT').trim().toUpperCase(),
          amount: expAmt,
          member_id: expPayer,
          session_id: sessionId,
          attendance_id: '',
          period: dateStr.slice(0, 7),
          is_paid: isReimbursed,
          paid_at: isReimbursed ? now : '',
          settlement_id: '',
          receipt_drive_id: receiptDriveId,
          receipt_url: receiptUrl,
          description: String(exp.description || title).trim(),
          created_by: editorEmail,
          created_at: now
        });
      }
    } else if (totalAmount > 0) {
      var expensePayer = payerId || treasurerId;
      var expensePaidByTreasurer = !treasurerId || expensePayer === treasurerId;
      ledgerRows.push({
        ledger_id: generateId_('LED') + '_E',
        date: dateStr,
        type: 'EXPENSE',
        category: String(p.expense_category || p.expenseCategory || 'COURT').trim().toUpperCase(),
        amount: totalAmount,
        member_id: expensePayer,
        session_id: sessionId,
        attendance_id: '',
        period: dateStr.slice(0, 7),
        is_paid: expensePaidByTreasurer,
        paid_at: expensePaidByTreasurer ? now : '',
        settlement_id: '',
        receipt_drive_id: receiptDriveId,
        receipt_url: receiptUrl,
        description: String(p.expense_description || receiptSummary || ('Chi phí ' + title)).trim(),
        created_by: editorEmail,
        created_at: now
      });
    }
  }

  if (ledgerRows.length > 0) {
    appendObjects_('Fund_Ledger', ledgerRows);
  }

  return {
    session: sessionObj,
    createdMembers: createdMembers,
    attendances: attendanceRows,
    ledgerEntries: ledgerRows
  };
}

/**
 * Xác nhận đã thanh toán (gạch nợ) cho lệnh chuyển khoản tối ưu hoặc từng khoản lẻ.
 *
 * @param {Object} payload
 * @param {string} editorEmail
 * @return {Object}
 */
function confirmPaymentRecord(payload, editorEmail) {
  var p = payload || {};
  var mode = String(p.mode || 'SIMPLIFIED_TRANSFER').trim().toUpperCase();
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

  var settings = getSettingsMap();
  var membersMap = buildMembersMap_(getMembersList(false));

  if (mode === 'ITEMS') {
    var attIds = Array.isArray(p.attendanceIds || p.attendance_ids) ? (p.attendanceIds || p.attendance_ids) : [];
    var ledIds = Array.isArray(p.ledgerIds || p.ledger_ids) ? (p.ledgerIds || p.ledger_ids) : [];
    if (attIds.length === 0 && ledIds.length === 0) {
      throw createAppError_('BAD_REQUEST', 'Chế độ ITEMS cần ít nhất 1 attendanceIds hoặc ledgerIds.');
    }

    var attIdSet = {};
    for (var i = 0; i < attIds.length; i++) attIdSet[String(attIds[i]).trim()] = true;
    var ledIdSet = {};
    for (var j = 0; j < ledIds.length; j++) ledIdSet[String(ledIds[j]).trim()] = true;

    var totalPaidAmt = 0;
    var newlyPaidGuestAttendances = [];

    updateRowsByCondition_(
      'Attendance',
      function (row) {
        return attIdSet[String(row.attendance_id || '').trim()] && !toBoolean_(row.is_paid);
      },
      function (row) {
        totalPaidAmt += toInt_(row.fee_amount, 0);
        row.is_paid = true;
        row.paid_at = now;
        row.settlement_id = settlementId;
        if (
          String(row.session_type || '').toUpperCase() === 'BADMINTON' &&
          String(row.member_type_snapshot || '').toUpperCase() === 'GUEST'
        ) {
          newlyPaidGuestAttendances.push(row);
        }
        return row;
      }
    );

    updateRowsByCondition_(
      'Fund_Ledger',
      function (row) {
        return ledIdSet[String(row.ledger_id || '').trim()] && !toBoolean_(row.is_paid);
      },
      function (row) {
        totalPaidAmt += toInt_(row.amount, 0);
        row.is_paid = true;
        row.paid_at = now;
        row.settlement_id = settlementId;
        return row;
      }
    );

    var finalAmt = totalPaidAmt > 0 ? totalPaidAmt : Math.max(0, toInt_(p.amount, 0));
    var settlementItem = {
      settlement_id: settlementId,
      from_member_id: fromMemberId,
      to_member_id: toMemberId,
      amount: finalAmt,
      settled_at: now,
      method: method,
      source_attendance_ids: attIds.join(','),
      source_ledger_ids: ledIds.join(','),
      is_reconciled: true,
      transfer_content: transferContent,
      note: note,
      confirmed_by: editorEmail
    };
    appendObjects_('Settlements', [settlementItem]);

    appendGuestFeesToLedger_(newlyPaidGuestAttendances, settlementId, now, editorEmail, membersMap);

    return {
      settlement: settlementItem,
      updatedDebts: computeDebtsData()
    };
  }

  // Chế độ mặc định: SIMPLIFIED_TRANSFER
  var amount = toInt_(p.amount, 0);
  if (amount <= 0) {
    throw createAppError_('BAD_REQUEST', 'Số tiền thanh toán phải lớn hơn 0.');
  }

  var settlementObj = {
    settlement_id: settlementId,
    from_member_id: fromMemberId,
    to_member_id: toMemberId,
    amount: amount,
    settled_at: now,
    method: method,
    source_attendance_ids: '',
    source_ledger_ids: '',
    is_reconciled: false,
    transfer_content: transferContent,
    note: note,
    confirmed_by: editorEmail
  };
  appendObjects_('Settlements', [settlementObj]);

  // 1. Phân bổ FIFO các khoản BADMINTON GUEST chưa trả của fromMemberId -> ghi quỹ GUEST_FEE
  var attRows = getSheetObjects_('Attendance');
  var guestUnpaid = [];
  for (var k = 0; k < attRows.length; k++) {
    var ar = attRows[k];
    if (
      String(ar.member_id || '').trim() === fromMemberId &&
      !toBoolean_(ar.is_paid) &&
      toInt_(ar.fee_amount, 0) > 0 &&
      String(ar.session_type || '').toUpperCase() === 'BADMINTON' &&
      String(ar.member_type_snapshot || '').toUpperCase() === 'GUEST'
    ) {
      guestUnpaid.push(ar);
    }
  }
  guestUnpaid.sort(function (a, b) {
    return String(a.session_date || '') < String(b.session_date || '') ? -1 : 1;
  });

  var budget = amount;
  var guestAttIdsToMark = {};
  var guestRowsToLedger = [];
  for (var g = 0; g < guestUnpaid.length; g++) {
    var gRow = guestUnpaid[g];
    var gFee = toInt_(gRow.fee_amount, 0);
    if (budget >= gFee) {
      budget -= gFee;
      guestAttIdsToMark[String(gRow.attendance_id).trim()] = true;
      guestRowsToLedger.push(gRow);
    }
  }

  if (Object.keys(guestAttIdsToMark).length > 0) {
    updateRowsByCondition_(
      'Attendance',
      function (row) { return Boolean(guestAttIdsToMark[String(row.attendance_id || '').trim()]); },
      function (row) {
        row.is_paid = true;
        row.paid_at = now;
        row.settlement_id = settlementId;
        return row;
      }
    );
    appendGuestFeesToLedger_(guestRowsToLedger, settlementId, now, editorEmail, membersMap);
  }

  // 2. Đối soát các thành viên đã về netBalance === 0
  reconcileZeroBalanceMembers_(settlementId, now, editorEmail, settings, membersMap);

  return {
    settlement: settlementObj,
    updatedDebts: computeDebtsData()
  };
}

/**
 * Đối soát tự động khi thành viên hoặc toàn mạng công nợ đã về 0.
 */
function reconcileZeroBalanceMembers_(settlementId, now, editorEmail, settings, membersMap) {
  var debtsAfter = computeDebtsData();
  var zeroOrCleared = {};

  // Nếu không còn simplifiedTransfers nào => toàn bộ hệ thống đã cân bằng về 0
  if (debtsAfter.simplifiedTransfers.length === 0) {
    var newlyPaidGuests = [];
    updateRowsByCondition_(
      'Attendance',
      function (row) { return !toBoolean_(row.is_paid) && toInt_(row.fee_amount, 0) > 0; },
      function (row) {
        row.is_paid = true;
        row.paid_at = now;
        row.settlement_id = settlementId;
        if (
          String(row.session_type || '').toUpperCase() === 'BADMINTON' &&
          String(row.member_type_snapshot || '').toUpperCase() === 'GUEST'
        ) {
          newlyPaidGuests.push(row);
        }
        return row;
      }
    );

    updateRowsByCondition_(
      'Fund_Ledger',
      function (row) { return String(row.type || '').toUpperCase() === 'EXPENSE' && !toBoolean_(row.is_paid); },
      function (row) {
        row.is_paid = true;
        row.paid_at = now;
        row.settlement_id = settlementId;
        return row;
      }
    );

    updateRowsByCondition_(
      'Settlements',
      function (row) { return !toBoolean_(row.is_reconciled); },
      function (row) {
        row.is_reconciled = true;
        return row;
      }
    );

    appendGuestFeesToLedger_(newlyPaidGuests, settlementId, now, editorEmail, membersMap);
    return;
  }

  // Trường hợp cục bộ: thành viên nào không còn xuất hiện trong netBalances (balance == 0)
  // và cặp giao dịch tương ứng đều có netBalance == 0 thì đóng các dòng của họ.
  var nonZeroMap = {};
  for (var i = 0; i < debtsAfter.netBalances.length; i++) {
    nonZeroMap[debtsAfter.netBalances[i].memberId] = true;
  }

  var newlyPaidLocalGuests = [];
  updateRowsByCondition_(
    'Attendance',
    function (row) {
      if (toBoolean_(row.is_paid) || toInt_(row.fee_amount, 0) <= 0) return false;
      var mId = String(row.member_id || '').trim();
      var cId = String(row.creditor_id || settings.treasurer_member_id).trim();
      return !nonZeroMap[mId] && !nonZeroMap[cId];
    },
    function (row) {
      row.is_paid = true;
      row.paid_at = now;
      row.settlement_id = settlementId;
      if (
        String(row.session_type || '').toUpperCase() === 'BADMINTON' &&
        String(row.member_type_snapshot || '').toUpperCase() === 'GUEST'
      ) {
        newlyPaidLocalGuests.push(row);
      }
      return row;
    }
  );

  updateRowsByCondition_(
    'Fund_Ledger',
    function (row) {
      if (String(row.type || '').toUpperCase() !== 'EXPENSE' || toBoolean_(row.is_paid)) return false;
      var mId = String(row.member_id || '').trim();
      return !nonZeroMap[mId] && !nonZeroMap[settings.treasurer_member_id];
    },
    function (row) {
      row.is_paid = true;
      row.paid_at = now;
      row.settlement_id = settlementId;
      return row;
    }
  );

  updateRowsByCondition_(
    'Settlements',
    function (row) {
      if (toBoolean_(row.is_reconciled)) return false;
      var fId = String(row.from_member_id || '').trim();
      var tId = String(row.to_member_id || '').trim();
      return !nonZeroMap[fId] && !nonZeroMap[tId];
    },
    function (row) {
      row.is_reconciled = true;
      return row;
    }
  );

  appendGuestFeesToLedger_(newlyPaidLocalGuests, settlementId, now, editorEmail, membersMap);
}

/**
 * Tự động cộng phí vãng lai vào Fund_Ledger (có kiểm tra chống trùng theo attendance_id).
 */
function appendGuestFeesToLedger_(attendanceRows, settlementId, now, editorEmail, membersMap) {
  if (!attendanceRows || attendanceRows.length === 0) return;
  var existingLedger = getSheetObjects_('Fund_Ledger');
  var existingAttIds = {};
  for (var i = 0; i < existingLedger.length; i++) {
    var aid = String(existingLedger[i].attendance_id || '').trim();
    if (aid) existingAttIds[aid] = true;
  }

  var toAppend = [];
  for (var j = 0; j < attendanceRows.length; j++) {
    var a = attendanceRows[j];
    var attId = String(a.attendance_id || '').trim();
    var fee = toInt_(a.fee_amount, 0);
    if (!attId || fee <= 0 || existingAttIds[attId]) continue;

    existingAttIds[attId] = true;
    var mId = String(a.member_id || '').trim();
    var mName = membersMap[mId] ? membersMap[mId].name : mId;
    var sDate = String(a.session_date || todayDateStr_()).trim();

    toAppend.push({
      ledger_id: generateId_('LED') + '_GF_' + j,
      date: sDate,
      type: 'INCOME',
      category: 'GUEST_FEE',
      amount: fee,
      member_id: mId,
      session_id: String(a.session_id || '').trim(),
      attendance_id: attId,
      period: sDate.slice(0, 7),
      is_paid: true,
      paid_at: now,
      settlement_id: settlementId || '',
      receipt_drive_id: '',
      receipt_url: '',
      description: 'Thu phí vãng lai: ' + mName + ' (ngày ' + sDate + ')',
      created_by: editorEmail,
      created_at: now
    });
  }

  if (toAppend.length > 0) {
    appendObjects_('Fund_Ledger', toAppend);
  }
}

/**
 * Thêm mới hoặc cập nhật thông tin thành viên trong tab Members.
 *
 * @param {Object} payload
 * @return {Object}
 */
function upsertMemberRecord(payload) {
  var p = payload || {};
  var name = String(p.name || '').trim();
  if (!name) {
    throw createAppError_('BAD_REQUEST', 'Tên thành viên không được để trống.');
  }

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

  if (count === 0) {
    throw createAppError_('NOT_FOUND', 'Không tìm thấy thành viên ' + memberId);
  }
  return { member: updatedObj };
}

/**
 * Thêm dòng Thu / Chi mới vào Fund_Ledger.
 *
 * @param {Object} payload
 * @param {string} editorEmail
 * @return {Object}
 */
function addFundEntryRecord(payload, editorEmail) {
  var p = payload || {};
  var settings = getSettingsMap();
  var now = nowIso_();

  var entryType = String(p.type || '').trim().toUpperCase();
  if (entryType !== 'INCOME' && entryType !== 'EXPENSE') {
    throw createAppError_('BAD_REQUEST', 'type phải là INCOME hoặc EXPENSE.');
  }

  var amount = toInt_(p.amount, 0);
  if (amount <= 0) {
    throw createAppError_('BAD_REQUEST', 'Số tiền phải lớn hơn 0.');
  }

  var dateStr = String(p.date || todayDateStr_()).trim();
  var category = String(p.category || (entryType === 'INCOME' ? 'MONTHLY_FUND' : 'COURT')).trim().toUpperCase();
  var memberId = String(p.memberId || p.member_id || settings.treasurer_member_id || '').trim();
  var period = String(p.period || dateStr.slice(0, 7)).trim();
  var description = String(p.description || '').trim();
  if (!description) {
    throw createAppError_('BAD_REQUEST', 'Vui lòng nhập diễn giải cho bút toán quỹ.');
  }

  var treasurerId = settings.treasurer_member_id;
  var isPaid = entryType === 'INCOME' || !treasurerId || memberId === treasurerId;

  var entryObj = {
    ledger_id: generateId_('LED'),
    date: dateStr,
    type: entryType,
    category: category,
    amount: amount,
    member_id: memberId,
    session_id: String(p.sessionId || p.session_id || '').trim(),
    attendance_id: '',
    period: period,
    is_paid: isPaid,
    paid_at: isPaid ? now : '',
    settlement_id: '',
    receipt_drive_id: String(p.receiptDriveId || p.receipt_drive_id || '').trim(),
    receipt_url: String(p.receiptUrl || p.receipt_url || '').trim(),
    description: description,
    created_by: editorEmail,
    created_at: now
  };

  appendObjects_('Fund_Ledger', [entryObj]);
  return { entry: entryObj };
}

/**
 * Cập nhật cấu hình trong tab Settings.
 *
 * @param {Object} payload
 * @param {string} editorEmail
 * @return {Object}
 */
function updateSettingsRecord(payload, editorEmail) {
  var p = payload || {};
  var incoming = (p.settings && typeof p.settings === 'object') ? p.settings : p;
  var keys = Object.keys(incoming);
  if (keys.length === 0) {
    throw createAppError_('BAD_REQUEST', 'Không có khóa cấu hình nào để cập nhật.');
  }

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

  if (toAppend.length > 0) {
    appendObjects_('Settings', toAppend);
  }

  return { settings: getSettingsMap() };
}

/**
 * Lấy danh sách Editors từ tab Editors.
 *
 * @return {Array<Object>}
 */
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

/**
 * Chỉnh sửa buổi chơi đã tạo (bảo toàn các khoản Attendance đã gắn settlement_id).
 *
 * @param {Object} payload
 * @param {string} editorEmail
 * @return {Object}
 */
function updateSessionRecord(payload, editorEmail) {
  var p = payload || {};
  var sessionId = String(p.sessionId || p.session_id || '').trim();
  if (!sessionId) {
    throw createAppError_('BAD_REQUEST', 'Thiếu sessionId cần cập nhật.');
  }

  var existingSessions = getSessionsList({});
  var oldSession = null;
  for (var sIdx = 0; sIdx < existingSessions.length; sIdx++) {
    if (existingSessions[sIdx].session_id === sessionId) {
      oldSession = existingSessions[sIdx];
      break;
    }
  }
  if (!oldSession) {
    throw createAppError_('NOT_FOUND', 'Không tìm thấy buổi ' + sessionId);
  }

  var settings = getSettingsMap();
  var now = nowIso_();
  var sessionCategory = String(p.category || p.type || oldSession.type).trim().toUpperCase();
  if (sessionCategory !== 'BADMINTON' && sessionCategory !== 'DRINKING') {
    throw createAppError_('BAD_REQUEST', 'category/type phải là BADMINTON hoặc DRINKING.');
  }

  var dateStr = String(p.date || oldSession.date).trim();
  var title = String(p.title || oldSession.title).trim();
  var totalAmount = Math.max(0, toInt_(p.total_amount !== undefined ? p.total_amount : p.totalAmount, oldSession.total_amount));
  var guestFee = Math.max(0, toInt_(p.guest_fee !== undefined ? p.guest_fee : p.guestFee, oldSession.guest_fee || settings.guest_fee));
  var payerId = String(p.payer_id || p.payerId || oldSession.payer_id || settings.treasurer_member_id).trim();
  var receiptDriveId = p.receipt_drive_id !== undefined || p.receiptDriveId !== undefined
    ? String(p.receipt_drive_id !== undefined ? p.receipt_drive_id : p.receiptDriveId).trim()
    : oldSession.receipt_drive_id;
  var receiptUrl = p.receipt_url !== undefined || p.receiptUrl !== undefined
    ? String(p.receipt_url !== undefined ? p.receipt_url : p.receiptUrl).trim()
    : oldSession.receipt_url;
  var receiptSummary = p.receipt_summary !== undefined || p.receiptSummary !== undefined
    ? String(p.receipt_summary !== undefined ? p.receipt_summary : p.receiptSummary).trim()
    : oldSession.receipt_summary;
  var note = p.note !== undefined ? String(p.note).trim() : oldSession.note;

  // Tạo new_guests nếu có
  var rawNewGuests = Array.isArray(p.new_guests)
    ? p.new_guests
    : (Array.isArray(p.quickNewGuests) ? p.quickNewGuests : []);
  var existingMembers = getMembersList(false);
  var membersByNameLower = {};
  for (var em = 0; em < existingMembers.length; em++) {
    membersByNameLower[existingMembers[em].name.toLowerCase()] = existingMembers[em];
  }
  var newGuestIds = [];
  var membersToAppend = [];
  var paidImmediatelySet = {};
  var rawPaidImmediate = Array.isArray(p.paid_immediately_member_ids)
    ? p.paid_immediately_member_ids
    : (Array.isArray(p.paidImmediatelyMemberIds) ? p.paidImmediatelyMemberIds : []);
  for (var pi = 0; pi < rawPaidImmediate.length; pi++) {
    paidImmediatelySet[String(rawPaidImmediate[pi]).trim()] = true;
  }

  for (var gIdx = 0; gIdx < rawNewGuests.length; gIdx++) {
    var gItem = rawNewGuests[gIdx];
    var gName = typeof gItem === 'string' ? gItem.trim() : String((gItem && gItem.name) || '').trim();
    if (!gName) continue;
    var foundM = membersByNameLower[gName.toLowerCase()];
    if (foundM) {
      newGuestIds.push(foundM.member_id);
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
    existingMembers.push(newMemObj);
    membersByNameLower[gName.toLowerCase()] = newMemObj;
    newGuestIds.push(newId);
    if (typeof gItem === 'object' && gItem && toBoolean_(gItem.paidImmediately || gItem.paid_immediately)) {
      paidImmediatelySet[newId] = true;
    }
  }
  if (membersToAppend.length > 0) {
    appendObjects_('Members', membersToAppend);
  }

  var rawAttendeeIds = Array.isArray(p.attendee_ids)
    ? p.attendee_ids
    : (Array.isArray(p.attendeeIds) ? p.attendeeIds : []);
  var combinedIds = rawAttendeeIds.concat(newGuestIds);
  var seenAtt = {};
  var attendeeIds = [];
  for (var aIdx = 0; aIdx < combinedIds.length; aIdx++) {
    var aid = String(combinedIds[aIdx] || '').trim();
    if (aid && !seenAtt[aid]) {
      seenAtt[aid] = true;
      attendeeIds.push(aid);
    }
  }

  if (sessionCategory === 'DRINKING' && attendeeIds.length === 0) {
    throw createAppError_('BAD_REQUEST', 'Buổi Ăn nhậu phải có ít nhất 1 người tham gia.');
  }

  var unit = settings.rounding_unit || 1000;
  var perPersonAmount = sessionCategory === 'DRINKING' && attendeeIds.length > 0
    ? Math.round(totalAmount / attendeeIds.length / unit) * unit
    : 0;

  var updatedSession = null;
  updateRowsByCondition_(
    'Sessions',
    function (row) { return String(row.session_id || '').trim() === sessionId; },
    function (row) {
      row.date = dateStr;
      row.type = sessionCategory;
      row.title = title;
      row.total_amount = totalAmount;
      row.guest_fee = sessionCategory === 'BADMINTON' ? guestFee : 0;
      row.payer_id = payerId;
      row.per_person_amount = perPersonAmount;
      row.attendee_count = attendeeIds.length;
      row.receipt_drive_id = receiptDriveId;
      row.receipt_url = receiptUrl;
      row.receipt_summary = receiptSummary;
      row.note = note;
      row.updated_at = now;
      updatedSession = row;
      return row;
    }
  );

  // Bảo toàn Attendance đã gắn settlement_id; xóa các dòng Attendance chưa đối soát để ghi lại
  var currentAtts = getSheetObjects_('Attendance');
  var lockedMemberIds = {};
  for (var ca = 0; ca < currentAtts.length; ca++) {
    var curA = currentAtts[ca];
    if (String(curA.session_id || '').trim() === sessionId && String(curA.settlement_id || '').trim()) {
      lockedMemberIds[String(curA.member_id || '').trim()] = true;
    }
  }

  deleteRowsByCondition_('Attendance', function (row) {
    return String(row.session_id || '').trim() === sessionId && !String(row.settlement_id || '').trim();
  });

  var membersMap = buildMembersMap_(existingMembers);
  var treasurerId = settings.treasurer_member_id;
  var newAttRows = [];
  var newGuestLedgerRows = [];

  for (var i = 0; i < attendeeIds.length; i++) {
    var mId = attendeeIds[i];
    if (lockedMemberIds[mId]) continue; // Giữ nguyên khoản đã đối soát
    var member = membersMap[mId];
    if (!member) continue;

    var attId = generateId_('ATT') + '_U_' + i;
    var mType = member.type === 'GUEST' ? 'GUEST' : 'MAIN';
    var feeAmount = 0;
    var creditorId = '';
    var isPaid = true;
    var paidAt = now;

    if (sessionCategory === 'BADMINTON') {
      if (mType === 'GUEST') {
        feeAmount = guestFee;
        creditorId = treasurerId || payerId;
        isPaid = Boolean(paidImmediatelySet[mId]) || feeAmount === 0;
        paidAt = isPaid ? now : '';
        if (isPaid && feeAmount > 0) {
          newGuestLedgerRows.push({
            ledger_id: generateId_('LED') + '_UG_' + i,
            date: dateStr,
            type: 'INCOME',
            category: 'GUEST_FEE',
            amount: feeAmount,
            member_id: mId,
            session_id: sessionId,
            attendance_id: attId,
            period: dateStr.slice(0, 7),
            is_paid: true,
            paid_at: now,
            settlement_id: '',
            receipt_drive_id: '',
            receipt_url: '',
            description: 'Phí vãng lai tại sân: ' + member.name + ' (' + title + ')',
            created_by: editorEmail,
            created_at: now
          });
        }
      } else {
        feeAmount = 0;
        creditorId = treasurerId || payerId;
        isPaid = true;
        paidAt = now;
      }
    } else {
      feeAmount = perPersonAmount;
      creditorId = payerId;
      isPaid = (mId === payerId) || feeAmount === 0;
      paidAt = isPaid ? now : '';
    }

    newAttRows.push({
      attendance_id: attId,
      session_id: sessionId,
      session_date: dateStr,
      session_type: sessionCategory,
      member_id: mId,
      member_type_snapshot: mType,
      fee_amount: feeAmount,
      creditor_id: creditorId,
      is_paid: isPaid,
      paid_at: paidAt,
      settlement_id: '',
      note: ''
    });
  }

  if (newAttRows.length > 0) {
    appendObjects_('Attendance', newAttRows);
  }

  // Cập nhật chi phí EXPENSE chưa đối soát của buổi BADMINTON trong Fund_Ledger
  deleteRowsByCondition_('Fund_Ledger', function (row) {
    return (
      String(row.session_id || '').trim() === sessionId &&
      String(row.type || '').toUpperCase() === 'EXPENSE' &&
      !String(row.settlement_id || '').trim()
    );
  });

  if (sessionCategory === 'BADMINTON' && totalAmount > 0) {
    var expPayer = payerId || treasurerId;
    var expPaid = !treasurerId || expPayer === treasurerId;
    newGuestLedgerRows.push({
      ledger_id: generateId_('LED') + '_UE',
      date: dateStr,
      type: 'EXPENSE',
      category: String(p.expense_category || p.expenseCategory || 'COURT').trim().toUpperCase(),
      amount: totalAmount,
      member_id: expPayer,
      session_id: sessionId,
      attendance_id: '',
      period: dateStr.slice(0, 7),
      is_paid: expPaid,
      paid_at: expPaid ? now : '',
      settlement_id: '',
      receipt_drive_id: receiptDriveId,
      receipt_url: receiptUrl,
      description: String(p.expense_description || receiptSummary || ('Chi phí ' + title)).trim(),
      created_by: editorEmail,
      created_at: now
    });
  }

  if (newGuestLedgerRows.length > 0) {
    appendObjects_('Fund_Ledger', newGuestLedgerRows);
  }

  return {
    session: updatedSession,
    attendances: newAttRows
  };
}

/**
 * Xóa buổi chơi (chặn xóa nếu đã có khoản thanh toán gắn settlement_id).
 *
 * @param {Object} payload
 * @return {Object}
 */
function deleteSessionRecord(payload) {
  var p = payload || {};
  var sessionId = String(p.sessionId || p.session_id || '').trim();
  if (!sessionId) {
    throw createAppError_('BAD_REQUEST', 'Thiếu sessionId cần xóa.');
  }

  var attRows = getSheetObjects_('Attendance');
  for (var i = 0; i < attRows.length; i++) {
    if (String(attRows[i].session_id || '').trim() === sessionId && String(attRows[i].settlement_id || '').trim()) {
      throw createAppError_('BAD_REQUEST', 'Không thể xóa buổi đã có khoản thanh toán được đối soát.');
    }
  }

  var ledgerRows = getSheetObjects_('Fund_Ledger');
  for (var j = 0; j < ledgerRows.length; j++) {
    if (String(ledgerRows[j].session_id || '').trim() === sessionId && String(ledgerRows[j].settlement_id || '').trim()) {
      throw createAppError_('BAD_REQUEST', 'Không thể xóa buổi đã có khoản sổ quỹ được đối soát.');
    }
  }

  var deletedSessions = deleteRowsByCondition_('Sessions', function (row) {
    return String(row.session_id || '').trim() === sessionId;
  });
  if (deletedSessions === 0) {
    throw createAppError_('NOT_FOUND', 'Không tìm thấy buổi ' + sessionId);
  }

  deleteRowsByCondition_('Attendance', function (row) {
    return String(row.session_id || '').trim() === sessionId;
  });
  deleteRowsByCondition_('Fund_Ledger', function (row) {
    return String(row.session_id || '').trim() === sessionId;
  });

  return { deletedSessionId: sessionId };
}

/**
 * Quản lý danh sách Editors (chỉ role ADMIN).
 *
 * @param {Object} payload
 * @param {Object} authInfo
 * @return {Object}
 */
function manageEditorsRecord(payload, authInfo) {
  if (!authInfo || authInfo.role !== 'ADMIN') {
    throw createAppError_('FORBIDDEN', 'Chỉ tài khoản có vai trò ADMIN mới được quản lý danh sách Editors.');
  }

  var p = payload || {};
  var operation = String(p.operation || 'UPSERT').trim().toUpperCase();
  var email = String(p.email || '').trim().toLowerCase();
  if (!email) {
    throw createAppError_('BAD_REQUEST', 'Thiếu email của Editor.');
  }

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
