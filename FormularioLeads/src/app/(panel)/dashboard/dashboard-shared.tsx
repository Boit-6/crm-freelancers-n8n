import type {ReactNode} from "react";

export function formatMoney(value: number | null | undefined) {
  if (value == null) return "—";

  return `$${Number(value).toLocaleString("es-AR")}`;
}

export function formatPct(value: number | null | undefined) {
  if (value == null) return "—";

  return `${value}%`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";

  return new Date(value).toLocaleDateString("es-AR");
}

export function SectionHeader({num, title}: {num: string; title: string}) {
  return (
    <div className="mb-7 flex items-baseline gap-3">
      <span className="text-ochre font-serif text-[17px]">{num}</span>
      <span className="text-ink-soft text-[10px] tracking-[0.2em] uppercase">{title}</span>
      <div className="bg-rule-soft h-px flex-1" />
    </div>
  );
}

export function KpiCard({
  label,
  value,
  alert,
  nota,
}: {
  label: string;
  value: string;
  alert?: boolean;
  nota?: string;
}) {
  return (
    <div className="border-rule border-t pt-3.5">
      <p className="text-faint mb-2 text-[10px] tracking-[0.16em] uppercase">{label}</p>
      <p
        className={`font-serif text-[38px] leading-none tracking-tight ${
          alert ? "text-brick" : "text-ink"
        }`}
      >
        {value}
      </p>
      {nota && <p className="text-faint mt-2 text-[11.5px]">{nota}</p>}
    </div>
  );
}

export function FunnelBar({
  label,
  count,
  max,
  muted,
}: {
  label: string;
  count: number;
  max: number;
  muted?: boolean;
}) {
  const percent = max > 0 ? (count / max) * 100 : 0;

  return (
    <div className="flex items-center gap-3 sm:gap-5">
      <span className="text-muted w-32 shrink-0 text-[11px] tracking-[0.12em] uppercase sm:w-44">
        {label}
      </span>
      <div className="bg-rule-soft h-1.5 flex-1">
        <div
          className={`h-full ${muted ? "bg-mist" : "bg-ochre"}`}
          style={{width: `${percent}%`}}
        />
      </div>
      <span className="text-ink w-9 shrink-0 text-right font-serif text-[20px]">{count}</span>
    </div>
  );
}

export function Tag({children, className = ""}: {children: ReactNode; className?: string}) {
  return (
    <span className={`text-[10.5px] tracking-[0.1em] uppercase ${className}`}>{children}</span>
  );
}
