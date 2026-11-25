import { describe, expect, it } from 'vitest';
import {
  buildTransferContent,
  buildVietQrUrl,
  formatVND,
  removeVietnameseDiacritics,
} from './vietqr';

describe('vietqr utilities', () => {
  it('removeVietnameseDiacritics loại bỏ dấu tiếng Việt và ký tự đặc biệt', () => {
    expect(removeVietnameseDiacritics('Nguyễn Anh Tuấn - Đóng quỹ!')).toBe(
      'Nguyen Anh Tuan Dong quy'
    );
    expect(removeVietnameseDiacritics('Đỗ Nhật Minh')).toBe('Do Nhat Minh');
  });

  it('formatVND định dạng đúng tiền Việt Nam', () => {
    expect(formatVND(50000)).toBe('50.000đ');
    expect(formatVND(1250000)).toBe('1.250.000đ');
    expect(formatVND(-150000)).toBe('-150.000đ');
    expect(formatVND(0)).toBe('0đ');
  });

  it('buildTransferContent không vượt quá 50 ký tự và không có dấu', () => {
    const content = buildTransferContent(
      'CLN',
      'Nguyễn Trần Hoàng Phương Thảo',
      'Trần Lê Minh Vương Tuấn Anh'
    );
    expect(content.length).toBeLessThanOrEqual(50);
    expect(content).toMatch(/^[a-zA-Z0-9\s]+$/);
  });

  it('buildVietQrUrl sinh URL chuẩn encodeURIComponent và trả null khi thiếu STK/BIN', () => {
    expect(buildVietQrUrl({ bankBin: '', accountNo: '0123456', amount: 50000 })).toBeNull();
    expect(buildVietQrUrl({ bankBin: '970436', accountNo: '', amount: 50000 })).toBeNull();

    const url = buildVietQrUrl({
      bankBin: '970436',
      accountNo: '0123456789',
      accountName: 'Nguyễn Anh Tuấn',
      amount: 150000,
      addInfo: 'CLN Minh trả Tuấn',
      template: 'compact2',
    });

    expect(url).toBe(
      'https://img.vietqr.io/image/970436-0123456789-compact2.png?amount=150000&addInfo=CLN%20Minh%20tra%20Tuan&accountName=NGUYEN%20ANH%20TUAN'
    );
  });
});
