/**
 * AuthService.gs
 * Xác thực Google ID Token (Google Identity Services) và kiểm tra quyền trong tab Editors / liên kết Members.email.
 */

/**
 * Xác thực chữ ký & thông tin Google ID Token qua TokenInfo API.
 *
 * @param {string} idToken Google ID Token (JWT)
 * @return {{ok: boolean, status: number, code?: string, message?: string, email?: string, name?: string}}
 */
function verifyGoogleJwt_(idToken) {
  if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Thiếu id_token xác thực.'
    };
  }

  var props = PropertiesService.getScriptProperties();
  var googleClientId = String(props.getProperty('GOOGLE_CLIENT_ID') || '').trim();
  if (!googleClientId) {
    return {
      ok: false,
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
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Không thể kết nối Google TokenInfo API: ' + err.message
    };
  }

  if (res.getResponseCode() !== 200) {
    return {
      ok: false,
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
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Dữ liệu phản hồi từ Google TokenInfo không hợp lệ.'
    };
  }

  if (String(tokenInfo.aud || '').trim() !== googleClientId) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Token không khớp GOOGLE_CLIENT_ID của ứng dụng.'
    };
  }

  var emailVerified = tokenInfo.email_verified === true || String(tokenInfo.email_verified).toLowerCase() === 'true';
  if (!emailVerified) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Email Google chưa được xác minh.'
    };
  }

  var expMs = Number(tokenInfo.exp || 0) * 1000;
  if (!expMs || expMs <= Date.now()) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Phiên đăng nhập Google đã hết hạn. Vui lòng đăng nhập lại.'
    };
  }

  var email = String(tokenInfo.email || '').trim().toLowerCase();
  if (!email) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Token không chứa thông tin email.'
    };
  }

  return {
    ok: true,
    status: 200,
    email: email,
    name: String(tokenInfo.name || email).trim()
  };
}

/**
 * Xác thực người dùng Google (hỗ trợ cả Editor/Admin lẫn thành viên thường MEMBER).
 * - Nếu email có trong Editors (is_active=TRUE) -> isEditor=true, role=ADMIN|EDITOR
 * - Nếu không -> isEditor=false, role=MEMBER, kèm linkedMemberId tra trong Members.email
 */
function verifyUserToken(idToken) {
  var jwt = verifyGoogleJwt_(idToken);
  if (!jwt.ok) {
    return {
      authorized: false,
      isEditor: false,
      status: jwt.status,
      code: jwt.code,
      message: jwt.message
    };
  }

  var editors = getSheetObjects_('Editors');
  var matchedEditor = null;
  for (var i = 0; i < editors.length; i++) {
    var row = editors[i];
    var rowEmail = String(row.email || '').trim().toLowerCase();
    if (rowEmail === jwt.email && toBoolean_(row.is_active)) {
      matchedEditor = row;
      break;
    }
  }

  var members = getSheetObjects_('Members');
  var linkedMemberId = '';
  var linkedMemberName = '';
  for (var m = 0; m < members.length; m++) {
    if (String(members[m].email || '').trim().toLowerCase() === jwt.email) {
      linkedMemberId = String(members[m].member_id || '').trim();
      linkedMemberName = String(members[m].name || '').trim();
      break;
    }
  }

  if (matchedEditor) {
    return {
      authorized: true,
      isEditor: true,
      status: 200,
      email: jwt.email,
      name: String(matchedEditor.name || jwt.name || jwt.email).trim(),
      role: String(matchedEditor.role || 'EDITOR').trim().toUpperCase(),
      linkedMemberId: linkedMemberId
    };
  }

  return {
    authorized: true,
    isEditor: false,
    status: 200,
    email: jwt.email,
    name: linkedMemberName || jwt.name || jwt.email,
    role: 'MEMBER',
    linkedMemberId: linkedMemberId
  };
}

/**
 * Xác thực bắt buộc quyền Editor/Admin (tương thích ngược).
 */
function verifyEditorToken(idToken) {
  var user = verifyUserToken(idToken);
  if (!user.authorized) {
    return user;
  }
  if (!user.isEditor) {
    return {
      authorized: false,
      isEditor: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Tài khoản ' + user.email + ' không nằm trong danh sách Editors đang hoạt động.'
    };
  }
  return user;
}
