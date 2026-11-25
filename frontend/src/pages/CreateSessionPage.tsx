import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Receipt,
  Save,
  Search,
  Sparkles,
  Trophy,
  UserPlus,
  Utensils,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  createSession,
  fetchSessionDetail,
  parseBillAI,
  parseVoiceAttendanceAI,
  updateSession,
} from '../services/api';
import type { Member, Session, SessionType, SettingsMap } from '../types';
import { compressImageToBase64 } from '../utils/imageCompress';
import { getTodayDateStr } from '../utils/dateFilters';
import { formatVND } from '../utils/vietqr';

interface CreateSessionPageProps {
  members: Member[];
  settings: SettingsMap;
  editingSession: Session | null;
  onCancelEdit: () => void;
  onSaved: () => Promise<void>;
}

interface DetectedGuestItem {
  name: string;
  selected: boolean;
  paidImmediately: boolean;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function CreateSessionPage({
  members,
  settings,
  editingSession,
  onCancelEdit,
  onSaved,
}: CreateSessionPageProps) {
  const { idToken, handleApiError } = useAuth();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const activeMembers = useMemo(() => members.filter((m) => m.is_active), [members]);
  const defaultTreasurerId = settings.treasurer_member_id || activeMembers[0]?.member_id || '';

  const [sessionType, setSessionType] = useState<SessionType>(editingSession?.type || 'BADMINTON');
  const [date, setDate] = useState<string>(editingSession?.date || getTodayDateStr());
  const [title, setTitle] = useState<string>(editingSession?.title || '');
  const [totalAmountStr, setTotalAmountStr] = useState<string>(
    editingSession ? String(editingSession.total_amount) : '0'
  );
  const [guestFeeStr, setGuestFeeStr] = useState<string>(
    String(editingSession?.guest_fee || settings.guest_fee || 50000)
  );
  const [payerId, setPayerId] = useState<string>(editingSession?.payer_id || defaultTreasurerId);
  const [receiptDriveId, setReceiptDriveId] = useState<string>(editingSession?.receipt_drive_id || '');
  const [receiptUrl, setReceiptUrl] = useState<string>(editingSession?.receipt_url || '');
  const [receiptSummary, setReceiptSummary] = useState<string>(editingSession?.receipt_summary || '');
  const [note, setNote] = useState<string>(editingSession?.note || '');

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [paidImmediatelyIds, setPaidImmediatelyIds] = useState<string[]>([]);
  const [detectedGuests, setDetectedGuests] = useState<DetectedGuestItem[]>([]);
  const [quickGuestName, setQuickGuestName] = useState<string>('');
  const [memberSearch, setMemberSearch] = useState<string>('');

  // AI Receipt state
  const [billPreviewUrl, setBillPreviewUrl] = useState<string>('');
  const [billImageSizeKB, setBillImageSizeKB] = useState<number>(0);
  const [aiBillLoading, setAiBillLoading] = useState<boolean>(false);

  // Voice Attendance state
  const [isListening, setIsListening] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [aiVoiceLoading, setAiVoiceLoading] = useState<boolean>(false);
  const [aiVoiceNotes, setAiVoiceNotes] = useState<string>('');

  // Submit & edit load state
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load chi tiết khi mở Sửa buổi cũ
  useEffect(() => {
    if (!editingSession) return;
    let cancelled = false;
    setLoadingDetail(true);
    setSessionType(editingSession.type);
    setDate(editingSession.date);
    setTitle(editingSession.title);
    setTotalAmountStr(String(editingSession.total_amount));
    setGuestFeeStr(String(editingSession.guest_fee || settings.guest_fee || 50000));
    setPayerId(editingSession.payer_id || defaultTreasurerId);
    setReceiptDriveId(editingSession.receipt_drive_id || '');
    setReceiptUrl(editingSession.receipt_url || '');
    setReceiptSummary(editingSession.receipt_summary || '');
    setNote(editingSession.note || '');

    fetchSessionDetail(editingSession.session_id)
      .then((detail) => {
        if (cancelled) return;
        setSelectedIds(detail.attendances.map((a) => a.member_id));
        setPaidImmediatelyIds(
          detail.attendances
            .filter((a) => a.member_type_snapshot === 'GUEST' && a.is_paid)
            .map((a) => a.member_id)
        );
      })
      .catch((err) => {
        if (!cancelled) setErrorMsg(handleApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editingSession, defaultTreasurerId, settings.guest_fee, handleApiError]);

  const totalAmount = Math.max(0, Math.round(Number(totalAmountStr) || 0));
  const guestFee = Math.max(0, Math.round(Number(guestFeeStr) || 0));

  const selectedNewGuests = useMemo(
    () => detectedGuests.filter((g) => g.selected && g.name.trim()),
    [detectedGuests]
  );

  const totalAttendeeCount = selectedIds.length + selectedNewGuests.length;
  const roundingUnit = settings.rounding_unit || 1000;
  const perPersonDrinking =
    sessionType === 'DRINKING' && totalAttendeeCount > 0
      ? Math.round(totalAmount / totalAttendeeCount / roundingUnit) * roundingUnit
      : 0;

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return activeMembers;
    return activeMembers.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.aliases.toLowerCase().includes(q)
    );
  }, [activeMembers, memberSearch]);

  const toggleMember = (memberId: string) => {
    setSelectedIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const togglePaidImmediately = (memberId: string) => {
    setPaidImmediatelyIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const handleBillFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !idToken) return;

    setErrorMsg(null);
    setAiBillLoading(true);
    try {
      const compressed = await compressImageToBase64(file, 1200, 0.75);
      setBillPreviewUrl(compressed.previewUrl);
      setBillImageSizeKB(compressed.sizeKB);

      const res = await parseBillAI(idToken, {
        base64Image: compressed.base64,
        mimeType: compressed.mimeType,
        sessionDate: date,
      });

      if (res.total_amount > 0) {
        setTotalAmountStr(String(res.total_amount));
      }
      if (res.items_summary) {
        setReceiptSummary(res.items_summary);
      }
      if (!title.trim() && res.suggested_title) {
        setTitle(res.suggested_title);
      }
      setReceiptDriveId(res.receipt_drive_id || '');
      setReceiptUrl(res.receipt_url || '');
      toast.success(
        res.total_amount > 0
          ? `AI đã đọc hóa đơn: ${formatVND(res.total_amount)}`
          : 'Đã tải ảnh hóa đơn lên Google Drive.'
      );
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setAiBillLoading(false);
    }
  };

  const toggleMicrophone = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setErrorMsg(
        'Trình duyệt không hỗ trợ Web Speech API. Bạn hãy gõ trực tiếp hoặc dùng nút micro trên bàn phím điện thoại vào ô bên dưới.'
      );
      return;
    }

