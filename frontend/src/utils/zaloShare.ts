/**
 * zaloShare.ts
 * Tạo mẫu tin nhắn ngắn gọn, rõ ràng để Thủ quỹ / thành viên copy gửi nhóm Zalo.
 */

import type {
  BadmintonMonthlyDueItem,
  Member,
  MonthlyBill,
  SeparatedDebtsData,
  SimplifiedDebtResult,
} from '../types';
import { formatShortDateVN } from './dateFilters';
import { getOverdueInfo } from './overdue';
import { formatVND } from './vietqr';

export function buildMonthlyBillZaloMessage(params: {
  clubName: string;
  month: string;
  bill: MonthlyBill;
  dues: BadmintonMonthlyDueItem[];
  treasurer?: Member;
  appUrl?: string;
}): string {
  const { clubName, month, bill, dues, treasurer, appUrl } = params;
  const [y, m] = month.split('-');
  const lines: string[] = [];

  lines.push(`🏸 [${clubName}] BÁO THU TIỀN CẦU THÁNG ${m}/${y}`);
  if ((bill.court_fee ?? 0) > 0 || (bill.shuttle_tube_amount ?? 0) > 0 || (bill.prev_overtime_fee ?? 0) > 0) {
    const parts: string[] = [`Sân ${formatVND(bill.court_fee ?? 0)}`];
    if ((bill.shuttle_tube_amount ?? 0) > 0) {
      parts.push(`${bill.shuttle_tube_qty || 0} ống cầu ${formatVND(bill.shuttle_tube_amount ?? 0)}`);
    }
    if ((bill.prev_overtime_fee ?? 0) > 0) {
      parts.push(`Thêm giờ ${formatVND(bill.prev_overtime_fee ?? 0)}`);
    }
    lines.push(`• Hóa đơn chủ sân: ${formatVND(bill.estimate)} (${parts.join(' + ')})`);
  } else {
    lines.push(`• Tổng hóa đơn tháng: ${formatVND(bill.estimate)}`);
  }

  if (bill.carry_in !== 0) {
    lines.push(
      `• Dư/thiếu T.trước: ${bill.carry_in >= 0 ? '+' : ''}${formatVND(bill.carry_in)}`
    );
  }
  if (bill.bill_detail) {
    try {
      const detail = JSON.parse(bill.bill_detail) as {
        refundCredits?: Array<{ member_name?: string; member_id: string; amount: number }>;
      };
      if (Array.isArray(detail.refundCredits) && detail.refundCredits.length > 0) {
        const listStr = detail.refundCredits
          .map((r) => `${r.member_name || r.member_id} (${formatVND(r.amount)})`)
          .join(', ');
        lines.push(`• Hoàn tiền góp cầu (không đánh chính): ${listStr}`);
      }
    } catch {
      // ignore invalid JSON
    }
  }
  lines.push(`• Phần gốc mỗi người: ${formatVND(bill.per_member)}`);

  const unpaid = dues.filter((d) => !d.is_paid && d.amount > 0);
  if (unpaid.length === 0) {
    lines.push('✅ Mọi thành viên chính đã đóng đủ!');
  } else {
    lines.push('');
    lines.push(`📋 Danh sách chưa đóng (${unpaid.length} người):`);
    unpaid.forEach((d, idx) => {
      const hasCredit = (d.credit_amount ?? 0) > 0;
      const creditNote = hasCredit ? ` (đã trừ ${formatVND(d.credit_amount ?? 0)} góp cầu)` : '';
      lines.push(`${idx + 1}. ${d.member_name}: ${formatVND(d.amount)}${creditNote}`);
    });
  }

  if (treasurer && treasurer.account_no) {
    lines.push('');
    lines.push(
      `💳 Chuyển về Thủ quỹ ${treasurer.name}: ${treasurer.bank_name} - ${treasurer.account_no} (${treasurer.account_name || treasurer.name})`
    );
  }
  if (appUrl) {
    lines.push(`🔗 Xem & quét VietQR: ${appUrl}`);
  }
  return lines.join('\n');
}

