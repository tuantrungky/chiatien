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
  const breakdownByEdge = new Map<string, DebtBreakdownSession[]>();
  const edgeMap = new Map<string, Map<string, number>>();
  const drinkingAttsBySession = new Map<string, Attendance[]>();

  const addBalance = (memberId: string, delta: number) => {
    if (!memberId) return;
    netMap.set(memberId, (netMap.get(memberId) || 0) + delta);
  };

  const getEdge = (fromId: string, toId: string): number =>
    edgeMap.get(fromId)?.get(toId) || 0;

  const setEdge = (fromId: string, toId: string, val: number) => {
    const rounded = Math.round(val);
    if (rounded <= 0) {
      const m = edgeMap.get(fromId);
      if (m) {
        m.delete(toId);
        if (m.size === 0) edgeMap.delete(fromId);
      }
      breakdownByEdge.delete(`${fromId}|${toId}`);
      return;
    }
    if (!edgeMap.has(fromId)) edgeMap.set(fromId, new Map());
    edgeMap.get(fromId)!.set(toId, rounded);
  };

  const addEdge = (fromId: string, toId: string, delta: number) => {
    if (!fromId || !toId || fromId === toId || delta <= 0) return;
    setEdge(fromId, toId, getEdge(fromId, toId) + delta);
  };

  const addEdgeBreakdown = (fromId: string, toId: string, item: DebtBreakdownSession) => {
    const key = `${fromId}|${toId}`;
    const list = breakdownByEdge.get(key) || [];
    if (!list.some((x) => x.attendanceId === item.attendanceId && x.sessionId === item.sessionId)) {
      list.push(item);
      breakdownByEdge.set(key, list);
    }
  };

  const mergeEdgeBreakdown = (srcFrom: string, srcTo: string, dstFrom: string, dstTo: string) => {
    const items = breakdownByEdge.get(`${srcFrom}|${srcTo}`);
    if (!items) return;
    for (const item of items) addEdgeBreakdown(dstFrom, dstTo, item);
  };

  const cancelOpposites = () => {
    const pairs: Array<[string, string]> = [];
    for (const [u, targets] of edgeMap.entries()) {
      for (const v of targets.keys()) {
        if (u < v && getEdge(v, u) > 0) pairs.push([u, v]);
      }
    }
    for (const [u, v] of pairs) {
      const wUV = getEdge(u, v);
      const wVU = getEdge(v, u);
      const m = Math.min(wUV, wVU);
      if (m > 0) {
        setEdge(u, v, wUV - m);
        setEdge(v, u, wVU - m);
      }
    }
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

    if (!drinkingAttsBySession.has(att.session_id)) {
      drinkingAttsBySession.set(att.session_id, []);
    }
    drinkingAttsBySession.get(att.session_id)!.push(att);

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
          payerName:
            membersMap.get(String(session?.payer_id || '').trim())?.name ||
            session?.payer_name ||
            undefined,
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
        payerName: membersMap.get(creditorId)?.name || session?.payer_name || undefined,
      });
    }
  }

  // Bước 1: Ghép trực tiếp con nợ -> chủ nợ TRONG CÙNG TỪNG BUỔI NHẬU
  const residualDebtors: Array<{ att: Attendance; mId: string; session?: Session; remaining: number }> = [];
  const residualCreditors: Array<{ mId: string; session?: Session; remaining: number }> = [];

  for (const [sessionId, sessAtts] of drinkingAttsBySession.entries()) {
    const session = sessionsMap.get(sessionId);
    const sDebtors: Array<{ att: Attendance; mId: string; remaining: number; rawNet: number }> = [];
    const sCreditors: Array<{ mId: string; remaining: number }> = [];

    for (const att of sessAtts) {
      const mId = String(att.member_id || '').trim();
      if (!mId) continue;
      const rawNet = Math.round(Number(att.net_amount) || 0);
      if (rawNet > 0) {
        sDebtors.push({ att, mId, remaining: rawNet, rawNet });
      } else if (rawNet < 0) {
        sCreditors.push({ mId, remaining: -rawNet });
      } else {
        const fee = Math.round(Number(att.fee_amount) || 0);
        const creditorId = String(att.creditor_id || session?.payer_id || '').trim();
        if (fee > 0 && creditorId && creditorId !== mId) {
          addEdge(mId, creditorId, fee);
          addEdgeBreakdown(mId, creditorId, {
            attendanceId: att.attendance_id,
            sessionId,
            sessionDate: att.session_date || session?.date || '',
            sessionTitle: session?.title || 'Ăn nhậu',
            sessionType: 'DRINKING',
            amount: fee,
            contributedAmount: 0,
            perPersonAmount: fee,
            payerName: membersMap.get(creditorId)?.name || session?.payer_name || creditorId,
          });
        }
      }
    }

    sDebtors.sort((a, b) => (b.remaining !== a.remaining ? b.remaining - a.remaining : a.mId.localeCompare(b.mId)));
    sCreditors.sort((a, b) => (b.remaining !== a.remaining ? b.remaining - a.remaining : a.mId.localeCompare(b.mId)));

    let di = 0;
    let ci = 0;
    while (di < sDebtors.length && ci < sCreditors.length) {
      const d = sDebtors[di];
      const c = sCreditors[ci];
      const matchAmt = Math.min(d.remaining, c.remaining);
      if (matchAmt > 0) {
        addEdge(d.mId, c.mId, matchAmt);
        const payerName =
          membersMap.get(c.mId)?.name ||
          session?.payer_name ||
          membersMap.get(String(session?.payer_id || '').trim())?.name ||
          c.mId;
        addEdgeBreakdown(d.mId, c.mId, {
          attendanceId: d.att.attendance_id,
          sessionId,
          sessionDate: d.att.session_date || session?.date || '',
          sessionTitle: session?.title || 'Ăn nhậu',
          sessionType: 'DRINKING',
          amount: d.rawNet,
          contributedAmount: Math.round(Number(d.att.contributed_amount) || 0),
          perPersonAmount: Math.round(Number(d.att.fee_amount) || 0),
          payerName,
        });
        d.remaining -= matchAmt;
        c.remaining -= matchAmt;
      }
      if (d.remaining === 0) di++;
      if (c.remaining === 0) ci++;
    }

    for (const d of sDebtors) {
      if (d.remaining > 0) residualDebtors.push({ att: d.att, mId: d.mId, session, remaining: d.remaining });
    }
    for (const c of sCreditors) {
      if (c.remaining > 0) residualCreditors.push({ mId: c.mId, session, remaining: c.remaining });
    }
  }

  // Ghép phần dư (nếu có buổi bị lệch sổ do gạch nợ từng phần / làm tròn)
  if (residualDebtors.length > 0 && residualCreditors.length > 0) {
    residualDebtors.sort((a, b) => (b.remaining !== a.remaining ? b.remaining - a.remaining : a.mId.localeCompare(b.mId)));
    residualCreditors.sort((a, b) => (b.remaining !== a.remaining ? b.remaining - a.remaining : a.mId.localeCompare(b.mId)));
    let rdi = 0;
    let rci = 0;
    while (rdi < residualDebtors.length && rci < residualCreditors.length) {
      const rd = residualDebtors[rdi];
      const rc = residualCreditors[rci];
      const mAmt = Math.min(rd.remaining, rc.remaining);
      if (mAmt > 0) {
        addEdge(rd.mId, rc.mId, mAmt);
        addEdgeBreakdown(rd.mId, rc.mId, {
          attendanceId: rd.att.attendance_id,
          sessionId: rd.att.session_id,
          sessionDate: rd.att.session_date || rd.session?.date || '',
          sessionTitle: rd.session?.title || 'Ăn nhậu',
          sessionType: 'DRINKING',
          amount: Math.round(Number(rd.att.net_amount) || 0),
          contributedAmount: Math.round(Number(rd.att.contributed_amount) || 0),
          perPersonAmount: Math.round(Number(rd.att.fee_amount) || 0),
          payerName: membersMap.get(rc.mId)?.name || rd.session?.payer_name || rc.mId,
        });
        rd.remaining -= mAmt;
        rc.remaining -= mAmt;
      }
      if (rd.remaining === 0) rdi++;
      if (rc.remaining === 0) rci++;
    }
  }

  // Bước 2: Cấn trừ các giao dịch DRINKING đã chuyển trước một phần (is_reconciled === false)
  for (const st of unreconciledSettlements) {
    if (st.is_reconciled) continue;
    if (st.category && st.category !== 'DRINKING') continue;
    const amount = Math.round(Number(st.amount) || 0);
    const fromId = String(st.from_member_id || '').trim();
    const toId = String(st.to_member_id || '').trim();
    if (amount <= 0 || !fromId || !toId || fromId === toId) continue;

    addBalance(fromId, amount);
    addBalance(toId, -amount);

    const existingForward = getEdge(fromId, toId);
    if (existingForward >= amount) {
      setEdge(fromId, toId, existingForward - amount);
    } else {
      if (existingForward > 0) setEdge(fromId, toId, 0);
      addEdge(toId, fromId, amount - existingForward);
    }
  }

  cancelOpposites();

  // Bước 3: Rút gọn dây chuyền bắc cầu A -> B -> C CHỈ khi B vừa nợ vừa được nhận (in > 0 && out > 0)
  for (let iter = 0; iter < 500; iter++) {
    const outNodes = Array.from(edgeMap.keys()).sort();
    let reduced = false;

    for (const bNode of outNodes) {
      const outEdges = edgeMap.get(bNode);
      if (!outEdges || outEdges.size === 0) continue;

      const incomingFromA: Array<{ aNode: string; amount: number }> = [];
      for (const [u, targets] of edgeMap.entries()) {
        const w = targets.get(bNode) || 0;
        if (u !== bNode && w > 0) incomingFromA.push({ aNode: u, amount: w });
      }
      if (incomingFromA.length === 0) continue;

      const outgoingToC = Array.from(outEdges.entries())
        .map(([cNode, amount]) => ({ cNode, amount }))
        .filter((x) => x.cNode !== bNode && x.amount > 0);
      if (outgoingToC.length === 0) continue;

      incomingFromA.sort((x, y) => (y.amount !== x.amount ? y.amount - x.amount : x.aNode.localeCompare(y.aNode)));
      outgoingToC.sort((x, y) => (y.amount !== x.amount ? y.amount - x.amount : x.cNode.localeCompare(y.cNode)));

      // Ưu tiên ghép cặp (A, C) đã có cạnh hoặc bằng số tiền
      let chosenA = incomingFromA[0];
      let chosenC = outgoingToC[0];
      let foundPreferred = false;
      for (const inc of incomingFromA) {
        for (const out of outgoingToC) {
          if (inc.aNode === out.cNode || getEdge(inc.aNode, out.cNode) > 0 || inc.amount === out.amount) {
            chosenA = inc;
            chosenC = out;
            foundPreferred = true;
            break;
          }
        }
        if (foundPreferred) break;
      }

      const m = Math.min(chosenA.amount, chosenC.amount);
      setEdge(chosenA.aNode, bNode, chosenA.amount - m);
      setEdge(bNode, chosenC.cNode, chosenC.amount - m);
      if (chosenA.aNode !== chosenC.cNode) {
        addEdge(chosenA.aNode, chosenC.cNode, m);
        mergeEdgeBreakdown(chosenA.aNode, bNode, chosenA.aNode, chosenC.cNode);
        mergeEdgeBreakdown(bNode, chosenC.cNode, chosenA.aNode, chosenC.cNode);
      }
      cancelOpposites();
      reduced = true;
      break;
    }

    if (!reduced) break;
  }

  const netBalances: NetBalanceItem[] = [];
  let totalDebtors = 0;
  let totalCreditors = 0;

  for (const [memberId, rawBal] of netMap.entries()) {
    const balance = Math.round(rawBal);
    if (balance === 0) continue;

    const member = membersMap.get(memberId) || createPlaceholderMember(memberId);
    netBalances.push({ memberId, name: member.name, balance });

    if (balance < 0) {
      totalDebtors += -balance;
    } else {
      totalCreditors += balance;
    }
  }

  const imbalanceAmount = totalCreditors - totalDebtors;
  netBalances.sort((a, b) => a.balance - b.balance);

  const rawEdges: Array<{ fromId: string; toId: string; amount: number }> = [];
  for (const [fromId, targets] of edgeMap.entries()) {
    for (const [toId, amount] of targets.entries()) {
      if (amount > 0) rawEdges.push({ fromId, toId, amount });
    }
  }
  rawEdges.sort((a, b) =>
    b.amount !== a.amount
      ? b.amount - a.amount
      : a.fromId !== b.fromId
      ? a.fromId.localeCompare(b.fromId)
      : a.toId.localeCompare(b.toId)
  );

  const transfers: SimplifiedTransferDetail[] = [];
  let totalOutstanding = 0;

  for (const edge of rawEdges) {
    const fromMember = membersMap.get(edge.fromId) || createPlaceholderMember(edge.fromId);
    const toMember = membersMap.get(edge.toId) || createPlaceholderMember(edge.toId);
    const transferContent = buildTransferContent(transferPrefix, fromMember.name, toMember.name);
    const vietQrUrl = buildVietQrUrl({
      bankBin: toMember.bank_bin,
      accountNo: toMember.account_no,
      accountName: toMember.account_name || toMember.name,
      amount: edge.amount,
      addInfo: transferContent,
      template: vietqrTemplate,
    });

    const edgeBreakdowns = breakdownByEdge.get(`${edge.fromId}|${edge.toId}`);
    const fallbackBreakdowns = breakdownByDebtor.get(edge.fromId) || [];
    const breakdownSessions = [...(edgeBreakdowns && edgeBreakdowns.length > 0 ? edgeBreakdowns : fallbackBreakdowns)].sort(
      (a, b) => a.sessionDate.localeCompare(b.sessionDate)
    );

    transfers.push({
      fromMember,
      toMember,
      amount: edge.amount,
      transferContent,
      vietQrUrl,
      breakdownSessions,
    });
    totalOutstanding += edge.amount;
  }

  const transferCountByDebtor = new Map<string, number>();
  for (const tr of transfers) {
    transferCountByDebtor.set(
      tr.fromMember.member_id,
      (transferCountByDebtor.get(tr.fromMember.member_id) || 0) + 1
    );
  }
  for (const tr of transfers) {
    if ((transferCountByDebtor.get(tr.fromMember.member_id) || 0) > 1) {
      tr.isSplitFromMultipleTransfers = true;
    }
  }

  return {
    netBalances,
    transfers,
    totalOutstanding,
    imbalanceAmount,
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
