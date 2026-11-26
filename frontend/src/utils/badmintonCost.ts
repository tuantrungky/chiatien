/**
 * badmintonCost.ts
 * Tính chi phí một buổi cầu lông:
 * - Tiền sân = tổng các dòng sân (số sân * số giờ * giá/giờ), hỗ trợ "Sân thêm giờ"
 * - Tiền cầu = số quả cầu * giá mỗi quả cầu
 * - Tổng buổi = Tiền sân + Tiền cầu + Chi phí khác
 * - Hỗ trợ ghi đè tay từng ô (courtOverride, shuttleOverride, totalOverride)
 */

import type { BadmintonCostDetail, CourtLineItem } from '../types';

export interface CalculateBadmintonCostInput {
  courtLines: CourtLineItem[];
  shuttleQty: number;
  shuttlePrice: number;
  otherAmount: number;
  courtOverride?: boolean;
  manualCourtAmount?: number;
  shuttleOverride?: boolean;
  manualShuttleAmount?: number;
  totalOverride?: boolean;
  manualTotalAmount?: number;
}

export interface BadmintonCostResult {
  courtLines: Array<CourtLineItem & { amount: number }>;
  calculatedCourtAmount: number;
  courtAmount: number;
  calculatedShuttleAmount: number;
  shuttleAmount: number;
  otherAmount: number;
  calculatedTotalAmount: number;
  totalAmount: number;
  detail: BadmintonCostDetail;
}

export function calculateCourtLineAmount(line: CourtLineItem): number {
  const courts = Math.max(0, Number(line.courts) || 0);
  const hours = Math.max(0, Number(line.hours) || 0);
  const price = Math.max(0, Number(line.pricePerHour) || 0);
  return Math.round(courts * hours * price);
}

export function calculateBadmintonCost(input: CalculateBadmintonCostInput): BadmintonCostResult {
  const linesWithAmount = (input.courtLines || []).map((line) => ({
    ...line,
    courts: Math.max(0, Number(line.courts) || 0),
    hours: Math.max(0, Number(line.hours) || 0),
    pricePerHour: Math.max(0, Number(line.pricePerHour) || 0),
    amount: calculateCourtLineAmount(line),
  }));

  const calculatedCourtAmount = linesWithAmount.reduce((sum, l) => sum + l.amount, 0);
  const courtOverride = Boolean(input.courtOverride);
  const courtAmount = courtOverride
    ? Math.max(0, Math.round(Number(input.manualCourtAmount) || 0))
    : calculatedCourtAmount;

  const shuttleQty = Math.max(0, Math.round(Number(input.shuttleQty) || 0));
  const shuttlePrice = Math.max(0, Math.round(Number(input.shuttlePrice) || 0));
  const calculatedShuttleAmount = shuttleQty * shuttlePrice;
  const shuttleOverride = Boolean(input.shuttleOverride);
  const shuttleAmount = shuttleOverride
    ? Math.max(0, Math.round(Number(input.manualShuttleAmount) || 0))
    : calculatedShuttleAmount;

  const otherAmount = Math.max(0, Math.round(Number(input.otherAmount) || 0));
  const calculatedTotalAmount = courtAmount + shuttleAmount + otherAmount;
  const totalOverride = Boolean(input.totalOverride);
  const totalAmount = totalOverride
    ? Math.max(0, Math.round(Number(input.manualTotalAmount) || 0))
    : calculatedTotalAmount;

  return {
    courtLines: linesWithAmount,
    calculatedCourtAmount,
    courtAmount,
    calculatedShuttleAmount,
    shuttleAmount,
    otherAmount,
    calculatedTotalAmount,
    totalAmount,
    detail: {
      courtLines: linesWithAmount,
      shuttlePrice,
      courtOverride,
      shuttleOverride,
      totalOverride,
    },
  };
}
