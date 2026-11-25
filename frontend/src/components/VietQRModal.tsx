import { useState } from 'react';
import { AlertCircle, Check, Copy, Download, QrCode, X } from 'lucide-react';
import { formatVND } from '../utils/vietqr';

export interface VietQRModalData {
  title: string;
  subtitle?: string;
  amount: number;
  transferContent: string;
  bankName: string;
  bankBin: string;
  accountNo: string;
  accountName: string;
  vietQrUrl: string | null;
}

interface VietQRModalProps {
  data: VietQRModalData | null;
  onClose: () => void;
}

export function VietQRModal({ data, onClose }: VietQRModalProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [imgLoading, setImgLoading] = useState<boolean>(true);
  const [imgError, setImgError] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);

  if (!data) return null;

  const handleCopy = async (key: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      // Fallback không làm app crash nếu bị chặn clipboard
    }
  };

  const handleDownloadQr = async () => {
    if (!data.vietQrUrl) return;
    setDownloading(true);
    try {
      const res = await fetch(data.vietQrUrl);
      if (!res.ok) throw new Error('Fetch QR failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vietqr_${data.accountNo}_${data.amount}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(data.vietQrUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  };

  const copyRows = [
    { key: 'bank', label: 'Ngân hàng', value: data.bankName || 'Chưa cập nhật' },
    { key: 'accountNo', label: 'Số tài khoản', value: data.accountNo || 'Chưa cập nhật', mono: true },
    { key: 'accountName', label: 'Chủ tài khoản', value: data.accountName || 'Chưa cập nhật' },
    {
      key: 'amount',
      label: 'Số tiền',
      value: formatVND(data.amount),
      rawCopy: String(Math.round(data.amount)),
      highlight: true,
    },
    { key: 'content', label: 'Nội dung CK', value: data.transferContent },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-100 px-4 py-3.5 flex items-center justify-between gap-3 rounded-t-3xl sm:rounded-t-2xl">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">{data.title}</h3>
              {data.subtitle && <p className="text-xs text-slate-500 truncate">{data.subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 cursor-pointer shrink-0"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* QR Image Area */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center">
            {data.vietQrUrl && !imgError ? (
              <div className="relative w-full max-w-[260px] flex flex-col items-center">
                {imgLoading && (
                  <div className="w-56 h-56 rounded-xl bg-slate-200 animate-pulse flex items-center justify-center text-xs text-slate-500">
                    Đang tải mã VietQR...
                  </div>
                )}
                <img
                  src={data.vietQrUrl}
                  alt={`VietQR ${data.accountNo}`}
                  onLoad={() => setImgLoading(false)}
                  onError={() => {
                    setImgLoading(false);
                    setImgError(true);
                  }}
                  className={`w-full max-w-[260px] rounded-xl bg-white p-1.5 shadow-xs ${
                    imgLoading ? 'hidden' : 'block'
                  }`}
                />
              </div>
            ) : (
              <div className="py-6 text-center space-y-2">
                <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
                <p className="text-sm font-semibold text-slate-700">Chưa thể tạo ảnh VietQR</p>
                <p className="text-xs text-slate-500 max-w-xs">
                  Người nhận chưa cấu hình đầy đủ Mã ngân hàng (BIN) và Số tài khoản, hoặc không tải được ảnh từ VietQR.
                </p>
              </div>
            )}
          </div>

          {/* Bank Details with Copy Buttons */}
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl bg-white overflow-hidden">
            {copyRows.map((row) => {
              const copyValue = row.rawCopy ?? row.value;
              const isCopied = copiedKey === row.key;
              return (
                <div
                  key={row.key}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-400 font-medium">{row.label}</p>
                    <p
                      className={`text-sm truncate ${
                        row.highlight
                          ? 'font-bold text-emerald-700'
                          : row.mono
                          ? 'font-mono font-semibold text-slate-900'
                          : 'font-semibold text-slate-800'
                      }`}
                    >
                      {row.value}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopy(row.key, copyValue)}
                    disabled={!copyValue || row.value === 'Chưa cập nhật'}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition shrink-0 cursor-pointer disabled:opacity-40 ${
                      isCopied
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Đã chép</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex gap-2.5 pt-1">
            {data.vietQrUrl && (
              <button
                type="button"
                onClick={handleDownloadQr}
                disabled={downloading}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-xs active:scale-[0.99] transition cursor-pointer disabled:opacity-60"
              >
                <Download className="w-4 h-4" />
                <span>{downloading ? 'Đang tải...' : 'Tải ảnh QR'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
