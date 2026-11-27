/**
 * drinkingSplit.ts
 * Chia tiền buổi ăn nhậu (ở quán hoặc tại nhà) có hỗ trợ nhiều người góp món/hóa đơn:
 * - Tổng buổi = Σ tất cả khoản góp (BILL + ITEM)
 * - Phần chia/người = ceil(Tổng buổi / số người, đơn vị làm tròn) để người ứng tiền không bị hụt
 * - Số dư mỗi người = Phần chia - Tổng đã góp (> 0: phải trả thêm, < 0: được nhận lại)
 * - Bù sai số làm tròn vào người góp nhiều nhất (ưu tiên preferredPayerId nếu hòa) để tổng số dư luôn = 0
 */

import type { SessionItemInput } from '../types';

export interface DrinkingPersonSplit {
  memberId: string;
  perPersonAmount: number;
  contributedAmount: number;
  netAmount: number; // > 0 phải trả thêm, < 0 được nhận lại, 0 là hòa
  isPaid: boolean;
}

export interface DrinkingSplitResult {
  totalAmount: number;
  perPersonAmount: number;
  splits: DrinkingPersonSplit[];
  roundingAdjustment: number;
  roundingAdjustedMemberId: string | null;
}

export function calculateDrinkingSplit(
  attendeeIds: string[],
  items: SessionItemInput[],
  roundingUnit = 1000,
  preferredPayerId?: string
): DrinkingSplitResult {
  const uniqueAttendees = Array.from(new Set(attendeeIds.map((id) => id.trim()).filter(Boolean)));
  const unit = Math.max(1, Math.round(Number(roundingUnit) || 1000));

  const contributedByMember = new Map<string, number>();
  let totalAmount = 0;

  for (const item of items) {
    const amt = Math.max(0, Math.round(Number(item.amount) || 0));
    if (amt <= 0) continue;
    totalAmount += amt;
    const mId = String(item.member_id || '').trim();
    if (mId) {
      contributedByMember.set(mId, (contributedByMember.get(mId) || 0) + amt);
    }
  }

  // Đảm bảo người góp món (dù lỡ chưa tick trong attendeeIds) cũng được tính nếu có đóng góp
  const allParticipantIds = Array.from(
    new Set([...uniqueAttendees, ...Array.from(contributedByMember.keys())])
  );

  if (allParticipantIds.length === 0) {
    return {
      totalAmount: 0,
      perPersonAmount: 0,
      splits: [],
      roundingAdjustment: 0,
      roundingAdjustedMemberId: null,
    };
  }

  const perPersonAmount =
    totalAmount > 0
      ? Math.ceil(totalAmount / allParticipantIds.length / unit) * unit
      : 0;

  const splits: DrinkingPersonSplit[] = allParticipantIds.map((memberId) => {
    const contributed = contributedByMember.get(memberId) || 0;
    const netAmount = perPersonAmount - contributed;
    return {
      memberId,
      perPersonAmount,
      contributedAmount: contributed,
      netAmount,
      isPaid: netAmount === 0,
    };
  });

  // Bù sai số làm tròn (nếu có) vào người góp nhiều nhất (ưu tiên preferredPayerId nếu hòa) để sum(netAmount) === 0
  const netSum = splits.reduce((acc, s) => acc + s.netAmount, 0);
  let roundingAdjustment = 0;
  let roundingAdjustedMemberId: string | null = null;
  if (netSum !== 0 && splits.length > 0) {
    const prefId = String(preferredPayerId || '').trim();
    let targetIdx = 0;
    let maxContributed = -1;
    for (let i = 0; i < splits.length; i++) {
      if (
        splits[i].contributedAmount > maxContributed ||
        (splits[i].contributedAmount === maxContributed &&
          prefId &&
          splits[i].memberId === prefId)
      ) {
        maxContributed = splits[i].contributedAmount;
        targetIdx = i;
      }
    }
    splits[targetIdx].netAmount -= netSum;
    splits[targetIdx].isPaid = splits[targetIdx].netAmount === 0;
    roundingAdjustment = -netSum;
    roundingAdjustedMemberId = splits[targetIdx].memberId;
  }

  return {
    totalAmount,
    perPersonAmount,
    splits,
    roundingAdjustment,
    roundingAdjustedMemberId,
  };
}