export function buildDebtsZaloMessage(params: {
  clubName: string;
  debts: SeparatedDebtsData | null;
  simplifiedDrinkingDebts: SimplifiedDebtResult;
  treasurer?: Member;
  appUrl?: string;
  todayStr?: string;
}): string {
  const { clubName, debts, simplifiedDrinkingDebts, treasurer, appUrl, todayStr } = params;
  const lines: string[] = [];
  lines.push(`📢 [${clubName}] TỔNG HỢP CÔNG NỢ CẦN CHUYỂN`);

  const monthlyDues = debts?.badminton.monthlyDues || [];
  const adhocDues = debts?.badminton.adhocDues || [];
  const guestDues = debts?.badminton.guestDues || [];

  if (monthlyDues.length > 0 || adhocDues.length > 0 || guestDues.length > 0) {
    lines.push('');
    lines.push('🏸 TIỀN CẦU LÔNG:');
    for (const d of monthlyDues) {
      const ov = getOverdueInfo(d.issued_at || `${d.month}-01`, todayStr);
      const ovTag = ov.severity !== 'NONE' ? ` ${ov.emoji} [${ov.label}]` : '';
      lines.push(
        `- ${d.member_name} -> ${treasurer?.name || 'Thủ quỹ'}: ${formatVND(d.amount)} (Cầu T${d.month.slice(5, 7)})${ovTag}`
      );
    }
    for (const a of adhocDues) {
      const ov = getOverdueInfo(a.session_date, todayStr);
      const ovTag = ov.severity !== 'NONE' ? ` ${ov.emoji} [${ov.label}]` : '';
      lines.push(
        `- ${a.member_name} -> ${a.creditor_name}: ${formatVND(a.amount)} (Phát sinh ${formatShortDateVN(a.session_date)})${ovTag}`
      );
    }
    for (const g of guestDues) {
      const ov = getOverdueInfo(g.session_date, todayStr);
      const ovTag = ov.severity !== 'NONE' ? ` ${ov.emoji} [${ov.label}]` : '';
      lines.push(
        `- ${g.member_name} (VL) -> ${treasurer?.name || 'Thủ quỹ'}: ${formatVND(g.amount)} (${formatShortDateVN(g.session_date)})${ovTag}`
      );
    }
  }

  if (simplifiedDrinkingDebts.transfers.length > 0) {
    lines.push('');
    lines.push('🍻 TIỀN ĂN NHẬU:');
    for (const tr of simplifiedDrinkingDebts.transfers) {
      const oldestDate = tr.breakdownSessions[0]?.sessionDate || '';
      const ov = oldestDate ? getOverdueInfo(oldestDate, todayStr) : { severity: 'NONE' as const, emoji: '', label: '' };
      const ovTag = ov.severity !== 'NONE' ? ` ${ov.emoji} [${ov.label}]` : '';
      const sessionSummary =
        tr.breakdownSessions.length === 1
          ? `${formatShortDateVN(tr.breakdownSessions[0].sessionDate)} - ${tr.breakdownSessions[0].sessionTitle}`
          : `${tr.breakdownSessions.length} buổi`;
      lines.push(
        `- ${tr.fromMember.name} -> ${tr.toMember.name}: ${formatVND(tr.amount)} (${sessionSummary})${ovTag}`
      );
    }
  }

  if (
    monthlyDues.length === 0 &&
    adhocDues.length === 0 &&
    guestDues.length === 0 &&
    simplifiedDrinkingDebts.transfers.length === 0
  ) {
    lines.push('🎉 Hiện tại cả CLB đã thanh toán sạch nợ!');
  }

  if (appUrl) {
    lines.push('');
    lines.push(`🔗 Mở app xem VietQR từng người: ${appUrl}`);
  }
  return lines.join('\n');
}
