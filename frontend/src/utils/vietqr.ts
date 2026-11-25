/**
 * vietqr.ts
 * Tiện ích sinh URL ảnh VietQR (img.vietqr.io), chuẩn hóa tiếng Việt không dấu
 * và định dạng tiền tệ VND.
 */

export interface BuildVietQrUrlParams {
  bankBin?: string | null;
  accountNo?: string | null;
  accountName?: string | null;
  amount: number;
  addInfo?: string;
  template?: string;
}

/**
 * Loại bỏ dấu tiếng Việt và ký tự đặc biệt để nội dung chuyển khoản
 * tương thích với tất cả app ngân hàng tại Việt Nam.
 */
export function removeVietnameseDiacritics(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Định dạng số nguyên VND theo chuẩn Việt Nam (VD: 50000 -> "50.000đ").
 */
export function formatVND(amount: number): string {
  const rounded = Math.round(Number(amount) || 0);
  const sign = rounded < 0 ? '-' : '';
  const absFormatted = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${absFormatted}đ`;
}

/**
 * Tạo nội dung chuyển khoản VietQR không dấu, tối đa 50 ký tự.
 * VD: "CLN Tuan tra Hung"
 */
export function buildTransferContent(
  prefix: string,
  fromName: string,
  toName: string,
  maxLength = 50
): string {
  const cleanPrefix = removeVietnameseDiacritics(prefix || 'CLN');
  const cleanFrom = removeVietnameseDiacritics(fromName);
  const cleanTo = removeVietnameseDiacritics(toName);
  const raw = `${cleanPrefix} ${cleanFrom} tra ${cleanTo}`.replace(/\s+/g, ' ').trim();
  return raw.slice(0, maxLength).trim();
}

/**
 * Sinh URL ảnh VietQR chuẩn theo img.vietqr.io.
 * Trả về null nếu người nhận chưa cấu hình bankBin hoặc accountNo.
 */
export function buildVietQrUrl(params: BuildVietQrUrlParams): string | null {
  const bankBin = String(params.bankBin || '').trim();
  const accountNo = String(params.accountNo || '').trim();
  if (!bankBin || !accountNo) {
    return null;
  }

  const template = String(params.template || 'compact2').trim() || 'compact2';
  const amount = Math.max(0, Math.round(Number(params.amount) || 0));
  const cleanInfo = removeVietnameseDiacritics(params.addInfo || '').slice(0, 50).trim();
  const cleanAccountName = removeVietnameseDiacritics(params.accountName || '').toUpperCase();

  const queryParts: string[] = [`amount=${amount}`];
  if (cleanInfo) {
    queryParts.push(`addInfo=${encodeURIComponent(cleanInfo)}`);
  }
  if (cleanAccountName) {
    queryParts.push(`accountName=${encodeURIComponent(cleanAccountName)}`);
  }

  return `https://img.vietqr.io/image/${encodeURIComponent(bankBin)}-${encodeURIComponent(accountNo)}-${encodeURIComponent(template)}.png?${queryParts.join('&')}`;
}
