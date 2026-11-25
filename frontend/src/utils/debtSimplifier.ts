/**
 * debtSimplifier.ts
 * Thuật toán tối ưu hóa số lần chuyển khoản (Greedy Debt Simplification).
 * - Cộng dồn toàn bộ các khoản chưa thanh toán (is_paid = false) theo thời gian
 * - Hỗ trợ hoàn ứng tiền sân/cầu/nước chưa trả từ Fund_Ledger (gắn về Thủ quỹ)
 * - Hỗ trợ các giao dịch đã trả một phần (Settlements với is_reconciled = false)
 * - Cấn trừ nợ vòng tròn (A -> B -> C thành A -> C)
 */

import type {
  Attendance,
  DebtBreakdownSession,
  FundLedgerEntry,
  Member,
  NetBalanceItem,
  Session,
  Settlement,
  SimplifiedDebtResult,
  SimplifiedTransferDetail,
} from '../types';
import { buildTransferContent, buildVietQrUrl } from './vietqr';

export interface SimplifyDebtsInput {
  attendances: Attendance[];
  sessions: Session[];
  members: Member[];
  treasurerMemberId?: string;
  unpaidReimbursements?: FundLedgerEntry[];
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
 * Tính số dư ròng (Net Balance) và chạy thuật toán tham lam (Greedy)
 * ghép người nợ nhiều nhất với người được nhận nhiều nhất để tối thiểu hóa giao dịch.
 */
export function simplifyDebts(input: SimplifyDebtsInput): SimplifiedDebtResult {
  const {
    attendances,
    sessions,
    members,
    treasurerMemberId = '',
    unpaidReimbursements = [],
    unreconciledSettlements = [],
    transferPrefix = 'CLN',
    vietqrTemplate = 'compact2',
  } = input;

  const membersMap = new Map<string, Member>();
  for (const m of members) {
    membersMap.set(m.member_id, m);
  }

  const sessionsMap = new Map<string, Session>();
  for (const s of sessions) {
    sessionsMap.set(s.session_id, s);
  }

  const netMap = new Map<string, number>();
  const breakdownByDebtor = new Map<string, DebtBreakdownSession[]>();

  const addBalance = (memberId: string, delta: number) => {
    if (!memberId) return;
    netMap.set(memberId, (netMap.get(memberId) || 0) + delta);
  };

  const pushBreakdown = (memberId: string, item: DebtBreakdownSession) => {
    if (!breakdownByDebtor.has(memberId)) {
      breakdownByDebtor.set(memberId, []);
    }
    breakdownByDebtor.get(memberId)!.push(item);
  };

  // 1. Cộng dồn mọi khoản Attendance chưa thanh toán (is_paid === false)
  for (const att of attendances) {
    if (att.is_paid) continue;
    const fee = Math.round(Number(att.fee_amount) || 0);
    if (fee <= 0) continue;

    const session = sessionsMap.get(att.session_id);
    const creditorId = String(
      att.creditor_id || session?.payer_id || treasurerMemberId || ''
    ).trim();
    const debtorId = String(att.member_id || '').trim();

    if (!debtorId || !creditorId || debtorId === creditorId) continue;

    addBalance(debtorId, -fee);
    addBalance(creditorId, fee);

    const creditorName = membersMap.get(creditorId)?.name || att.creditor_name || creditorId;
    pushBreakdown(debtorId, {
      attendanceId: att.attendance_id,
      sessionId: att.session_id,
      sessionDate: att.session_date || session?.date || '',
      sessionTitle: session?.title || (att.session_type === 'BADMINTON' ? 'Cầu lông' : 'Ăn nhậu'),
      sessionType: att.session_type,
      amount: fee,
      originalCreditorId: creditorId,
      originalCreditorName: creditorName,
    });
  }

  // 2. Cộng dồn các khoản chi phí quỹ do thành viên ứng tiền chưa hoàn trả (gắn về Thủ quỹ)
  for (const entry of unpaidReimbursements) {
    if (entry.type !== 'EXPENSE' || entry.is_paid) continue;
    const amount = Math.round(Number(entry.amount) || 0);
    const memberId = String(entry.member_id || '').trim();
    if (amount <= 0 || !memberId || !treasurerMemberId || memberId === treasurerMemberId) {
      continue;
    }

    addBalance(treasurerMemberId, -amount);
    addBalance(memberId, amount);

    const creditorName = membersMap.get(memberId)?.name || entry.member_name || memberId;
    pushBreakdown(treasurerMemberId, {
      ledgerId: entry.ledger_id,
      sessionId: entry.session_id || undefined,
      sessionDate: entry.date,
      sessionTitle: entry.description || 'Chi hộ quỹ CLB',
      sessionType: 'REIMBURSEMENT',
      amount,
      originalCreditorId: memberId,
      originalCreditorName: creditorName,
    });
  }

  // 3. Cấn trừ các giao dịch thanh toán một phần chưa đối soát xong (is_reconciled === false)
  for (const st of unreconciledSettlements) {
    if (st.is_reconciled) continue;
    const amount = Math.round(Number(st.amount) || 0);
    const fromId = String(st.from_member_id || '').trim();
    const toId = String(st.to_member_id || '').trim();
    if (amount <= 0 || !fromId || !toId || fromId === toId) continue;

    addBalance(fromId, amount);
    addBalance(toId, -amount);
  }

  // 4. Tách danh sách Debtors (< 0) và Creditors (> 0)
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

  // Sắp xếp giảm dần theo trị tuyệt đối (tie-break theo memberId để kết quả deterministic)
  debtors.sort((a, b) => (b.amount !== a.amount ? b.amount - a.amount : a.memberId.localeCompare(b.memberId)));
  creditors.sort((a, b) => (b.amount !== a.amount ? b.amount - a.amount : a.memberId.localeCompare(b.memberId)));
  netBalances.sort((a, b) => a.balance - b.balance);

  // 5. Greedy Matching: ghép người nợ nhiều nhất với người được nhận nhiều nhất
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
