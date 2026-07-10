"use client";

import { cn } from "@/lib/cn";

export function Button({
  children,
  onClick,
  variant = "outline",
  size = "md",
  disabled,
  className,
  type = "button",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "outline" | "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  const variants = {
    outline: "border border-ink/60 text-ink hover:bg-ink hover:text-parchment",
    primary: "border border-brass bg-brass text-white hover:brightness-110",
    ghost: "text-muted hover:text-ink hover:bg-surface-2/60",
    danger: "border border-danger text-danger hover:bg-danger hover:text-white",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded font-medium transition disabled:opacity-40 disabled:cursor-not-allowed",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Select({
  value,
  onChange,
  options,
  className,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "rounded border border-rule bg-surface text-content text-sm px-2.5 py-1.5 outline-none focus:border-brass focus:ring-1 focus:ring-brass/40",
        className,
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
