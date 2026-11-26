/**
 * monthlyBill.ts
 * Công thức hóa đơn tháng cầu lông:
 * - Cần thu = max(0, dự toán - dư chuyển sang)
 * - Mỗi MAIN = ceil(Cần thu / số MAIN / đơn vị làm tròn) * đơn vị làm tròn
 * - Đã chia = Mỗi MAIN * số MAIN
 * - Dư ra tháng sau = dư vào + đã chia + phí vãng lai đã thu - chi thực tế
 */

export interface MonthlyBillCalculationInput {
  estimate: number;
  carryIn: number;
  memberCount: number;
  roundingUnit?: number;
  actualCost?: number;
  guestIncome?: number;
}

export interface MonthlyBillCalculationResult {
  estimate: number;
  carryIn: number;
  toCollect: number;
  memberCount: number;
  perMember: number;
  billedTotal: number;
  actualCost: number;
  guestIncome: number;
  carryOut: number;
}

export function calculateMonthlyBill(input: MonthlyBillCalculationInput): MonthlyBillCalculationResult {
  const estimate = Math.max(0, Math.round(Number(input.estimate) || 0));
  const carryIn = Math.round(Number(input.carryIn) || 0);
  const memberCount = Math.max(0, Math.round(Number(input.memberCount) || 0));
  const unit = Math.max(1, Math.round(Number(input.roundingUnit) || 1000));
  const actualCost = Math.max(0, Math.round(Number(input.actualCost) || 0));
  const guestIncome = Math.max(0, Math.round(Number(input.guestIncome) || 0));

  const toCollect = Math.max(0, estimate - carryIn);
  const perMember =
    memberCount > 0 && toCollect > 0
      ? Math.ceil(toCollect / memberCount / unit) * unit
      : 0;
  const billedTotal = perMember * memberCount;
  const carryOut = carryIn + billedTotal + guestIncome - actualCost;

  return {
    estimate,
    carryIn,
    toCollect,
    memberCount,
    perMember,
    billedTotal,
    actualCost,
    guestIncome,
    carryOut,
  };
}
