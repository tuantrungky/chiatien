import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpCircle,
  ArrowUpFromLine,
  Check,
  Database,
  Edit3,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  Shield,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  fetchEditors,
  manageEditors,
  updateSettings,
  upsertMember,
  type DbProviderMode,
} from '../services/api';
import {
  getActiveProviderDisplayName,
  getProviderCapabilities,
  setLocalProviderOverride,
  subscribeProviderMode,
} from '../services/providerRegistry';
import type { SyncMetaState, TableCountComparison } from '../services/providers/types';
import {
  compareFirebaseAndSheet,
  pullSheetToFirebase,
  pushFirebaseToSheet,
} from '../services/sync/manualSync';
import type { Editor, EditorRole, Member, SettingsMap } from '../types';
import { VIETQR_BANKS } from '../utils/banks';

interface SettingsPageProps {
  members: Member[];
  settings: SettingsMap;
  onRefreshAll: () => Promise<boolean>;
}

export function SettingsPage({ members, settings, onRefreshAll }: SettingsPageProps) {
  const { idToken, editor, isAdmin, getFreshIdToken, handleApiError } = useAuth();
  const toast = useToast();
  const [subTab, setSubTab] = useState<'MEMBERS' | 'SETTINGS' | 'EDITORS' | 'DATABASE'>('MEMBERS');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Database & Sync state (ADMIN)
  const [capabilities, setCapabilities] = useState(() => getProviderCapabilities());
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncProgressText, setSyncProgressText] = useState<string | null>(null);
  const [syncMeta, setSyncMeta] = useState<SyncMetaState | null>(null);
  const [sheetExportedAt, setSheetExportedAt] = useState<string>('');
  const [comparisons, setComparisons] = useState<TableCountComparison[]>([]);

  useEffect(() => {
    return subscribeProviderMode(() => {
      setCapabilities(getProviderCapabilities());
    });
  }, []);

  // Member form state
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [mName, setMName] = useState('');
  const [mAliases, setMAliases] = useState('');
  const [mType, setMType] = useState<'MAIN' | 'GUEST'>('MAIN');
  const [mPhone, setMPhone] = useState('');
  const [mBankBin, setMBankBin] = useState('');
  const [mBankName, setMBankName] = useState('');
  const [mAccountNo, setMAccountNo] = useState('');
  const [mAccountName, setMAccountName] = useState('');
  const [mIsActive, setMIsActive] = useState(true);
  const [mIsTreasurer, setMIsTreasurer] = useState(false);
  const [showMemberForm, setShowMemberForm] = useState(false);

  // Settings form state
  const [clubName, setClubName] = useState(settings.club_name);
  const [guestFee, setGuestFee] = useState(String(settings.guest_fee));
  const [courtPrice, setCourtPrice] = useState(String(settings.court_price_per_hour || 0));
  const [shuttlePrice, setShuttlePrice] = useState(String(settings.shuttle_price || 0));
  const [defaultCourts, setDefaultCourts] = useState(String(settings.default_court_count || 2));
  const [defaultHours, setDefaultHours] = useState(String(settings.default_play_hours || 1.5));
  const [roundingUnit, setRoundingUnit] = useState(String(settings.rounding_unit));
  const [transferPrefix, setTransferPrefix] = useState(settings.transfer_prefix);
  const [driveFolderId, setDriveFolderId] = useState(settings.drive_folder_id);

  // Editors state
  const [editorsList, setEditorsList] = useState<Editor[]>([]);
  const [loadingEditors, setLoadingEditors] = useState(false);
  const [newEdEmail, setNewEdEmail] = useState('');
  const [newEdName, setNewEdName] = useState('');
  const [newEdRole, setNewEdRole] = useState<EditorRole>('EDITOR');

  useEffect(() => {
    setClubName(settings.club_name);
    setGuestFee(String(settings.guest_fee));
    setCourtPrice(String(settings.court_price_per_hour || 0));
    setShuttlePrice(String(settings.shuttle_price || 0));
    setDefaultCourts(String(settings.default_court_count || 2));
    setDefaultHours(String(settings.default_play_hours || 1.5));
    setRoundingUnit(String(settings.rounding_unit));
    setTransferPrefix(settings.transfer_prefix);
    setDriveFolderId(settings.drive_folder_id);
  }, [settings]);

  const loadEditors = useCallback(async () => {
    if (!idToken) return;
    setLoadingEditors(true);
    try {
      const list = await fetchEditors(idToken);
      setEditorsList(list);
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setLoadingEditors(false);
    }
  }, [idToken, handleApiError]);

  useEffect(() => {
    if (subTab === 'EDITORS') {
      void loadEditors();
    }
  }, [subTab, loadEditors]);

  const openNewMemberForm = () => {
    setEditingMemberId(null);
    setMName('');
    setMAliases('');
    setMType('MAIN');
    setMPhone('');
    setMBankBin('');
    setMBankName('');
    setMAccountNo('');
    setMAccountName('');
    setMIsActive(true);
    setMIsTreasurer(false);
    setShowMemberForm(true);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const openEditMemberForm = (m: Member) => {
    setEditingMemberId(m.member_id);
    setMName(m.name);
    setMAliases(m.aliases);
    setMType(m.type);
    setMPhone(m.phone);
    setMBankBin(m.bank_bin);
    setMBankName(m.bank_name);
    setMAccountNo(m.account_no);
    setMAccountName(m.account_name);
    setMIsActive(m.is_active);
    setMIsTreasurer(m.member_id === settings.treasurer_member_id);
    setShowMemberForm(true);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleSelectBank = (bin: string) => {
    setMBankBin(bin);
    const bank = VIETQR_BANKS.find((b) => b.bin === bin);
    if (bank) setMBankName(bank.name);
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || busy) return;
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await upsertMember(idToken, {
        memberId: editingMemberId,
        name: mName,
        aliases: mAliases,
        type: mType,
        phone: mPhone,
        bankBin: mBankBin,
        bankName: mBankName,
        accountNo: mAccountNo,
        accountName: mAccountName,
        isActive: mIsActive,
      });

      if (mIsTreasurer && res.member.member_id !== settings.treasurer_member_id) {
        await updateSettings(idToken, {
          settings: { treasurer_member_id: res.member.member_id },
        });
      }

      setShowMemberForm(false);
      setSuccessMsg(`Đã lưu thông tin thành viên ${res.member.name}.`);
      toast.success(`Đã lưu thông tin thành viên ${res.member.name}.`);
      await onRefreshAll();
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleUpgradeGuestToMain = async (m: Member) => {
    if (!idToken || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await upsertMember(idToken, {
        memberId: m.member_id,
        name: m.name,
        aliases: m.aliases,
        type: 'MAIN',
        phone: m.phone,
        bankBin: m.bank_bin,
        bankName: m.bank_name,
        accountNo: m.account_no,
        accountName: m.account_name,
        isActive: m.is_active,
      });
      setSuccessMsg(`Đã nâng cấp ${m.name} lên Thành viên chính!`);
      toast.success(`Đã nâng cấp ${m.name} lên Thành viên chính!`);
      await onRefreshAll();
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleMemberActive = async (m: Member) => {
    if (!idToken || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await upsertMember(idToken, {
        memberId: m.member_id,
        name: m.name,
        type: m.type,
        isActive: !m.is_active,
      });
      await onRefreshAll();
      toast.success(m.is_active ? `Đã ẩn ${m.name}.` : `Đã kích hoạt lại ${m.name}.`);
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || busy) return;
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updateSettings(idToken, {
        settings: {
          club_name: clubName.trim(),
          guest_fee: Number(guestFee) || 50000,
          court_price_per_hour: Number(courtPrice) || 0,
          shuttle_price: Number(shuttlePrice) || 0,
          default_court_count: Number(defaultCourts) || 2,
          default_play_hours: Number(defaultHours) || 1.5,
          rounding_unit: Number(roundingUnit) || 1000,
          transfer_prefix: transferPrefix.trim() || 'CLN',
          drive_folder_id: driveFolderId.trim(),
        },
      });
      setSuccessMsg('Đã cập nhật cấu hình CLB.');
      toast.success('Đã cập nhật cấu hình CLB.');
      await onRefreshAll();
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAddEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken || !isAdmin || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const updated = await manageEditors(idToken, {
        operation: 'UPSERT',
        email: newEdEmail,
        name: newEdName || newEdEmail,
        role: newEdRole,
        isActive: true,
      });
      setEditorsList(updated);
      setNewEdEmail('');
      setNewEdName('');
      setSuccessMsg('Đã thêm/cập nhật quyền Editor.');
      toast.success('Đã thêm/cập nhật quyền Editor.');
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteEditor = async (targetEmail: string) => {
    if (!idToken || !isAdmin || busy) return;
    if (!window.confirm(`Xóa quyền Editor của ${targetEmail}?`)) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const updated = await manageEditors(idToken, {
        operation: 'DELETE',
        email: targetEmail,
      });
      setEditorsList(updated);
      toast.success(`Đã xóa Editor ${targetEmail}.`);
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchProvider = async (nextOverride: DbProviderMode | null) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    const active = setLocalProviderOverride(nextOverride);
    setCapabilities(getProviderCapabilities());
    toast.info(`Đã chuyển nguồn dữ liệu sang ${getActiveProviderDisplayName(active)}.`);
    await onRefreshAll();
  };

  const handleCompareDatabases = async () => {
    if (!isAdmin || syncLoading) return;
    const token = (await getFreshIdToken()) || idToken;
    if (!token) {
      toast.error('Vui lòng đăng nhập lại bằng tài khoản Google ADMIN.');
      return;
    }
    setSyncLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setSyncProgressText('Đang đọc số lượng bản ghi từ Firebase & Google Sheets...');
    try {
      const res = await compareFirebaseAndSheet(token);
      setComparisons(res.comparisons);
      setSyncMeta(res.meta);
      setSheetExportedAt(res.sheetExportedAt);
      toast.success('Đã đối chiếu xong dữ liệu giữa Firebase và Google Sheets.');
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setSyncLoading(false);
      setSyncProgressText(null);
    }
  };

  const handlePullSheetToFirebase = async () => {
    if (!isAdmin || syncLoading) return;
    if (
      !window.confirm(
        'Xác nhận KÉO dữ liệu từ Google Sheets sang Firebase?\n\nDữ liệu hiện tại trên Firestore sẽ được cập nhật khớp hoàn toàn với 11 tab trên Google Sheets.'
      )
    ) {
      return;
    }
    const token = (await getFreshIdToken()) || idToken;
    if (!token || !editor?.email) return;
    setSyncLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await pullSheetToFirebase(token, editor.email, (msg) => {
        setSyncProgressText(msg);
      });
      const totalRows = Object.values(res.counts).reduce((s, n) => s + n, 0);
      setSuccessMsg(`Đã kéo thành công ${totalRows} bản ghi từ Google Sheets sang Cloud Firestore.`);
      toast.success('Kéo dữ liệu Sheet → Firebase thành công!');
      await onRefreshAll();
      await handleCompareDatabases();
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setSyncLoading(false);
      setSyncProgressText(null);
    }
  };

  const handlePushFirebaseToSheet = async () => {
    if (!isAdmin || syncLoading) return;
    if (
      !window.confirm(
        'Xác nhận SAO LƯU dữ liệu từ Firebase sang Google Sheets?\n\nNội dung 11 tab trên Google Sheets sẽ được ghi đè theo bản mới nhất trên Cloud Firestore.'
      )
    ) {
      return;
    }
    const token = (await getFreshIdToken()) || idToken;
    if (!token || !editor?.email) return;
    setSyncLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await pushFirebaseToSheet(token, editor.email, (msg) => {
        setSyncProgressText(msg);
      });
      const totalRows = Object.values(res.importedCounts).reduce((s, n) => s + n, 0);
      setSuccessMsg(`Đã sao lưu thành công ${totalRows} bản ghi từ Firebase sang Google Sheets.`);
      toast.success('Đẩy dữ liệu Firebase → Sheet thành công!');
      await handleCompareDatabases();
    } catch (err) {
      setErrorMsg(handleApiError(err));
    } finally {
      setSyncLoading(false);
      setSyncProgressText(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`grid gap-1 bg-slate-200/70 p-1 rounded-2xl ${isAdmin ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
        {[
          { id: 'MEMBERS' as const, label: 'Thành viên', icon: Users },
          { id: 'SETTINGS' as const, label: 'Đơn giá & Cài đặt', icon: SettingsIcon },
          { id: 'EDITORS' as const, label: 'Quyền Editor', icon: Shield },
          ...(isAdmin
            ? [{ id: 'DATABASE' as const, label: 'Database & Sync', icon: Database }]
            : []),
        ].map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setSubTab(t.id);
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                active ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

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

      {/* TAB 1: THÀNH VIÊN */}
      {subTab === 'MEMBERS' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Tổng cộng <span className="font-bold text-slate-800">{members.length}</span> thành viên
            </p>
            <button
              type="button"
              onClick={openNewMemberForm}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm thành viên</span>
            </button>
          </div>

          {showMemberForm && (
            <form
              onSubmit={handleSaveMember}
              className="bg-white rounded-2xl border border-emerald-300 p-4 space-y-3 shadow-sm"
            >
              <h3 className="text-sm font-bold text-slate-900">
                {editingMemberId ? 'Cập nhật thành viên' : 'Thêm thành viên mới'}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Họ và tên *</label>
                  <input
                    type="text"
                    required
                    value={mName}
                    onChange={(e) => setMName(e.target.value)}
                    placeholder="VD: Thảo"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Loại thành viên</label>
                  <select
                    value={mType}
                    onChange={(e) => setMType(e.target.value as 'MAIN' | 'GUEST')}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                  >
                    <option value="MAIN">Thành viên chính (MAIN)</option>
                    <option value="GUEST">Vãng lai (GUEST)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Biệt danh (tìm nhanh)
                  </label>
                  <input
                    type="text"
                    value={mAliases}
                    onChange={(e) => setMAliases(e.target.value)}
                    placeholder="VD: Thảo, Thỏ"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Số điện thoại</label>
                  <input
                    type="text"
                    value={mPhone}
                    onChange={(e) => setMPhone(e.target.value)}
                    placeholder="0901234567"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ngân hàng VietQR</label>
                  <select
                    value={mBankBin}
                    onChange={(e) => handleSelectBank(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                  >
                    <option value="">-- Chọn ngân hàng --</option>
                    {VIETQR_BANKS.map((b) => (
                      <option key={b.bin} value={b.bin}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Số tài khoản</label>
                  <input
                    type="text"
                    value={mAccountNo}
                    onChange={(e) => setMAccountNo(e.target.value)}
                    placeholder="0123456789"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Tên chủ TK (không dấu)</label>
                  <input
                    type="text"
                    value={mAccountName}
                    onChange={(e) => setMAccountName(e.target.value.toUpperCase())}
                    placeholder="LAI THANH THAO"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm uppercase"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mIsTreasurer}
                    onChange={(e) => setMIsTreasurer(e.target.checked)}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <span>Đặt làm Thủ quỹ mặc định</span>
                </label>

                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mIsActive}
                    onChange={(e) => setMIsActive(e.target.checked)}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <span>Đang hoạt động</span>
                </label>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>Lưu thành viên</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowMemberForm(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Hủy
                </button>
              </div>
            </form>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 shadow-xs overflow-hidden">
            {members.map((m) => {
              const isTreasurer = m.member_id === settings.treasurer_member_id;
              return (
                <div
                  key={m.member_id}
                  className={`p-3.5 flex items-start justify-between gap-2 ${
                    !m.is_active ? 'opacity-55 bg-slate-50' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-bold text-slate-900">{m.name}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          m.type === 'MAIN'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {m.type === 'MAIN' ? 'Chính' : 'Vãng lai'}
                      </span>
                      {isTreasurer && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                          Thủ quỹ
                        </span>
                      )}
                    </div>
                    {m.phone && <p className="text-[11px] text-slate-500 mt-0.5">SĐT: {m.phone}</p>}
                    {m.bank_name && m.account_no && (
                      <p className="text-[11px] text-slate-500">
                        {m.bank_name} • {m.account_no}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    {m.type === 'GUEST' && m.is_active && (
                      <button
                        type="button"
                        onClick={() => void handleUpgradeGuestToMain(m)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold cursor-pointer"
                      >
                        <ArrowUpCircle className="w-3.5 h-3.5" />
                        <span>Lên Chính</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditMemberForm(m)}
                      className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                      title="Sửa"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleMemberActive(m)}
                      disabled={busy}
                      className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
                      title={m.is_active ? 'Ẩn thành viên' : 'Kích hoạt lại'}
                    >
                      {m.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: ĐƠN GIÁ & CÀI ĐẶT */}
      {subTab === 'SETTINGS' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3.5 shadow-xs"
        >
          <h3 className="text-sm font-bold text-slate-900">Đơn giá Cầu lông &amp; Cấu hình CLB</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Tên câu lạc bộ</label>
              <input
                type="text"
                value={clubName}
                onChange={(e) => setClubName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Tiền tố nội dung VietQR
              </label>
              <input
                type="text"
                value={transferPrefix}
                onChange={(e) => setTransferPrefix(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Giá sân / giờ (đ)
              </label>
              <input
                type="number"
                min={0}
                step={5000}
                value={courtPrice}
                onChange={(e) => setCourtPrice(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Giá 1 quả cầu (đ)
              </label>
              <input
                type="number"
                min={0}
                step={1000}
                value={shuttlePrice}
                onChange={(e) => setShuttlePrice(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Số sân mặc định
              </label>
              <input
                type="number"
                min={1}
                value={defaultCourts}
                onChange={(e) => setDefaultCourts(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Số giờ mặc định
              </label>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={defaultHours}
                onChange={(e) => setDefaultHours(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Phí vãng lai mặc định (VND)
              </label>
              <input
                type="number"
                min={0}
                step={5000}
                value={guestFee}
                onChange={(e) => setGuestFee(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Làm tròn chia tiền (VND)
              </label>
              <select
                value={roundingUnit}
                onChange={(e) => setRoundingUnit(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
              >
                {!['1000', '500', '100', '5000', '10000'].includes(roundingUnit) && roundingUnit && (
                  <option value={roundingUnit}>
                    {roundingUnit}đ (Không chuẩn — nên đổi về 1.000đ)
                  </option>
                )}
                <option value="1000">1.000đ (Khuyên dùng)</option>
                <option value="500">500đ</option>
                <option value="100">100đ</option>
                <option value="5000">5.000đ</option>
                <option value="10000">10.000đ</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              ROOT_DRIVE_FOLDER_ID (Lưu ảnh hóa đơn)
            </label>
            <input
              type="text"
              value={driveFolderId}
              onChange={(e) => setDriveFolderId(e.target.value)}
              placeholder="ID thư mục Google Drive"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Lưu cấu hình</span>
          </button>
        </form>
      )}

      {/* TAB 3: QUYỀN EDITORS */}
      {subTab === 'EDITORS' && (
        <div className="space-y-3">
          {isAdmin && (
            <form
              onSubmit={handleAddEditor}
              className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs"
            >
              <h3 className="text-sm font-bold text-slate-900">Cấp quyền Editor mới (ADMIN)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="email"
                  required
                  value={newEdEmail}
                  onChange={(e) => setNewEdEmail(e.target.value)}
                  placeholder="email@gmail.com"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  value={newEdName}
                  onChange={(e) => setNewEdName(e.target.value)}
                  placeholder="Tên hiển thị"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <select
                  value={newEdRole}
                  onChange={(e) => setNewEdRole(e.target.value as EditorRole)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                >
                  <option value="EDITOR">EDITOR</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                <Plus className="w-4 h-4" />
                <span>Thêm / Cập nhật Editor</span>
              </button>
            </form>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 shadow-xs overflow-hidden">
            {loadingEditors ? (
              <div className="p-6 text-center text-xs text-slate-500">Đang tải danh sách Editors...</div>
            ) : editorsList.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Chưa có dữ liệu Editors.</div>
            ) : (
              editorsList.map((ed) => (
                <div key={ed.email} className="p-3.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-slate-900 truncate">{ed.name}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          ed.role === 'ADMIN'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {ed.role}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 truncate">{ed.email}</p>
                  </div>

                  {isAdmin && ed.email.toLowerCase() !== editor?.email.toLowerCase() && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteEditor(ed.email)}
                      disabled={busy}
                      className="p-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer"
                      title="Xóa Editor"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: DATABASE & ĐỒNG BỘ HYBRID (ADMIN) */}
      {subTab === 'DATABASE' && isAdmin && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Nguồn dữ liệu đang kết nối</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Mặc định hệ thống (.env):{' '}
                  <span className="font-semibold text-slate-800">
                    {getActiveProviderDisplayName(capabilities.envDefault)}
                  </span>
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                  capabilities.active === 'firebase'
                    ? 'bg-sky-100 text-sky-800'
                    : capabilities.active === 'gas'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                }`}
              >
                Đang dùng: {getActiveProviderDisplayName(capabilities.active)}
                {capabilities.override ? ' (Tạm đổi trên máy này)' : ''}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {[
                { id: null, label: 'Theo .env', enabled: true },
                { id: 'firebase' as const, label: 'Firebase', enabled: capabilities.firebaseReady },
                { id: 'gas' as const, label: 'Google Sheets', enabled: capabilities.gasReady },
                { id: 'mock' as const, label: 'Mock Demo', enabled: true },
              ].map((opt) => {
                const isSelected = capabilities.override === opt.id;
                return (
                  <button
                    key={String(opt.id)}
                    type="button"
                    disabled={!opt.enabled || syncLoading}
                    onClick={() => void handleSwitchProvider(opt.id)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {opt.label}
                    {!opt.enabled && ' (Chưa cấu hình)'}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500">
              Lưu ý: Nút chuyển kết nối chỉ áp dụng cục bộ trên trình duyệt này để đối chiếu số liệu hoặc dự phòng khẩn cấp, không ảnh hưởng thành viên khác.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Đồng bộ 2 chiều Firebase ↔ Google Sheets</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chủ động kéo dữ liệu khi migrate hoặc đẩy bản sao lưu sang Google Sheets cuối tháng.
                </p>
              </div>
              <button
                type="button"
                disabled={syncLoading || !capabilities.firebaseReady || !capabilities.gasReady}
                onClick={() => void handleCompareDatabases()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncLoading ? 'animate-spin' : ''}`} />
                <span>So sánh dữ liệu</span>
              </button>
            </div>

            {syncProgressText && (
              <div className="rounded-xl bg-sky-50 border border-sky-200 p-3 flex items-center gap-2 text-xs font-medium text-sky-800">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>{syncProgressText}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={syncLoading || !capabilities.firebaseReady || !capabilities.gasReady}
                onClick={() => void handlePullSheetToFirebase()}
                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
              >
                <ArrowDownToLine className="w-4 h-4" />
                <span>Pull: Google Sheet → Firebase</span>
              </button>
              <button
                type="button"
                disabled={syncLoading || !capabilities.firebaseReady || !capabilities.gasReady}
                onClick={() => void handlePushFirebaseToSheet()}
                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
              >
                <ArrowUpFromLine className="w-4 h-4" />
                <span>Push: Firebase → Google Sheet</span>
              </button>
            </div>

            {syncMeta && (
              <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1 pt-1">
                <span>Pull gần nhất: {syncMeta.lastPullFromSheetAt || 'Chưa có'}</span>
                <span>Push gần nhất: {syncMeta.lastPushToSheetAt || 'Chưa có'}</span>
                {sheetExportedAt && <span>Sheet đọc lúc: {sheetExportedAt}</span>}
              </div>
            )}

            {comparisons.length > 0 && (
              <div className="overflow-x-auto border border-slate-200 rounded-xl mt-2">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left px-3 py-2 font-bold">Bảng dữ liệu</th>
                      <th className="text-right px-3 py-2 font-bold">Firebase</th>
                      <th className="text-right px-3 py-2 font-bold">Google Sheet</th>
                      <th className="text-right px-3 py-2 font-bold">Chênh lệch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {comparisons.map((row) => (
                      <tr key={row.table}>
                        <td className="px-3 py-2 font-medium text-slate-800">{row.label}</td>
                        <td className="px-3 py-2 text-right font-mono">{row.firebaseCount}</td>
                        <td className="px-3 py-2 text-right font-mono">{row.sheetCount}</td>
                        <td
                          className={`px-3 py-2 text-right font-mono font-bold ${
                            row.diff === 0 ? 'text-emerald-600' : 'text-amber-600'
                          }`}
                        >
                          {row.diff > 0 ? `+${row.diff}` : row.diff}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
