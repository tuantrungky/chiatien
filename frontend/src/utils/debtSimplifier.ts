/**
 * debtSimplifier.ts
 * Thuật toán tối ưu hóa chuyển khoản CHỈ DÀNH CHO NHÓM ĂN NHẬU (DRINKING).
 * - Tiền Cầu lông (BADMINTON) tách biệt hoàn toàn: MAIN & GUEST đều chuyển thẳng Thủ quỹ,
 *   không bao giờ cấn trừ chéo với tiền Ăn nhậu hay tạo nợ chéo giữa các MAIN.
 */

import type {
  Attendance,
  BadmintonAdhocDueItem,
  BadmintonDuesData,
  BadmintonGuestDueItem,
  BadmintonMonthlyDueItem,
  DebtBreakdownSession,
  Member,
  MonthlyDue,
  NetBalanceItem,
  Session,
  Settlement,
  SimplifiedDebtResult,
  SimplifiedTransferDetail,
} from '../types';
import { buildTransferContent, buildVietQrUrl } from './vietqr';

export interface SimplifyDrinkingDebtsInput {
  attendances: Attendance[];
  sessions: Session[];
  members: Member[];
  unreconciledSettlements?: Settlement[];
  transferPrefix?: string;
  vietqrTemplate?: string;
}

function createPlaceholderMember(memberId: string): Member {
  return {
    member_id: memberId,
    name: memberId,
    aliases: '',
    type: 'MAIN',
    phone: '',
    bank_bin: '',
    bank_name: '',
    account_no: '',
    account_name: '',
    is_active: true,
    created_at: '',
    updated_at: '',
  };
}

/**
 * Tối ưu hóa chuyển khoản riêng cho các buổi Ăn nhậu (DRINKING):
 * - Dùng `net_amount` (Phần chia - Đã góp). Nếu dữ liệu cũ chưa có `net_amount` (0) nhưng
 *   `fee_amount > 0` và `creditor_id`, tự suy ra nợ theo mô hình cũ để tương thích ngược.
 * - Tuyệt đối bỏ qua mọi Attendance của BADMINTON.
 */
