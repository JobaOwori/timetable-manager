"use client";

// Tiny global toast/notification store. Any code (component or action) can call
// `toast.success(...)`, `toast.info(...)`, etc. to give the user feedback.
import { create } from "zustand";

export type ToastKind = "success" | "info" | "warn" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id"> & { duration?: number }) => number;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  push: ({ duration = 5000, ...t }) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, ...t }] })); // keep at most ~5
    if (duration > 0 && typeof window !== "undefined") {
      window.setTimeout(() => get().dismiss(id), duration);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience API usable from anywhere (components, store actions, handlers). */
export const toast = {
  success: (message: string, title?: string) => useToast.getState().push({ kind: "success", message, title }),
  info: (message: string, title?: string) => useToast.getState().push({ kind: "info", message, title }),
  warn: (message: string, title?: string) => useToast.getState().push({ kind: "warn", message, title }),
  error: (message: string, title?: string) => useToast.getState().push({ kind: "error", message, title }),
};
