import { describe, expect, it } from 'vitest';
import { calculateMonthlyBill } from './monthlyBill';

describe('monthlyBill', () => {
  it('Tháng đầu: dự toán 3.000.000 / 10 MAIN -> 300.000/người; thực chi 2.800.000 + vãng lai 400.000 -> dư ra 600.000', () => {
    const res = calculateMonthlyBill({
      estimate: 3000000,
      carryIn: 0,
      memberCount: 10,
      roundingUnit: 1000,
      actualCost: 2800000,
      guestIncome: 400000,
    });

    expect(res.toCollect).toBe(3000000);
    expect(res.perMember).toBe(300000);
    expect(res.billedTotal).toBe(3000000);
    expect(res.carryOut).toBe(600000);
  });

  it('Tháng sau: dư vào 600.000 trừ vào dự toán 3.000.000 -> cần thu 2.400.000 -> 240.000/người', () => {
    const res = calculateMonthlyBill({
      estimate: 3000000,
      carryIn: 600000,
      memberCount: 10,
      roundingUnit: 1000,
      actualCost: 3000000,
      guestIncome: 0,
    });

    expect(res.toCollect).toBe(2400000);
    expect(res.perMember).toBe(240000);
    expect(res.carryOut).toBe(0);
  });

  it('Dư vào âm (tháng trước thiếu) tự cộng vào cần thu tháng sau & làm tròn lên bội số 1000', () => {
    const res = calculateMonthlyBill({
      estimate: 2500000,
      carryIn: -200000,
      memberCount: 9,
      roundingUnit: 1000,
      actualCost: 2700000,
      guestIncome: 100000,
    });

    expect(res.toCollect).toBe(2700000);
    expect(res.perMember).toBe(300000);
    expect(res.billedTotal).toBe(2700000);
    expect(res.carryOut).toBe(-200000 + 2700000 + 100000 - 2700000);
  });

  it('Dư vào lớn hơn dự toán -> cần thu = 0, mỗi người = 0', () => {
    const res = calculateMonthlyBill({
      estimate: 1000000,
      carryIn: 1500000,
      memberCount: 10,
      roundingUnit: 1000,
      actualCost: 900000,
      guestIncome: 50000,
    });

    expect(res.toCollect).toBe(0);
    expect(res.perMember).toBe(0);
    expect(res.carryOut).toBe(650000);
  });
});
