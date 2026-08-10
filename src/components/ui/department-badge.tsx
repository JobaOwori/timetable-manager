import { chipProps } from "@/lib/colors";
import { DEPARTMENT_LABELS } from "@/lib/departments";
import { cn } from "@/lib/cn";

/**
 * Colour-coded faculty/department tag. Every department keeps the same hue
 * everywhere in the app (see lib/colors.ts).
 */
export function DepartmentBadge({
  code,
  className,
  title,
}: {
  code: string | null | undefined;
  className?: string;
  title?: string;
}) {
  if (!code) return <span className="text-muted">—</span>;
  const { style, className: colorClass } = chipProps(code);
  return (
    <span
      style={style}
      title={title ?? DEPARTMENT_LABELS[code] ?? code}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        colorClass,
        className,
      )}
    >
      {code}
    </span>
  );
}

/** A tiny colour dot for the label — used where a full badge is too heavy. */
export function ColorDot({ label, className }: { label: string | null | undefined; className?: string }) {
  const { style, className: colorClass } = chipProps(label);
  return (
    <span
      style={style}
      className={cn("inline-block h-2 w-2 rounded-full shrink-0", colorClass && "dot-color", className)}
    />
  );
}

/** Comma-separated department list, each rendered as its own coloured badge. */
export function DepartmentList({ codes }: { codes: string | string[] | null | undefined }) {
  const list = Array.isArray(codes)
    ? codes
    : (codes ?? "").split(",").map((c) => c.trim()).filter((c) => c && c !== "—");
  if (list.length === 0) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.map((c) => (
        <DepartmentBadge key={c} code={c} />
      ))}
    </span>
  );
}
