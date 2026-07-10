import { Badge } from "@/components/ui/badge";

const TONE: Record<string, "danger" | "warn" | "good"> = {
  Overloaded: "danger",
  "Close to Maximum": "warn",
  Balanced: "good",
  "Over Capacity": "danger",
  "Within Tolerance": "warn",
  Underutilized: "info" as never,
  OK: "good",
};

const DOT: Record<string, string> = {
  Overloaded: "🔴",
  "Close to Maximum": "🟡",
  Balanced: "🟢",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONE[status] ?? "neutral";
  return (
    <Badge tone={tone as "danger" | "warn" | "good"}>
      {DOT[status] ? `${DOT[status]} ` : ""}
      {status}
    </Badge>
  );
}
