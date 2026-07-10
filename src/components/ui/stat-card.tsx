"use client";

import { cn } from "@/lib/cn";

type Tone = "brass" | "danger" | "warn" | "good" | "info" | "neutral";

const toneRing: Record<Tone, string> = {
  brass: "border-t-brass",
  danger: "border-t-danger",
  warn: "border-t-warn",
  good: "border-t-good",
  info: "border-t-info",
  neutral: "border-t-ink",
};

export function StatCard({
  label,
  value,
  tone = "brass",
  note,
  onClick,
  active,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  note?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "block w-full text-left rounded-card border border-rule border-t-[3px] bg-surface px-4 pt-3 pb-2.5 transition",
        toneRing[tone],
        onClick && "hover:shadow-sm hover:-translate-y-0.5 cursor-pointer",
        active && "ring-2 ring-brass/50",
        !onClick && "cursor-default",
      )}
    >
      <div className="text-[0.65rem] uppercase tracking-wider text-muted font-medium">{label}</div>
      <div className="font-mono text-2xl font-semibold text-ink leading-tight">{value}</div>
      {note && <div className="text-xs text-muted mt-0.5">{note}</div>}
    </button>
  );
}