    setErrorMsg(null);
    const recognition = new SpeechRec();
    recognition.lang = 'vi-VN';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let fullText = '';
      for (let i = 0; i < event.results.length; i++) {
        fullText += event.results[i][0].transcript + ' ';
      }
      setTranscript(fullText.trim());
    };
    recognition.onerror = (ev) => {
      setIsListening(false);
      if (ev.error !== 'aborted') {
        setErrorMsg(`Lỗi micro (${ev.error}). Bạn có thể sửa/nhập trực tiếp vào ô văn bản.`);
      }
    };
    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const handleAnalyzeVoice = async () => {
    if (!idToken) return;
    if (!transcript.trim()) {
      setErrorMsg('Hãy nói hoặc nhập nội dung điểm danh trước khi bấm AI phân tích.');
      return;
    }

    setErrorMsg(null);
    setAiVoiceLoading(true);
    try {
      const res = await parseVoiceAttendanceAI(idToken, { transcript: transcript.trim() });
      setSelectedIds((prev) => Array.from(new Set([...prev, ...res.matched_member_ids])));
      if (res.new_guests.length > 0) {
        setDetectedGuests((prev) => {
          const existingLower = new Set(prev.map((g) => g.name.toLowerCase()));
          const additions = res.new_guests
            .filter((name) => name.trim() && !existingLower.has(name.trim().toLowerCase()))
            .map((name) => ({ name: name.trim(), selected: true, paidImmediately: false }));
          return [...prev, ...additions];
        });
      }
      setAiVoiceNotes(res.notes || '');
      toast.success(
        `AI khớp ${res.matched_member_ids.length} thành viên & ${res.new_guests.length} vãng lai mới.`
      );
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setAiVoiceLoading(false);
    }
  };

  const handleAddQuickGuest = () => {
    const clean = quickGuestName.trim();
    if (!clean) return;
    setDetectedGuests((prev) => {
      if (prev.some((g) => g.name.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, { name: clean, selected: true, paidImmediately: false }];
    });
    setQuickGuestName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || submitting) return;

    if (totalAttendeeCount === 0) {
      setErrorMsg('Vui lòng chọn ít nhất 1 người tham gia.');
      return;
    }
    if (sessionType === 'DRINKING' && totalAmount <= 0) {
      setErrorMsg('Buổi Ăn nhậu cần nhập Tổng tiền > 0.');
      return;
    }

    const finalTitle =
      title.trim() || (sessionType === 'BADMINTON' ? `Cầu lông ${date}` : `Ăn nhậu ${date}`);

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload = {
        date,
        type: sessionType,
        category: sessionType,
        title: finalTitle,
        totalAmount,
        guestFee: sessionType === 'BADMINTON' ? guestFee : 0,
        payerId: payerId || defaultTreasurerId,
        receiptDriveId,
        receiptUrl,
        receiptSummary,
        note,
        attendeeIds: selectedIds,
        paidImmediatelyMemberIds: paidImmediatelyIds,
        new_guests: selectedNewGuests.map((g) => ({
          name: g.name,
          paidImmediately: g.paidImmediately,
        })),
      };

      if (editingSession) {
        await updateSession(idToken, { ...payload, sessionId: editingSession.session_id });
        setSuccessMsg('Đã cập nhật buổi chơi thành công!');
        toast.success('Đã cập nhật buổi chơi thành công!');
      } else {
        await createSession(idToken, payload);
        setSuccessMsg('Đã lưu buổi mới thành công!');
        toast.success('Đã lưu buổi mới thành công!');
      }

      await onSaved();
    } catch (err) {
      // Nếu lỗi 401 UNAUTHORIZED -> handleApiError bật ReauthModal, giữ nguyên toàn bộ form state!
      setErrorMsg(handleApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const previewRows = useMemo(() => {
    const selectedMembers = activeMembers.filter((m) => selectedIds.includes(m.member_id));
    const list: Array<{ key: string; name: string; type: 'MAIN' | 'GUEST'; amount: number; paid: boolean }> = [];

    for (const m of selectedMembers) {
      if (sessionType === 'BADMINTON') {
        const fee = m.type === 'GUEST' ? guestFee : 0;
        const paid = m.type === 'MAIN' || paidImmediatelyIds.includes(m.member_id) || fee === 0;
        list.push({ key: m.member_id, name: m.name, type: m.type, amount: fee, paid });
      } else {
        const paid = m.member_id === payerId || perPersonDrinking === 0;
        list.push({
          key: m.member_id,
          name: m.name,
          type: m.type,
          amount: perPersonDrinking,
          paid,
        });
      }
    }

    for (const g of selectedNewGuests) {
      if (sessionType === 'BADMINTON') {
        list.push({
          key: `new_${g.name}`,
          name: `${g.name} (Mới)`,
          type: 'GUEST',
          amount: guestFee,
          paid: g.paidImmediately || guestFee === 0,
        });
      } else {
        list.push({
          key: `new_${g.name}`,
          name: `${g.name} (Mới)`,
          type: 'GUEST',
          amount: perPersonDrinking,
          paid: perPersonDrinking === 0,
        });
      }
    }
    return list;
  }, [
    activeMembers,
    selectedIds,
    selectedNewGuests,
    sessionType,
    guestFee,
    paidImmediatelyIds,
    payerId,
    perPersonDrinking,
  ]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Header mode */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between gap-2 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            {editingSession ? 'Chỉnh sửa buổi chơi' : 'Tạo buổi chơi mới'}
          </h2>
          <p className="text-xs text-slate-500">
            Hỗ trợ quét hóa đơn AI &amp; điểm danh giọng nói tiếng Việt
          </p>
        </div>
        {editingSession && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Hủy sửa</span>
          </button>
        )}
      </div>

      {loadingDetail && (
        <div className="rounded-2xl bg-blue-50 border border-blue-200 p-3 flex items-center gap-2 text-xs text-blue-700">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Đang tải danh sách điểm danh cũ...</span>
        </div>
      )}

      {/* 1. Loại buổi & Thông tin cơ bản */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setSessionType('BADMINTON')}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition cursor-pointer ${
              sessionType === 'BADMINTON'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Trophy className="w-4 h-4" />
            <span>Cầu lông</span>
          </button>
          <button
            type="button"
            onClick={() => setSessionType('DRINKING')}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition cursor-pointer ${
              sessionType === 'DRINKING'
                ? 'bg-orange-500 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Utensils className="w-4 h-4" />
            <span>Ăn nhậu</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Ngày diễn ra</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Tiêu đề buổi</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={sessionType === 'BADMINTON' ? 'VD: Cầu lông tối T4' : 'VD: Nhậu Lẩu Dê'}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </section>

      {/* 2. Khối Quét hóa đơn AI */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Receipt className="w-4 h-4 text-blue-600" />
              <span>Hóa đơn &amp; Chi phí</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              {sessionType === 'BADMINTON'
                ? 'Có thể để Tổng tiền = 0 nếu sân đã trả theo gói tháng'
                : 'Chụp hóa đơn để AI tự bóc tách tổng tiền & món ăn'}
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleBillFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={aiBillLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-60 shrink-0"
          >
            {aiBillLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Camera className="w-4 h-4" />
            )}
            <span>{aiBillLoading ? 'Đang quét AI...' : 'Chụp / Tải hóa đơn'}</span>
          </button>
        </div>

        {billPreviewUrl && (
          <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-2.5 border border-slate-200">
            <img
              src={billPreviewUrl}
              alt="Xem trước hóa đơn"
              className="w-16 h-16 object-cover rounded-lg border border-slate-200"
            />
            <div className="text-xs text-slate-600 min-w-0">
              <p className="font-semibold text-slate-800">Đã nén &amp; tải ảnh ({billImageSizeKB} KB)</p>
              {receiptUrl && (
                <a
                  href={receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline truncate block"
                >
                  Xem ảnh lưu trên Google Drive
                </a>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Tổng tiền (VND) {sessionType === 'BADMINTON' && '— nhập 0 nếu không phát sinh chi'}
            </label>
            <input
              type="number"
              min={0}
              step={1000}
              value={totalAmountStr}
              onChange={(e) => setTotalAmountStr(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {sessionType === 'BADMINTON' ? (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Phí Vãng lai buổi này (VND)
              </label>
              <input
                type="number"
                min={0}
                step={5000}
                value={guestFeeStr}
                onChange={(e) => setGuestFeeStr(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Người ứng tiền (nhận tiền chia)
              </label>
              <select
                value={payerId}
                onChange={(e) => setPayerId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {activeMembers.map((m) => (
                  <option key={m.member_id} value={m.member_id}>
                    {m.name} {m.member_id === defaultTreasurerId ? '(Thủ quỹ)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {sessionType === 'BADMINTON' && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Người ứng tiền sân/cầu (mặc định Thủ quỹ)
            </label>
            <select
              value={payerId}
              onChange={(e) => setPayerId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {activeMembers.map((m) => (
                <option key={m.member_id} value={m.member_id}>
                  {m.name} {m.member_id === defaultTreasurerId ? '(Thủ quỹ)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Tóm tắt món ăn / chi phí (AI tự điền hoặc sửa tay)
          </label>
          <input
            type="text"
            value={receiptSummary}
            onChange={(e) => setReceiptSummary(e.target.value)}
            placeholder="VD: Lẩu gà (1), Bia Tiger (12), Thuê 2 sân"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </section>

      {/* 3. Khối Điểm danh Giọng nói AI + Nhập tay */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Điểm danh bằng giọng nói &amp; Tick tay</h3>
            <p className="text-[11px] text-slate-500">
              Bấm Micro đọc tiếng Việt hoặc gõ/sửa trực tiếp câu điểm danh
            </p>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
            Đã chọn {totalAttendeeCount}
          </span>
        </div>

        {/* Nút Micro lớn + Textarea chỉnh sửa trực tiếp */}
        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-3 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={toggleMicrophone}
              className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold shadow-xs transition cursor-pointer shrink-0 ${
                isListening
                  ? 'bg-rose-600 hover:bg-rose-700 text-white animate-pulse'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              <span>{isListening ? 'Dừng nói' : 'Nói điểm danh'}</span>
            </button>

            <button
              type="button"
              onClick={handleAnalyzeVoice}
              disabled={aiVoiceLoading || !transcript.trim()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-3 px-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold transition cursor-pointer disabled:opacity-50"
            >
              {aiVoiceLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 text-amber-300" />
              )}
              <span>{aiVoiceLoading ? 'Đang phân tích...' : 'AI phân tích điểm danh'}</span>
            </button>
          </div>

          <textarea
            rows={2}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder='VD: "Hôm nay có Tuấn, Hùng, Dũng, thêm vãng lai Nam, Huy"'
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />

          {aiVoiceNotes && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              Lưu ý AI: {aiVoiceNotes}
            </p>
          )}
        </div>

        {/* Nhóm Vãng lai mới phát hiện */}
        {detectedGuests.length > 0 && (
          <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-3 space-y-2">
            <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
              <UserPlus className="w-4 h-4" />
              <span>Người vãng lai mới phát hiện (tự thêm vào Members khi lưu):</span>
            </p>
            <div className="space-y-1.5">
              {detectedGuests.map((g, idx) => (
                <div
                  key={`${g.name}-${idx}`}
                  className="flex items-center justify-between gap-2 bg-white rounded-xl px-3 py-2 border border-amber-200/80"
                >
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={g.selected}
                      onChange={(e) =>
                        setDetectedGuests((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, selected: e.target.checked } : item
                          )
                        )
                      }
                      className="w-4 h-4 accent-emerald-600"
                    />
                    <span>{g.name}</span>
                  </label>

                  {sessionType === 'BADMINTON' && g.selected && (
                    <label className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={g.paidImmediately}
                        onChange={(e) =>
                          setDetectedGuests((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, paidImmediately: e.target.checked } : item
                            )
                          )
                        }
                        className="w-3.5 h-3.5 accent-emerald-600"
                      />
                      <span>Trả ngay</span>
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tìm kiếm + Tick tay thành viên + Thêm vãng lai nhanh */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Tìm nhanh theo tên hoặc biệt danh..."
                className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-0.5">
            {filteredMembers.map((m) => {
              const checked = selectedIds.includes(m.member_id);
              const isPaidImm = paidImmediatelyIds.includes(m.member_id);
              return (
                <div
                  key={m.member_id}
                  onClick={() => toggleMember(m.member_id)}
                  className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border transition cursor-pointer select-none ${
                    checked
                      ? 'bg-emerald-50 border-emerald-400'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                        checked ? 'bg-emerald-600 text-white' : 'border border-slate-300 bg-white'
                      }`}
                    >
                      {checked && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{m.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {m.type === 'GUEST' ? 'Vãng lai' : 'Thành viên chính'}
                        {m.aliases ? ` • ${m.aliases}` : ''}
                      </p>
                    </div>
                  </div>

                  {checked && sessionType === 'BADMINTON' && m.type === 'GUEST' && (
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        togglePaidImmediately(m.member_id);
                      }}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 cursor-pointer ${
                        isPaidImm
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white border border-slate-300 text-slate-600'
                      }`}
                    >
                      {isPaidImm ? 'Đã trả ngay' : 'Ghi nợ'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* + Thêm vãng lai nhanh */}
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              value={quickGuestName}
              onChange={(e) => setQuickGuestName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddQuickGuest();
                }
              }}
              placeholder="Tên khách vãng lai mới..."
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="button"
              onClick={handleAddQuickGuest}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm vãng lai nhanh</span>
            </button>
          </div>
        </div>
      </section>

      {/* 4. Bảng xem trước (Preview) chia tiền */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5 shadow-xs">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Xem trước phân bổ tiền</h3>
          {sessionType === 'DRINKING' && (
            <span className="text-xs font-bold text-orange-600">
              {formatVND(perPersonDrinking)}/người
            </span>
          )}
        </div>

        {previewRows.length === 0 ? (
          <p className="text-xs text-slate-400">Chưa có người tham gia nào được chọn.</p>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
            {previewRows.map((r) => (
              <div
                key={r.key}
                className="px-3 py-2 flex items-center justify-between text-xs bg-slate-50/50"
              >
                <span className="font-semibold text-slate-800">
                  {r.name}{' '}
                  <span className="text-[10px] text-slate-400 font-normal">
                    ({r.type === 'GUEST' ? 'Vãng lai' : 'Chính'})
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">{formatVND(r.amount)}</span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      r.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {r.amount === 0 ? 'Quỹ tháng' : r.paid ? 'Đã trả' : 'Ghi nợ'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Ghi chú thêm</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú buổi chơi (tùy chọn)"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-2 text-xs font-semibold text-emerald-800">
          <Check className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Nút Lưu buổi chống bấm đúp */}
      <button
        type="submit"
        disabled={submitting || loadingDetail}
        className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm active:scale-[0.99] transition cursor-pointer disabled:opacity-60"
      >
        {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
        <span>
          {submitting
            ? 'Đang lưu lên Google Sheets...'
            : editingSession
            ? 'Lưu thay đổi buổi chơi'
            : 'Lưu buổi mới'}
        </span>
      </button>
    </form>
  );
}
