/**
 * monthlyBill.ts
 * Công thức hóa đơn tháng cầu lông:
 * - Tổng tiền chủ sân = Tiền sân + (SL ống cầu * Giá/ống) + Tiền thêm giờ tháng trước (hoặc sửa tay)
 * - Trừ tiền góp ống cầu tháng trước cho người góp:
 *   grossToDistribute = max(0, venueTotal + appliedCreditsTotal - carryIn)
 *   perMember = ceil(grossToDistribute / memberCount / roundingUnit) * roundingUnit
 *   netDue[member] = max(0, perMember - credit[member])
 * - Dư ra tháng sau = dư vào + đã chia (sum netDue) + phí vãng lai đã thu - chi thực tế
 */

import type { ShuttleContributionItem } from '../types';

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

export interface DetailedMonthlyBillInput {
  courtFee: number;
  shuttleTubeQty: number;
  shuttleTubePrice: number;
  shuttleAmountOverride?: boolean;
  manualShuttleAmount?: number;
  prevOvertimeFee: number;
  venueTotalOverride?: boolean;
  manualVenueTotal?: number;
  carryIn: number;
  memberIds: string[];
  appliedCredits?: ShuttleContributionItem[];
  roundingUnit?: number;
  actualCost?: number;
  guestIncome?: number;
}

export interface DetailedMemberDueLine {
  memberId: string;
  baseAmount: number;
  creditAmount: number;
  netAmount: number;
  remainingCredit: number;
  creditNote: string;
}

export interface DetailedMonthlyBillResult {
  courtFee: number;
  shuttleTubeQty: number;
  shuttleTubePrice: number;
  calculatedShuttleAmount: number;
  shuttleTubeAmount: number;
  prevOvertimeFee: number;
  calculatedVenueTotal: number;
  venueTotal: number;
  carryIn: number;
  appliedCreditsTotal: number;
  toCollect: number;
  grossToDistribute: number;
  memberCount: number;
  perMember: number;
  billedTotal: number;
  memberDues: DetailedMemberDueLine[];
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

export function calculateDetailedMonthlyBill(
  input: DetailedMonthlyBillInput
): DetailedMonthlyBillResult {
  const courtFee = Math.max(0, Math.round(Number(input.courtFee) || 0));
  const shuttleTubeQty = Math.max(0, Number(input.shuttleTubeQty) || 0);
  const shuttleTubePrice = Math.max(0, Math.round(Number(input.shuttleTubePrice) || 0));
  const calculatedShuttleAmount = Math.round(shuttleTubeQty * shuttleTubePrice);
  const shuttleTubeAmount = input.shuttleAmountOverride
    ? Math.max(0, Math.round(Number(input.manualShuttleAmount) || 0))
    : calculatedShuttleAmount;

  const prevOvertimeFee = Math.max(0, Math.round(Number(input.prevOvertimeFee) || 0));
  const calculatedVenueTotal = courtFee + shuttleTubeAmount + prevOvertimeFee;
  const venueTotal = input.venueTotalOverride
    ? Math.max(0, Math.round(Number(input.manualVenueTotal) || 0))
    : calculatedVenueTotal;

  const carryIn = Math.round(Number(input.carryIn) || 0);
  const unit = Math.max(1, Math.round(Number(input.roundingUnit) || 1000));
  const memberIds = Array.from(new Set((input.memberIds || []).filter(Boolean)));
  const memberCount = memberIds.length;

  const creditByMember = new Map<string, number>();
  const creditNotesByMember = new Map<string, string[]>();
  let appliedCreditsTotal = 0;

  for (const cr of input.appliedCredits || []) {
    const amt = Math.max(0, Math.round(Number(cr.amount) || 0));
    if (!cr.member_id || amt <= 0) continue;
    appliedCreditsTotal += amt;
    creditByMember.set(cr.member_id, (creditByMember.get(cr.member_id) || 0) + amt);
    const label = `${cr.tube_qty > 0 ? `${cr.tube_qty} ống` : 'góp cầu'} (${amt.toLocaleString('vi-VN')}đ)`;
    const existing = creditNotesByMember.get(cr.member_id) || [];
    existing.push(cr.note ? `${cr.note} - ${label}` : label);
    creditNotesByMember.set(cr.member_id, existing);
  }

  const toCollect = Math.max(0, venueTotal - carryIn);
  const grossToDistribute = Math.max(0, venueTotal + appliedCreditsTotal - carryIn);
  const perMember =
    memberCount > 0 && grossToDistribute > 0
      ? Math.ceil(grossToDistribute / memberCount / unit) * unit
      : 0;

  let billedTotal = 0;
  const memberDues: DetailedMemberDueLine[] = memberIds.map((memberId) => {
    const creditAmount = creditByMember.get(memberId) || 0;
    const netAmount = Math.max(0, perMember - creditAmount);
    const remainingCredit = creditAmount > perMember ? creditAmount - perMember : 0;
    billedTotal += netAmount;
    let creditNote = '';
    if (creditAmount > 0) {
      creditNote = `Trừ góp cầu: ${(creditNotesByMember.get(memberId) || []).join(', ')}`;
      if (remainingCredit > 0) {
        creditNote += ` (Còn dư ${remainingCredit.toLocaleString('vi-VN')}đ)`;
      }
    }
    return {
      memberId,
      baseAmount: perMember,
      creditAmount,
      netAmount,
      remainingCredit,
      creditNote,
    };
  });

  const actualCost = Math.max(0, Math.round(Number(input.actualCost) || 0));
  const guestIncome = Math.max(0, Math.round(Number(input.guestIncome) || 0));
  const carryOut = carryIn + billedTotal + guestIncome - actualCost;

  return {
    courtFee,
    shuttleTubeQty,
    shuttleTubePrice,
    calculatedShuttleAmount,
    shuttleTubeAmount,
    prevOvertimeFee,
    calculatedVenueTotal,
    venueTotal,
    carryIn,
    appliedCreditsTotal,
    toCollect,
    grossToDistribute,
    memberCount,
    perMember,
    billedTotal,
    memberDues,
    actualCost,
    guestIncome,
    carryOut,
  };
}
