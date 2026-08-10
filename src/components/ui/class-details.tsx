"use client";

import { BookOpen, Clock, DoorOpen, GraduationCap, Layers, Link2, Merge, Users } from "lucide-react";
import { ClassDetails } from "@/lib/classDetails";
import { chipProps, hueStyle } from "@/lib/colors";
import { DEPARTMENT_LABELS } from "@/lib/departments";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/** One labelled line in the class details sheet. */
function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="text-brass mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[0.62rem] uppercase tracking-wide text-muted">{label}</div>
        <div className="text-sm text-content break-words">{children}</div>
      </div>
    </div>
  );
}

/**
 * The full description of a scheduled class: course, lecturer, venue, slot and
 * every programme and cohort attending it. Shown when a timetable entry is
 * clicked, so nothing requires opening another page.
 */
export function ClassDetailsCard({ details }: { details: ClassDetails }) {
  const d = details;
  return (
    <div className="space-y-1 divide-y divide-rule/50">
      <Row icon={<BookOpen size={14} />} label="Course unit">
        <div className="font-mono font-semibold text-ink">{d.unitCode ?? "—"}</div>
        <div className="text-content">{d.unitName ?? "Untitled unit"}</div>
        {d.unitCodes.length > 1 && (
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="text-[0.68rem] text-muted">Also listed as:</span>
            {d.unitNames
              .filter((n) => n !== d.unitName)
              .map((n, i) => (
                <Badge key={n} tone="neutral">
                  {d.unitCodes.filter((c) => c !== d.unitCode)[i] ?? ""} {n}
                </Badge>
              ))}
          </div>
        )}
      </Row>

      <Row icon={<GraduationCap size={14} />} label="Lecturer">
        {d.lecturer ?? <span className="text-warn">Unassigned (TBA)</span>}
      </Row>

      <Row icon={<Clock size={14} />} label="Time slot">
        <span className="font-mono">
          {d.day ?? "—"} · {d.time || "—"}
        </span>
      </Row>

      <Row icon={<DoorOpen size={14} />} label="Room / venue">
        {d.room ? (
          <span className="font-mono">
            {d.room}
            {d.isVirtualRoom && <span className="text-muted"> (online)</span>}
          </span>
        ) : (
          <span className="text-warn">No room assigned</span>
        )}
      </Row>

      <Row icon={<Layers size={14} />} label={`Programme${d.programmes.length === 1 ? "" : "s"} attending`}>
        {d.programmes.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="inline-flex flex-wrap gap-1">
            {d.programmes.map((p) => {
              const { style, className } = chipProps(p);
              return (
                <span
                  key={p}
                  style={style}
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                    className,
                  )}
                >
                  {p}
                </span>
              );
            })}
          </span>
        )}
      </Row>

      <Row icon={<Users size={14} />} label={`Cohort${d.cohorts.length === 1 ? "" : "s"} attending`}>
        {d.cohorts.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="inline-flex flex-wrap gap-1">
            {d.cohorts.map((c) => (
              <Badge key={c} tone="info">
                {c}
              </Badge>
            ))}
          </span>
        )}
        <div className="text-xs text-muted mt-1">
          {d.headCount > 0 ? `${d.headCount} students in total` : "Head count not recorded"}
        </div>
      </Row>

      {d.departments.length > 0 && (
        <Row icon={<Link2 size={14} />} label="Faculty">
          <span className="inline-flex flex-wrap gap-1">
            {d.departments.map((dep) => {
              const { style, className } = chipProps(dep);
              return (
                <span
                  key={dep}
                  style={style}
                  title={DEPARTMENT_LABELS[dep] ?? dep}
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                    className,
                  )}
                >
                  {dep}
                </span>
              );
            })}
          </span>
        </Row>
      )}

      {d.shared && (
        <Row icon={<Users size={14} />} label="Attendance breakdown">
          <div className="rounded border border-rule overflow-hidden mt-0.5">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-2/60 text-muted">
                  <th className="text-left font-medium px-2 py-1">Programme</th>
                  <th className="text-left font-medium px-2 py-1">Cohort</th>
                  <th className="text-left font-medium px-2 py-1">Listed as</th>
                </tr>
              </thead>
              <tbody>
                {d.attendees.map((a, i) => (
                  <tr key={i} className="border-t border-rule/50">
                    <td className="px-2 py-1">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          style={hueStyle(a.programme)}
                          className="dot-color inline-block h-2 w-2 rounded-full shrink-0"
                        />
                        {a.programme ?? "—"}
                      </span>
                    </td>
                    <td className="px-2 py-1 font-mono text-[0.7rem]">{a.cohort ?? "—"}</td>
                    <td className="px-2 py-1 text-muted">
                      <span className="font-mono">{a.unitCode ?? "—"}</span>{" "}
                      {a.unitName && a.unitName !== d.unitName ? a.unitName : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Row>
      )}

      {d.notes && (
        <Row icon={<Merge size={14} />} label="Notes">
          <span className="text-muted">{d.notes}</span>
        </Row>
      )}
    </div>
  );
}
