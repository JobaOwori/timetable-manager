import { cn } from "@/lib/cn";

type Tone = "danger" | "warn" | "good" | "info" | "neutral" | "brass";

const styles: Record<Tone, string> = {
  danger: "bg-danger/12 text-danger border-danger/30",
  warn: "bg-warn/12 text-warn border-warn/30",
  good: "bg-good/12 text-good border-good/30",
  info: "bg-info/12 text-info border-info/30",
  brass: "bg-brass/12 text-brass border-brass/30",
  neutral: "bg-surface-2/60 text-muted border-rule",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        styles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
