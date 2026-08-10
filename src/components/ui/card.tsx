import { cn } from "@/lib/cn";

export function Card({
  children,
  className,
  onContextMenu,
}: {
  children: React.ReactNode;
  className?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div className={cn("rounded-card border border-rule bg-surface", className)} onContextMenu={onContextMenu}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        "font-serif uppercase tracking-wide text-ink text-sm font-semibold border-b border-rule pb-1.5 mb-3",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-rule bg-surface/50 px-4 py-8 text-center text-muted text-sm">
      {children}
    </div>
  );
}
