import { getOverdueInfo } from '../utils/overdue';

interface OverdueBadgeProps {
  fromDate?: string;
  todayStr?: string;
  prefix?: string;
  className?: string;
}

export function OverdueBadge({ fromDate, todayStr, prefix, className = '' }: OverdueBadgeProps) {
  if (!fromDate) return null;
  const info = getOverdueInfo(fromDate, todayStr);
  if (info.severity === 'NONE') return null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold leading-tight ${info.badgeClass} ${className}`}
      title={`Chưa thanh toán từ ${fromDate} (${info.days} ngày)`}
    >
      <span>{info.emoji}</span>
      <span>{prefix ? `${prefix} · ${info.label}` : info.label}</span>
    </span>
  );
}
