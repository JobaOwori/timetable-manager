"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, AlertTriangle, XCircle, X, RotateCcw } from "lucide-react";
import { useToast, ToastKind } from "@/store/useToast";

const META: Record<
  ToastKind,
  { icon: React.ReactNode; accent: string; bar: string; tint: string }
> = {
  success: { icon: <CheckCircle2 size={22} />, accent: "text-good", bar: "bg-good", tint: "bg-good/10" },
  info: { icon: <Info size={22} />, accent: "text-info", bar: "bg-info", tint: "bg-info/10" },
  warn: { icon: <AlertTriangle size={22} />, accent: "text-warn", bar: "bg-warn", tint: "bg-warn/10" },
  error: { icon: <XCircle size={22} />, accent: "text-danger", bar: "bg-danger", tint: "bg-danger/10" },
};

/** Prominent, top-centre stack of notifications. Mounted once at the app root. */
export function Toaster() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  if (!mounted) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex flex-col items-center gap-2.5 px-4">
      {toasts.map((t) => {
        const m = META[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className={`animate-toast-in pointer-events-auto flex w-full max-w-lg items-start gap-3 overflow-hidden rounded-card border border-rule bg-surface shadow-2xl ${m.tint}`}
          >
            <span className={`w-1.5 self-stretch shrink-0 ${m.bar}`} aria-hidden />
            <span className={`mt-3.5 shrink-0 ${m.accent}`}>{m.icon}</span>
            <div className="min-w-0 flex-1 py-3">
              {t.title && <div className="text-[0.95rem] font-semibold text-ink leading-tight">{t.title}</div>}
              <div className="text-sm text-content leading-snug mt-0.5">{t.message}</div>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className={`mt-2 inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-semibold ${m.accent} border-current/40 hover:bg-current/10 transition`}
                >
                  <RotateCcw size={12} /> {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="mr-2 mt-3 shrink-0 rounded p-1 text-muted hover:text-ink hover:bg-surface-2/60 transition"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
