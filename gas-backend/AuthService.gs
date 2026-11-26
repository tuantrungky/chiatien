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
 * Xác thực Firebase ID Token thông qua Firebase Identity Toolkit REST API (accounts:lookup).
 * Yêu cầu Script Property FIREBASE_WEB_API_KEY trên GAS.
 *
 * @param {string} idToken Firebase Auth ID Token (JWT)
 * @return {{ok: boolean, status: number, code?: string, message?: string, email?: string, name?: string}}
 */
function verifyFirebaseIdToken_(idToken) {
  var props = PropertiesService.getScriptProperties();
  var firebaseApiKey = String(props.getProperty('FIREBASE_WEB_API_KEY') || '').trim();
  if (!firebaseApiKey) {
    return {
      ok: false,
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Chưa cấu hình Script Property FIREBASE_WEB_API_KEY trên GAS để xác thực Firebase Token.'
    };
  }

  var lookupUrl = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(firebaseApiKey);
  var res;
  try {
    res = UrlFetchApp.fetch(lookupUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ idToken: idToken.trim() }),
      muteHttpExceptions: true
    });
  } catch (err) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Không thể kết nối Firebase Identity Toolkit API: ' + err.message
    };
  }

  if (res.getResponseCode() !== 200) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Firebase ID Token không hợp lệ hoặc đã hết hạn.'
    };
  }

  var body;
  try {
    body = JSON.parse(res.getContentText());
  } catch (parseErr) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Phản hồi từ Firebase Identity Toolkit không hợp lệ.'
    };
  }

  var users = Array.isArray(body.users) ? body.users : [];
  if (users.length === 0) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Không tìm thấy tài khoản tương ứng với Firebase Token.'
    };
  }

  var user = users[0];
  var email = String(user.email || '').trim().toLowerCase();
  var emailVerified = user.emailVerified === true || String(user.emailVerified).toLowerCase() === 'true';
  if (!email || !emailVerified) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Email Firebase chưa được xác minh hoặc bị thiếu.'
    };
  }

  return {
    ok: true,
    status: 200,
    email: email,
    name: String(user.displayName || email).trim()
  };
}

/**
 * Đọc nhanh trường iss trong JWT payload để phân luồng Firebase Token vs GIS Token
 * (chỉ dùng để chọn endpoint xác thực, KHÔNG tin cậy trước khi verify qua Google/Firebase API).
 */
function peekJwtIssuer_(idToken) {
  try {
    var parts = String(idToken || '').split('.');
    if (parts.length < 2) return '';
    var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    var decoded = Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString('UTF-8');
    var payload = JSON.parse(decoded);
    return String(payload.iss || '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * Xác thực người dùng Google (hỗ trợ song song Firebase Auth ID Token & Google Identity Services ID Token).
 * - Nếu email có trong Editors (is_active=TRUE) -> isEditor=true, role=ADMIN|EDITOR
 * - Nếu không -> isEditor=false, role=MEMBER, kèm linkedMemberId tra trong Members.email
 */
function verifyUserToken(idToken) {
  var issuer = peekJwtIssuer_(idToken);
  var jwt = issuer.indexOf('https://securetoken.google.com/') === 0
    ? verifyFirebaseIdToken_(idToken)
    : verifyGoogleJwt_(idToken);
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
