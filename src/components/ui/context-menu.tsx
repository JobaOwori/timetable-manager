"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface MenuItem {
  type?: "item";
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  checked?: boolean;
  disabled?: boolean;
}

export interface MenuHeading {
  type: "heading";
  label: string;
}

export interface MenuSeparator {
  type: "separator";
}

export type MenuEntry = MenuItem | MenuHeading | MenuSeparator;

export interface MenuPosition {
  x: number;
  y: number;
}

/**
 * Right-click context menu rendered in a portal, so it is never clipped by a
 * scrolling table. Closes on Escape, outside click, scroll or resize.
 */
export function ContextMenu({
  position,
  entries,
  onClose,
  title,
}: {
  position: MenuPosition | null;
  entries: MenuEntry[];
  onClose: () => void;
  title?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPosition | null>(position);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => setPos(position), [position]);

  // Keep the menu fully on screen.
  useLayoutEffect(() => {
    if (!position || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(position.x, window.innerWidth - r.width - 8);
    const y = Math.min(position.y, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [position]);

  useEffect(() => {
    if (!position) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [position, onClose]);

  if (!position || !pos || !mounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={ref}
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        className="fixed z-50 min-w-[15rem] max-h-[80vh] overflow-y-auto rounded-card border border-rule bg-surface py-1 shadow-xl animate-fade"
      >
        {title && (
          <div className="px-3 py-1.5 text-[0.68rem] uppercase tracking-wide text-brass border-b border-rule/70 mb-1 truncate">
            {title}
          </div>
        )}
        {entries.map((e, i) => {
          if ("type" in e && e.type === "separator")
            return <div key={i} className="my-1 border-t border-rule/60" />;
          if ("type" in e && e.type === "heading")
            return (
              <div key={i} className="px-3 pt-1.5 pb-1 text-[0.62rem] uppercase tracking-wide text-muted">
                {e.label}
              </div>
            );
          const item = e as MenuItem;
          const checkable = item.checked !== undefined;
          return (
            <button
              key={i}
              type="button"
              role={checkable ? "menuitemradio" : "menuitem"}
              aria-checked={checkable ? item.checked : undefined}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-content transition",
                item.disabled
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:bg-surface-2/70 hover:text-ink",
                item.checked && "text-ink font-medium",
              )}
            >
              <span aria-hidden="true" className="w-4 shrink-0 text-brass">
                {item.checked ? "✓" : item.icon}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.hint && (
                <span aria-hidden="true" className="text-[0.68rem] text-muted shrink-0">
                  {item.hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>,
    document.body,
  );
}

/** Hook that wires right-click on any element to a ContextMenu. */
export function useContextMenu<T>() {
  const [state, setState] = useState<{ position: MenuPosition; target: T } | null>(null);
  const open = (e: React.MouseEvent, target: T) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ position: { x: e.clientX, y: e.clientY }, target });
  };
  return { state, open, close: () => setState(null) };
}
