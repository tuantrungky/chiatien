import { describe, expect, it } from 'vitest';
import { calculateDetailedMonthlyBill, calculateMonthlyBill } from './monthlyBill';

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

  it('Chi tiết hóa đơn: Tiền sân + SL*Giá ống + Thêm giờ T.trước, hỗ trợ ghi đè tổng chủ sân', () => {
    const auto = calculateDetailedMonthlyBill({
      courtFee: 1800000,
      shuttleTubeQty: 4,
      shuttleTubePrice: 250000,
      prevOvertimeFee: 200000,
      carryIn: 0,
      memberIds: ['M1', 'M2', 'M3', 'M4'],
      roundingUnit: 1000,
    });

    expect(auto.shuttleTubeAmount).toBe(1000000);
    expect(auto.venueTotal).toBe(3000000);
    expect(auto.perMember).toBe(750000);
    expect(auto.billedTotal).toBe(3000000);

    const overridden = calculateDetailedMonthlyBill({
      courtFee: 1800000,
      shuttleTubeQty: 4,
      shuttleTubePrice: 250000,
      prevOvertimeFee: 200000,
      venueTotalOverride: true,
      manualVenueTotal: 2950000,
      carryIn: 150000,
      memberIds: ['M1', 'M2', 'M3', 'M4'],
      roundingUnit: 1000,
    });
    expect(overridden.venueTotal).toBe(2950000);
    expect(overridden.toCollect).toBe(2800000);
    expect(overridden.perMember).toBe(700000);
  });

  it('Trừ tiền góp ống cầu tháng trước cho người góp vào tiền đóng đầu tháng tới', () => {
    // Tổng hóa đơn chủ sân = 2.500.000đ. Tuấn góp 2 ống * 250.000 = 500.000đ -> tổng chi nhóm 3.000.000đ / 4 = 750.000đ/ng
    // Tuấn đóng: 750k - 500k = 250k; 3 người còn lại đóng 750k -> Tổng thu về Thủ quỹ = 2.500.000đ (vừa khít chủ sân)
    const res = calculateDetailedMonthlyBill({
      courtFee: 2000000,
      shuttleTubeQty: 2,
      shuttleTubePrice: 200000,
      prevOvertimeFee: 100000,
      carryIn: 0,
      memberIds: ['TUAN', 'THAO', 'CHUNG', 'QUYEN'],
      appliedCredits: [
        {
          id: 'C1',
          member_id: 'TUAN',
          member_name: 'Tuấn',
          tube_qty: 2,
          unit_price: 250000,
          amount: 500000,
          note: 'Cầu Lining',
        },
      ],
      roundingUnit: 1000,
    });

    expect(res.venueTotal).toBe(2500000);
    expect(res.appliedCreditsTotal).toBe(500000);
    expect(res.perMember).toBe(750000);
    expect(res.billedTotal).toBe(2500000);

    const tuanDue = res.memberDues.find((d) => d.memberId === 'TUAN')!;
    const thaoDue = res.memberDues.find((d) => d.memberId === 'THAO')!;
    expect(tuanDue.netAmount).toBe(250000);
    expect(tuanDue.creditAmount).toBe(500000);
    expect(thaoDue.netAmount).toBe(750000);
  });

  it('Góp cầu lớn hơn phần đóng tháng -> netAmount = 0 và ghi nhận phần dư', () => {
    const res = calculateDetailedMonthlyBill({
      courtFee: 1000000,
      shuttleTubeQty: 0,
      shuttleTubePrice: 0,
      prevOvertimeFee: 0,
      carryIn: 0,
      memberIds: ['TUAN', 'THAO', 'CHUNG', 'QUYEN'],
      appliedCredits: [
        { id: 'C1', member_id: 'TUAN', tube_qty: 3, unit_price: 280000, amount: 840000 },
      ],
      roundingUnit: 1000,
    });

    const tuanDue = res.memberDues.find((d) => d.memberId === 'TUAN')!;
    expect(res.perMember).toBe(460000); // ceil((1.000.000 + 840.000) / 4) = 460.000
    expect(tuanDue.netAmount).toBe(0);
    expect(tuanDue.remainingCredit).toBe(380000);
    expect(res.carryOverCredits).toHaveLength(1);
    expect(res.carryOverCredits[0].amount).toBe(380000);
  });

  it('Góp cầu từ người không nằm trong MAIN tạo refundCredits và trừ đúng khỏi carryOut', () => {
    const res = calculateDetailedMonthlyBill({
      courtFee: 1600000,
      shuttleTubeQty: 0,
      shuttleTubePrice: 0,
      prevOvertimeFee: 0,
      carryIn: 0,
      actualCost: 1600000,
      guestIncome: 200000,
      memberIds: ['M1', 'M2', 'M3', 'M4'],
      appliedCredits: [
        { id: 'CG', member_id: 'GUEST_X', member_name: 'Khách A', tube_qty: 1, unit_price: 400000, amount: 400000 },
      ],
      roundingUnit: 1000,
    });

    expect(res.perMember).toBe(500000); // (1.600.000 + 400.000) / 4
    expect(res.billedTotal).toBe(2000000);
    expect(res.refundCredits).toHaveLength(1);
    expect(res.refundCreditsTotal).toBe(400000);
    expect(res.carryOverCredits).toHaveLength(0);
    // carryOut = carryIn(0) + billedTotal(2.000.000) + guestIncome(200.000) - actualCost(1.600.000) - refundCreditsTotal(400.000) = 200.000
    expect(res.carryOut).toBe(200000);
  });
});
