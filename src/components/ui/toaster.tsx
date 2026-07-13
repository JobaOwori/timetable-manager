"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";
import { useToast, ToastKind } from "@/store/useToast";

const META: Record<ToastKind, { icon: React.ReactNode; accent: string; ring: string }> = {
  success: { icon: <CheckCircle2 size={16} />, accent: "text-good", ring: "border-l-good" },
  info: { icon: <Info size={16} />, accent: "text-info", ring: "border-l-info" },
  warn: { icon: <AlertTriangle size={16} />, accent: "text-warn", ring: "border-l-warn" },
  error: { icon: <XCircle size={16} />, accent: "text-danger", ring: "border-l-danger" },
};

/** Bottom-right stack of transient notifications. Mounted once at the app root. */
export function Toaster() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  if (!mounted) return null;
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2">
      {toasts.map((t) => {
        const m = META[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            className={`animate-toast-in flex items-start gap-2.5 rounded-card border border-rule border-l-[3px] ${m.ring} bg-surface px-3.5 py-2.5 shadow-lg`}
          >
            <span className={`mt-0.5 shrink-0 ${m.accent}`}>{m.icon}</span>
            <div className="min-w-0 flex-1">
              {t.title && <div className="text-sm font-semibold text-ink leading-tight">{t.title}</div>}
              <div className="text-xs text-content leading-snug">{t.message}</div>
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-muted hover:text-ink transition rounded p-0.5 hover:bg-surface-2/60"
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
