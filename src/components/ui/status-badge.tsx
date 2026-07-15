import { Badge } from "@/components/ui/badge";

const TONE: Record<string, "danger" | "warn" | "good" | "info"> = {
  Balanced: "good",
  Unbalanced: "danger",
  Flexible: "info",
  "Over Capacity": "danger",
  "Within Tolerance": "warn",
  Underutilized: "info",
  OK: "good",
};

const DOT: Record<string, string> = {
  Balanced: "🟢",
  Unbalanced: "🔴",
  Flexible: "🔵",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONE[status] ?? "neutral";
  return (
    <Badge tone={tone as "danger" | "warn" | "good" | "info"}>
      {DOT[status] ? `${DOT[status]} ` : ""}
      {status}
    </Badge>
  );
}