export function simplifyDebts(input: SimplifyDrinkingDebtsInput): SimplifiedDebtResult {
  const {
    attendances,
    sessions,
    members,
    unreconciledSettlements = [],
    transferPrefix = 'CLN',
    vietqrTemplate = 'compact2',
  } = input;

  const membersMap = new Map<string, Member>();
  for (const m of members) membersMap.set(m.member_id, m);

  const sessionsMap = new Map<string, Session>();
  for (const s of sessions) sessionsMap.set(s.session_id, s);

  const netMap = new Map<string, number>();
  const breakdownByDebtor = new Map<string, DebtBreakdownSession[]>();

  const addBalance = (memberId: string, delta: number) => {
    if (!memberId) return;
    netMap.set(memberId, (netMap.get(memberId) || 0) + delta);
  };

  // Nhóm các dòng Attendance DRINKING chưa thanh toán theo buổi
  // Chú ý quy ước dấu:
  // - Trong Attendance.net_amount: > 0 là người đó phải TRẢ thêm, < 0 là người đó được NHẬN lại
  // - Trong đồ thị netMap (chuẩn tài khoản): < 0 là CON NỢ (phải chuyển), > 0 là CHỦ NỢ (được nhận)
  for (const att of attendances) {
    if (att.session_type !== 'DRINKING' || att.is_paid) continue;

    const session = sessionsMap.get(att.session_id);
    const mId = String(att.member_id || '').trim();
    if (!mId) continue;

    const rawNet = Math.round(Number(att.net_amount) || 0);
    if (rawNet !== 0) {
      // net_amount > 0 => con nợ => netMap giảm (-rawNet)
      // net_amount < 0 => chủ nợ => netMap tăng (-rawNet > 0)
      addBalance(mId, -rawNet);

      if (rawNet > 0) {
        if (!breakdownByDebtor.has(mId)) breakdownByDebtor.set(mId, []);
        breakdownByDebtor.get(mId)!.push({
          attendanceId: att.attendance_id,
          sessionId: att.session_id,
          sessionDate: att.session_date || session?.date || '',
          sessionTitle: session?.title || 'Ăn nhậu',
          sessionType: 'DRINKING',
          amount: rawNet,
          contributedAmount: Math.round(Number(att.contributed_amount) || 0),
          perPersonAmount: Math.round(Number(att.fee_amount) || 0),
        });
      }
      continue;
    }

    // Tương thích ngược nếu row Attendance cũ chỉ có fee_amount + creditor_id
    const fee = Math.round(Number(att.fee_amount) || 0);
    const creditorId = String(att.creditor_id || session?.payer_id || '').trim();
    if (fee > 0 && creditorId && creditorId !== mId) {
      addBalance(mId, -fee);
      addBalance(creditorId, fee);

      if (!breakdownByDebtor.has(mId)) breakdownByDebtor.set(mId, []);
      breakdownByDebtor.get(mId)!.push({
        attendanceId: att.attendance_id,
        sessionId: att.session_id,
        sessionDate: att.session_date || session?.date || '',
        sessionTitle: session?.title || 'Ăn nhậu',
        sessionType: 'DRINKING',
        amount: fee,
        contributedAmount: 0,
        perPersonAmount: fee,
      });
    }
  }

  // Cấn trừ các giao dịch DRINKING đã chuyển trước một phần (is_reconciled === false)
  for (const st of unreconciledSettlements) {
    if (st.is_reconciled) continue;
    if (st.category && st.category !== 'DRINKING') continue;
    const amount = Math.round(Number(st.amount) || 0);
    const fromId = String(st.from_member_id || '').trim();
    const toId = String(st.to_member_id || '').trim();
    if (amount <= 0 || !fromId || !toId || fromId === toId) continue;

    addBalance(fromId, amount);
    addBalance(toId, -amount);
  }

  const netBalances: NetBalanceItem[] = [];
  const debtors: Array<{ memberId: string; amount: number }> = [];
  const creditors: Array<{ memberId: string; amount: number }> = [];

  for (const [memberId, rawBal] of netMap.entries()) {
    const balance = Math.round(rawBal);
    if (balance === 0) continue;

    const member = membersMap.get(memberId) || createPlaceholderMember(memberId);
    netBalances.push({ memberId, name: member.name, balance });

    if (balance < 0) {
      debtors.push({ memberId, amount: -balance });
    } else {
      creditors.push({ memberId, amount: balance });
    }
  }

  debtors.sort((a, b) => (b.amount !== a.amount ? b.amount - a.amount : a.memberId.localeCompare(b.memberId)));
  creditors.sort((a, b) => (b.amount !== a.amount ? b.amount - a.amount : a.memberId.localeCompare(b.memberId)));
  netBalances.sort((a, b) => a.balance - b.balance);

  const transfers: SimplifiedTransferDetail[] = [];
  let i = 0;
  let j = 0;
  let totalOutstanding = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const transferAmount = Math.min(debtor.amount, creditor.amount);

    if (transferAmount > 0) {
      const fromMember = membersMap.get(debtor.memberId) || createPlaceholderMember(debtor.memberId);
      const toMember = membersMap.get(creditor.memberId) || createPlaceholderMember(creditor.memberId);
      const transferContent = buildTransferContent(transferPrefix, fromMember.name, toMember.name);
      const vietQrUrl = buildVietQrUrl({
        bankBin: toMember.bank_bin,
        accountNo: toMember.account_no,
        accountName: toMember.account_name || toMember.name,
        amount: transferAmount,
        addInfo: transferContent,
        template: vietqrTemplate,
      });

      const rawBreakdowns = breakdownByDebtor.get(debtor.memberId) || [];
      const breakdownSessions = [...rawBreakdowns].sort((a, b) =>
        a.sessionDate.localeCompare(b.sessionDate)
      );

      transfers.push({
        fromMember,
        toMember,
        amount: transferAmount,
        transferContent,
        vietQrUrl,
        breakdownSessions,
      });
      totalOutstanding += transferAmount;
    }

    debtor.amount -= transferAmount;
    creditor.amount -= transferAmount;
    if (debtor.amount === 0) i++;
    if (creditor.amount === 0) j++;
  }

  return {
    netBalances,
    transfers,
    totalOutstanding,
  };
}

/**
 * Xây dựng danh sách công nợ Cầu lông tách biệt (luôn chuyển thẳng Thủ quỹ,
 * gồm hóa đơn tháng của MAIN và phí theo buổi của GUEST).
 */
