import { describe, expect, it } from 'vitest';
import { calculateAdhocPerPerson, calculateBadmintonCost } from './badmintonCost';

describe('badmintonCost', () => {
  it('Tính sân đơn + tiền cầu + chi phí khác', () => {
    const res = calculateBadmintonCost({
      courtLines: [{ label: 'Sân chính', courts: 2, hours: 1.5, pricePerHour: 120000 }],
      shuttleQty: 8,
      shuttlePrice: 25000,
      otherAmount: 30000,
    });

    expect(res.courtAmount).toBe(360000);
    expect(res.shuttleAmount).toBe(200000);
    expect(res.totalAmount).toBe(590000);
  });

  it('Tính sân chính + sân thêm giờ khi vãng lai tăng', () => {
    const res = calculateBadmintonCost({
      courtLines: [
        { label: 'Sân chính', courts: 2, hours: 1.5, pricePerHour: 120000 },
        { label: 'Sân thêm giờ', courts: 1, hours: 1.5, pricePerHour: 130000, isExtra: true },
      ],
      shuttleQty: 10,
      shuttlePrice: 25000,
      otherAmount: 0,
    });

    expect(res.courtLines[0].amount).toBe(360000);
    expect(res.courtLines[1].amount).toBe(195000);
    expect(res.courtAmount).toBe(555000);
    expect(res.shuttleAmount).toBe(250000);
    expect(res.totalAmount).toBe(805000);
  });

  it('Cho phép ghi đè tay tiền sân, tiền cầu và tổng buổi', () => {
    const res = calculateBadmintonCost({
      courtLines: [{ label: 'Sân chính', courts: 2, hours: 1.5, pricePerHour: 120000 }],
      shuttleQty: 8,
      shuttlePrice: 25000,
      otherAmount: 20000,
      courtOverride: true,
      manualCourtAmount: 350000,
      shuttleOverride: true,
      manualShuttleAmount: 190000,
      totalOverride: true,
      manualTotalAmount: 550000,
    });

    expect(res.calculatedCourtAmount).toBe(360000);
    expect(res.courtAmount).toBe(350000);
    expect(res.shuttleAmount).toBe(190000);
    expect(res.calculatedTotalAmount).toBe(560000);
    expect(res.totalAmount).toBe(550000);
  });

  it('Chia đều buổi cầu phát sinh làm tròn lên theo 1.000đ', () => {
    expect(calculateAdhocPerPerson(400000, 7, 1000)).toBe(58000);
    expect(calculateAdhocPerPerson(300000, 6, 1000)).toBe(50000);
    expect(calculateAdhocPerPerson(0, 5, 1000)).toBe(0);
    expect(calculateAdhocPerPerson(300000, 0, 1000)).toBe(0);
  });
});
