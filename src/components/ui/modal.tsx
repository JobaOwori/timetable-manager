"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Lightweight accessible modal/drawer. Closes on Escape and backdrop click. */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;
  // Portal to <body> so the overlay escapes any transformed ancestor (e.g. the
  // page's animate-rise wrapper), which would otherwise trap position:fixed and
  // push the dialog off-screen. This keeps it viewport-centered.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm animate-fade" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-rule bg-surface shadow-2xl animate-modal-pop",
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-rule bg-surface shrink-0">
            <div className="font-serif font-semibold text-ink text-sm">{title}</div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted hover:text-ink transition rounded p-1 hover:bg-surface-2/60 shrink-0"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
