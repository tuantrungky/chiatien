/**
 * AuthService.gs
 * Xác thực Google ID Token (Google Identity Services) và kiểm tra quyền trong tab Editors.
 */

/**
 * Xác thực id_token gửi từ Frontend và đối chiếu với danh sách Editors trong Google Sheet.
 *
 * @param {string} idToken Google ID Token (JWT)
 * @return {{authorized: boolean, status: number, code?: string, message?: string, email?: string, name?: string, role?: string}}
 */
function verifyEditorToken(idToken) {
  if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
    return {
      authorized: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Thiếu id_token xác thực.'
    };
  }

  var props = PropertiesService.getScriptProperties();
  var googleClientId = String(props.getProperty('GOOGLE_CLIENT_ID') || '').trim();
  if (!googleClientId) {
    return {
      authorized: false,
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Chưa cấu hình Script Property GOOGLE_CLIENT_ID trên GAS.'
    };
  }

  var tokenUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken.trim());
  var res;
  try {
    res = UrlFetchApp.fetch(tokenUrl, { muteHttpExceptions: true });
  } catch (err) {
    return {
      authorized: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Không thể kết nối Google TokenInfo API: ' + err.message
    };
  }

  if (res.getResponseCode() !== 200) {
    return {
      authorized: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Google ID Token không hợp lệ hoặc đã hết hạn.'
    };
  }

  var tokenInfo;
  try {
    tokenInfo = JSON.parse(res.getContentText());
  } catch (parseErr) {
    return {
      authorized: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Dữ liệu phản hồi từ Google TokenInfo không hợp lệ.'
    };
  }

  if (String(tokenInfo.aud || '').trim() !== googleClientId) {
    return {
      authorized: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Token không khớp GOOGLE_CLIENT_ID của ứng dụng.'
    };
  }

  var emailVerified = tokenInfo.email_verified === true || String(tokenInfo.email_verified).toLowerCase() === 'true';
  if (!emailVerified) {
    return {
      authorized: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Email Google chưa được xác minh.'
    };
  }

  var expMs = Number(tokenInfo.exp || 0) * 1000;
  if (!expMs || expMs <= Date.now()) {
    return {
      authorized: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Phiên đăng nhập Google đã hết hạn. Vui lòng đăng nhập lại.'
    };
  }

  var email = String(tokenInfo.email || '').trim().toLowerCase();
  if (!email) {
    return {
      authorized: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Token không chứa thông tin email.'
    };
  }

  var editors = getSheetObjects_('Editors');
  var matchedEditor = null;
  for (var i = 0; i < editors.length; i++) {
    var row = editors[i];
    var rowEmail = String(row.email || '').trim().toLowerCase();
    if (rowEmail === email && toBoolean_(row.is_active)) {
      matchedEditor = row;
      break;
    }
  }

  if (!matchedEditor) {
    return {
      authorized: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Tài khoản ' + email + ' không nằm trong danh sách Editors đang hoạt động.'
    };
  }

  return {
    authorized: true,
    status: 200,
    email: email,
    name: String(matchedEditor.name || tokenInfo.name || email).trim(),
    role: String(matchedEditor.role || 'EDITOR').trim().toUpperCase()
  };
}
