/**
 * Code.gs
 * Entry point cho Google Apps Script Web App (doGet & doPost).
 * Hỗ trợ chống CORS preflight khi Frontend gửi POST text/plain;charset=utf-8,
 * CacheService 5 phút cho getAll, và LockService cho mọi thao tác ghi.
 */

/**
 * Xử lý HTTP GET công khai cho Viewer (không yêu cầu đăng nhập).
 *
 * @param {GoogleAppsScript.Events.DoGet} e
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = String(params.action || '').trim();

    if (!action || action === 'ping') {
      return jsonResponse_(true, {
        service: 'Caulong-Nhau GAS API',
        status: 'ready',
        pong: true
      });
    }

    var data;
    switch (action) {
      case 'getAll':
        data = getCachedAllData_(params.periodType, params.refDate, params.month);
        break;

      case 'bootstrap':
        data = {
          settings: getSettingsMap(),
          members: getMembersList(false)
        };
        break;

      case 'getDashboard':
        data = getDashboardData(params.periodType, params.refDate);
        break;

      case 'getMembers':
        data = {
          members: getMembersList(toBoolean_(params.activeOnly))
        };
        break;

      case 'getSessions':
        data = {
          sessions: getSessionsList({
            type: params.type || params.category || 'ALL',
            startDate: params.startDate,
            endDate: params.endDate
          })
        };
        break;

      case 'getSessionDetail':
        data = getSessionDetail(params.sessionId);
        break;

      case 'getSettings':
        data = {
          settings: getSettingsMap()
        };
        break;

      case 'getGuestStats':
        data = getGuestStatsData(params.month);
        break;

      case 'getDebts':
        data = computeDebtsData();
        break;

      case 'getSchedule':
        data = getScheduleData(params.month);
        break;

      case 'getMonthlyBill':
        data = getMonthlyBillData(params.month);
        break;

      default:
        return jsonError_('BAD_REQUEST', 'Action GET không được hỗ trợ: ' + action);
    }

    return jsonResponse_(true, data);
  } catch (err) {
    return jsonError_(err.code || 'INTERNAL_ERROR', err.message || 'Lỗi hệ thống không xác định.');
  }
}

/**
 * Đọc getAll qua CacheService (TTL 5 phút, tự vô hiệu khi ghi dữ liệu).
 */
function getCachedAllData_(periodType, refDate, month) {
  var pType = String(periodType || 'MONTH').trim().toUpperCase();
  var rDate = String(refDate || todayDateStr_()).trim();
  var mStr = String(month || rDate.slice(0, 7)).trim();
  var ver = getCacheVersion_();
  var cacheKey = 'cln_all_v' + ver + '_' + pType + '_' + rDate + '_' + mStr;

  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    var fresh = getAllData(pType, rDate, mStr);
    var serialized = JSON.stringify(fresh);
    if (serialized.length < 95000) {
      cache.put(cacheKey, serialized, 300);
    }
    return fresh;
  } catch (e) {
    return getAllData(pType, rDate, mStr);
  }
}

