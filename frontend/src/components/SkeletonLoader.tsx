export function SkeletonLoader() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Đang tải dữ liệu">
      {/* Period bar skeleton */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2.5">
        <div className="grid grid-cols-4 gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-7 rounded-lg bg-slate-200/80" />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <div className="w-9 h-9 rounded-xl bg-slate-200" />
          <div className="w-36 h-5 rounded-lg bg-slate-200" />
          <div className="w-9 h-9 rounded-xl bg-slate-200" />
        </div>
      </div>

      {/* 4 KPI cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5">
            <div className="w-24 h-3 rounded bg-slate-200" />
            <div className="w-28 h-6 rounded bg-slate-200" />
            <div className="w-20 h-3 rounded bg-slate-100" />
          </div>
        ))}
      </div>

      {/* Debt list skeleton */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="w-40 h-4 rounded bg-slate-200" />
          <div className="w-20 h-3 rounded bg-slate-100" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between py-2 border-t border-slate-100">
            <div className="space-y-1.5">
              <div className="w-44 h-4 rounded bg-slate-200" />
              <div className="w-28 h-3 rounded bg-slate-100" />
            </div>
            <div className="w-24 h-8 rounded-xl bg-slate-200" />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="w-48 h-4 rounded bg-slate-200" />
        <div className="h-48 rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}
