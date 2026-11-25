/**
 * DriveService.gs
 * Quản lý lưu trữ ảnh hóa đơn lên Google Drive theo subfolder YYYY-MM.
 */

/**
 * Tải ảnh hóa đơn base64 lên Google Drive (tự tạo subfolder YYYY-MM),
 * bật quyền xem ANYONE_WITH_LINK và trả về các URL hiển thị.
 *
 * @param {string} base64Image Chuỗi base64 của ảnh (có hoặc không có prefix data:...)
 * @param {string} mimeType Kiểu MIME của ảnh (mặc định image/jpeg)
 * @param {string=} sessionDate Ngày của buổi dạng YYYY-MM-DD (tùy chọn)
 * @return {{fileId: string, fileName: string, folderName: string, viewUrl: string, directUrl: string, thumbnailUrl: string}}
 */
function uploadBillImage(base64Image, mimeType, sessionDate) {
  if (!base64Image || typeof base64Image !== 'string') {
    throw createAppError_('BAD_REQUEST', 'Thiếu dữ liệu ảnh base64.');
  }

  var props = PropertiesService.getScriptProperties();
  var rootFolderId = String(
    props.getProperty('ROOT_DRIVE_FOLDER_ID') ||
    props.getProperty('DRIVE_ROOT_FOLDER_ID') ||
    ''
  ).trim();

  if (!rootFolderId) {
    var settings = getSettingsMap();
    rootFolderId = String(settings.drive_folder_id || '').trim();
  }

  if (!rootFolderId) {
    throw createAppError_(
      'DRIVE_ERROR',
      'Chưa cấu hình ROOT_DRIVE_FOLDER_ID trong Script Properties hoặc drive_folder_id trong Settings.'
    );
  }

  var cleanMime = String(mimeType || '').trim();
  var cleanBase64 = base64Image.trim();

  var dataUrlMatch = cleanBase64.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    if (!cleanMime) {
      cleanMime = dataUrlMatch[1];
    }
    cleanBase64 = dataUrlMatch[2];
  }
  if (!cleanMime) {
    cleanMime = 'image/jpeg';
  }

  var monthFolderName = resolveMonthFolderName_(sessionDate);
  var ext = resolveImageExtension_(cleanMime);
  var timestamp = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyyMMdd_HHmmss');
  var fileName = 'bill_' + timestamp + '.' + ext;

  try {
    var rootFolder = DriveApp.getFolderById(rootFolderId);
    var subFolders = rootFolder.getFoldersByName(monthFolderName);
    var monthFolder = subFolders.hasNext()
      ? subFolders.next()
      : rootFolder.createFolder(monthFolderName);

    var bytes = Utilities.base64Decode(cleanBase64);
    var blob = Utilities.newBlob(bytes, cleanMime, fileName);
    var file = monthFolder.createFile(blob);

    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();
    return {
      fileId: fileId,
      fileName: fileName,
      folderName: monthFolderName,
      viewUrl: 'https://drive.google.com/file/d/' + fileId + '/view',
      directUrl: 'https://drive.google.com/uc?export=view&id=' + fileId,
      thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000'
    };
  } catch (err) {
    throw createAppError_('DRIVE_ERROR', 'Lỗi khi lưu ảnh lên Google Drive: ' + err.message);
  }
}

/**
 * Xác định tên thư mục tháng YYYY-MM.
 *
 * @param {string=} sessionDate
 * @return {string}
 */
function resolveMonthFolderName_(sessionDate) {
  if (sessionDate && /^\d{4}-\d{2}(-\d{2})?$/.test(String(sessionDate).trim())) {
    return String(sessionDate).trim().slice(0, 7);
  }
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM');
}

/**
 * Suy ra phần mở rộng file ảnh từ MIME type.
 *
 * @param {string} mimeType
 * @return {string}
 */
function resolveImageExtension_(mimeType) {
  var lower = String(mimeType || '').toLowerCase();
  if (lower.indexOf('png') !== -1) return 'png';
  if (lower.indexOf('webp') !== -1) return 'webp';
  if (lower.indexOf('heic') !== -1) return 'heic';
  return 'jpg';
}