/**
 * Xử lý HTTP POST (Frontend gửi Content-Type: text/plain;charset=utf-8 để tránh CORS preflight).
 * Mọi action ghi dữ liệu và AI bắt buộc xác thực Google id_token qua AuthService.
 *
 * @param {GoogleAppsScript.Events.DoPost} e
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonError_('BAD_REQUEST', 'Body request trống.');
    }

    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonError_('BAD_REQUEST', 'Body phải là chuỗi JSON hợp lệ.');
    }

    var action = String(body.action || '').trim();
    if (!action) {
      return jsonError_('BAD_REQUEST', 'Thiếu trường action trong body.');
    }

    var idToken = String(body.id_token || body.idToken || '').trim();
    var payload = (body.payload && typeof body.payload === 'object') ? body.payload : body;

    // 1. Xác thực Google ID Token (cho phép cả Editor lẫn Member thường)
    var auth = verifyUserToken(idToken);
    if (!auth.authorized) {
      return jsonError_(
        auth.code || 'UNAUTHORIZED',
        auth.message || 'Phiên đăng nhập không hợp lệ.',
        auth.status
      );
    }

    // 2. Endpoint cho mọi tài khoản Google đã đăng nhập (Editor & Member)
    if (action === 'verifyEditor' || action === 'verifyUser') {
      return jsonResponse_(true, {
        authorized: true,
        isEditor: Boolean(auth.isEditor),
        email: auth.email,
        name: auth.name,
        role: auth.role,
        linkedMemberId: auth.linkedMemberId || ''
      });
    }

    if (action === 'linkMemberEmail') {
      var userLock = LockService.getScriptLock();
      if (!userLock.tryLock(15000)) {
        return jsonError_('CONFLICT_LOCK', 'Hệ thống đang bận, vui lòng thử lại sau vài giây.');
      }
      try {
        var linked = linkMemberEmailRecord(payload, auth.email);
        bumpCacheVersion_();
        return jsonResponse_(true, linked);
      } finally {
        userLock.releaseLock();
      }
    }

    // 3. Từ đây trở xuống BẮT BUỘC phải là Editor hoặc Admin
    if (!auth.isEditor) {
      return jsonError_(
        'FORBIDDEN',
        'Tài khoản ' + auth.email + ' chỉ có quyền thành viên xem công khai, không thể chỉnh sửa dữ liệu.',
        403
      );
    }

    if (action === 'getEditors') {
      return jsonResponse_(true, {
        editors: getEditorsList()
      });
    }

    // 3. Action AI quét hóa đơn & Google Drive
    if (action === 'parseBillAI' || action === 'parseReceipt') {
      var imgBase64 = payload.base64Image || payload.imageBase64 || '';
      var imgMime = payload.mimeType || 'image/jpeg';
      var sDate = payload.sessionDate || payload.session_date || '';

      var driveInfo = uploadBillImage(imgBase64, imgMime, sDate);
      var aiBill = parseBillImage(imgBase64, imgMime);

      return jsonResponse_(true, {
        receipt_drive_id: driveInfo.fileId,
        receipt_url: driveInfo.viewUrl,
        direct_url: driveInfo.directUrl,
        thumbnail_url: driveInfo.thumbnailUrl,
        folder_name: driveInfo.folderName,
        total_amount: aiBill.total_amount,
        items_summary: aiBill.items_summary,
        suggested_title: aiBill.suggested_title
      });
    }

    // 4. Các action ghi Google Sheets: dùng LockService để chống xung đột ghi đồng thời
    var lock = LockService.getScriptLock();
    var locked = lock.tryLock(15000);
    if (!locked) {
      return jsonError_('CONFLICT_LOCK', 'Hệ thống đang xử lý thao tác khác. Vui lòng thử lại sau vài giây.');
    }

    try {
      var result;
      switch (action) {
        case 'createSession':
          result = createSessionRecord(payload, auth.email);
          break;

        case 'updateSession':
          result = updateSessionRecord(payload, auth.email);
          break;

        case 'deleteSession':
          result = deleteSessionRecord(payload);
          break;

        case 'confirmPayment':
        case 'confirmSettlement':
          result = confirmPaymentRecord(payload, auth.email);
          break;

        case 'undoSettlement':
          result = undoSettlementRecord(payload);
          break;

        case 'generateSchedule':
          result = generateScheduleRecord(payload);
          break;

        case 'updateScheduleDay':
          result = updateScheduleDayRecord(payload);
          break;

        case 'issueMonthlyBill':
          result = issueMonthlyBillRecord(payload, auth.email);
          break;

        case 'saveMonthlyContributions':
          result = saveMonthlyContributionsRecord(payload, auth.email);
          break;

        case 'markDuePaid':
          result = markDuePaidRecord(payload, auth.email);
          break;

        case 'closeMonth':
          result = closeMonthRecord(payload, auth.email);
          break;

        case 'upsertMember':
          result = upsertMemberRecord(payload);
          break;

        case 'updateSettings':
          result = updateSettingsRecord(payload, auth.email);
          break;

        case 'manageEditors':
          result = manageEditorsRecord(payload, auth);
          break;

        case 'exportRawTables':
          result = exportRawTablesRecord(auth);
          break;

        case 'importRawTables':
          result = importRawTablesRecord(payload, auth);
          break;

        default:
          return jsonError_('BAD_REQUEST', 'Action POST không được hỗ trợ: ' + action);
      }

      // Xóa CacheService ngay sau mọi thao tác ghi
      bumpCacheVersion_();
      return jsonResponse_(true, result);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonError_(err.code || 'INTERNAL_ERROR', err.message || 'Lỗi xử lý POST request.');
  }
}

function jsonResponse_(ok, data, errorObj) {
  var body = {
    ok: ok,
    data: ok ? data : null,
    meta: {
      timestamp: nowIso_()
    },
    error: ok ? null : (errorObj || { code: 'INTERNAL_ERROR', message: 'Unknown error' })
  };

  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(code, message, httpStatusHint) {
  var errObj = {
    code: code || 'INTERNAL_ERROR',
    message: message || 'Có lỗi xảy ra.'
  };
  if (httpStatusHint) {
    errObj.status = httpStatusHint;
  }
  return jsonResponse_(false, null, errObj);
}