export function buildBadmintonDues(params: {
  monthlyDues: MonthlyDue[];
  attendances: Attendance[];
  sessions: Session[];
  members: Member[];
  treasurerMemberId: string;
  transferPrefix?: string;
  vietqrTemplate?: string;
}): BadmintonDuesData {
  const {
    monthlyDues,
    attendances,
    sessions,
    members,
    treasurerMemberId,
    transferPrefix = 'CKCL',
    vietqrTemplate = 'compact2',
  } = params;

  const membersMap = new Map<string, Member>();
  for (const m of members) membersMap.set(m.member_id, m);

  const sessionsMap = new Map<string, Session>();
  for (const s of sessions) sessionsMap.set(s.session_id, s);

  const treasurer = membersMap.get(treasurerMemberId);
  const treasurerBank =
    treasurer && treasurer.bank_bin && treasurer.account_no
      ? {
          bankBin: treasurer.bank_bin,
          bankName: treasurer.bank_name,
          accountNo: treasurer.account_no,
          accountName: treasurer.account_name || treasurer.name,
        }
      : null;

  const monthlyItems: BadmintonMonthlyDueItem[] = monthlyDues
    .filter((d) => !d.is_paid && d.amount > 0)
    .map((d) => {
      const mName = membersMap.get(d.member_id)?.name || d.member_name || d.member_id;
      const content = buildTransferContent(
        transferPrefix,
        mName,
        `${treasurer?.name || 'Thu quy'} cau T${d.month.slice(5, 7)}`
      );
      return {
        due_id: d.due_id,
        month: d.month,
        member_id: d.member_id,
        member_name: mName,
        amount: d.amount,
        base_amount: d.base_amount ?? d.amount,
        credit_amount: d.credit_amount ?? 0,
        credit_note: d.credit_note || '',
        is_paid: d.is_paid,
        paid_at: d.paid_at,
        transferContent: content,
        vietQrUrl: treasurer
          ? buildVietQrUrl({
              bankBin: treasurer.bank_bin,
              accountNo: treasurer.account_no,
              accountName: treasurer.account_name || treasurer.name,
              amount: d.amount,
              addInfo: content,
              template: vietqrTemplate,
            })
          : null,
      };
    });

  const guestItems: BadmintonGuestDueItem[] = [];
  const adhocItems: BadmintonAdhocDueItem[] = [];

  for (const a of attendances) {
    if (a.session_type !== 'BADMINTON' || a.is_paid || a.fee_amount <= 0) continue;
    const s = sessionsMap.get(a.session_id);
    const mName = membersMap.get(a.member_id)?.name || a.member_name || a.member_id;
    const isAdhoc = s?.billing_mode === 'AD_HOC';

    if (isAdhoc) {
      const creditorId = a.creditor_id || s?.payer_id || treasurerMemberId;
      const creditor = membersMap.get(creditorId) || treasurer;
      const creditorBank =
        creditor && creditor.bank_bin && creditor.account_no
          ? {
              bankBin: creditor.bank_bin,
              bankName: creditor.bank_name,
              accountNo: creditor.account_no,
              accountName: creditor.account_name || creditor.name,
            }
          : null;
      const content = buildTransferContent(
        transferPrefix,
        mName,
        `${creditor?.name || 'Nguoi ung'} cau ps ${a.session_date.slice(8, 10)}/${a.session_date.slice(5, 7)}`
      );
      adhocItems.push({
        attendance_id: a.attendance_id,
        session_id: a.session_id,
        session_date: a.session_date,
        session_title: s?.title || 'Cầu lông phát sinh',
        member_id: a.member_id,
        member_name: mName,
        member_type_snapshot: a.member_type_snapshot,
        creditor_id: creditorId,
        creditor_name: creditor?.name || creditorId,
        creditorBank,
        amount: a.fee_amount,
        transferContent: content,
        vietQrUrl: creditor
          ? buildVietQrUrl({
              bankBin: creditor.bank_bin,
              accountNo: creditor.account_no,
              accountName: creditor.account_name || creditor.name,
              amount: a.fee_amount,
              addInfo: content,
              template: vietqrTemplate,
            })
          : null,
      });
      continue;
    }

    if (a.member_type_snapshot !== 'GUEST') continue;
    const content = buildTransferContent(
      transferPrefix,
      mName,
      `${treasurer?.name || 'Thu quy'} san ${a.session_date.slice(8, 10)}/${a.session_date.slice(5, 7)}`
    );
    guestItems.push({
      attendance_id: a.attendance_id,
      session_id: a.session_id,
      session_date: a.session_date,
      session_title: s?.title || 'Cầu lông',
      member_id: a.member_id,
      member_name: mName,
      amount: a.fee_amount,
      transferContent: content,
      vietQrUrl: treasurer
        ? buildVietQrUrl({
            bankBin: treasurer.bank_bin,
            accountNo: treasurer.account_no,
            accountName: treasurer.account_name || treasurer.name,
            amount: a.fee_amount,
            addInfo: content,
            template: vietqrTemplate,
          })
        : null,
    });
  }

  const totalMonthlyUnpaid = monthlyItems.reduce((sum, x) => sum + x.amount, 0);
  const totalGuestUnpaid = guestItems.reduce((sum, x) => sum + x.amount, 0);
  const totalAdhocUnpaid = adhocItems.reduce((sum, x) => sum + x.amount, 0);

  return {
    treasurerMemberId,
    treasurerBank,
    monthlyDues: monthlyItems,
    guestDues: guestItems,
    adhocDues: adhocItems,
    totalMonthlyUnpaid,
    totalGuestUnpaid,
    totalAdhocUnpaid,
    totalOutstanding: totalMonthlyUnpaid + totalGuestUnpaid + totalAdhocUnpaid,
  };
}
