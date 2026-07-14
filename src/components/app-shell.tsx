"use client";

import { useState, useRef, useEffect } from "react";
import { useStore } from "@/store/useStore";
import { toast } from "@/store/useToast";
import { ConfigRail } from "@/components/config-rail";
import { useFilteredSessions } from "@/store/selectors";
import { OverviewPage } from "@/components/pages/overview";
import { ResolvePage } from "@/components/pages/resolve";
import { TimetablePage } from "@/components/pages/timetable";
import { FacultyPage } from "@/components/pages/faculty";
import { RoomsPage } from "@/components/pages/rooms";
import { DataPage } from "@/components/pages/data";
import { cn } from "@/lib/cn";
import { Toaster } from "@/components/ui/toaster";
import {
  CalendarDays, GraduationCap, LayoutDashboard, DoorOpen, Database, Wand2, Loader2, Upload,
} from "lucide-react";

type Tab = "overview" | "resolve" | "timetable" | "faculty" | "rooms" | "data";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard size={15} /> },
  { id: "timetable", label: "Timetable", icon: <CalendarDays size={15} /> },
  { id: "faculty", label: "Faculty", icon: <GraduationCap size={15} /> },
  { id: "rooms", label: "Rooms", icon: <DoorOpen size={15} /> },
  { id: "resolve", label: "Resolve", icon: <Wand2 size={15} /> },
  { id: "data", label: "Data & Export", icon: <Database size={15} /> },
];

export function AppShell() {
  const loaded = useStore((s) => s.loaded);
  const [tab, setTab] = useState<Tab>("overview");

  // Global Ctrl/Cmd+Z to undo the last change (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        const el = document.activeElement;
        const tag = el?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement)?.isContentEditable) return;
        const st = useStore.getState();
        if (st.history.length === 0) return;
        e.preventDefault();
        st.undo();
        toast.info("Reverted the last change.", "Undone");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <ConfigRail />
      <main className="flex-1 flex flex-col overflow-hidden">
        {loaded ? (
          <>
            <TopNav tab={tab} setTab={setTab} />
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="mx-auto max-w-[1400px] animate-rise">
                {tab === "overview" && <OverviewPage onNavigate={setTab} />}
                {tab === "resolve" && <ResolvePage />}
                {tab === "timetable" && <TimetablePage />}
                {tab === "faculty" && <FacultyPage />}
                {tab === "rooms" && <RoomsPage />}
                {tab === "data" && <DataPage />}
              </div>
            </div>
          </>
        ) : (
          <Landing />
        )}
      </main>
      <Toaster />
    </div>
  );
}

function TopNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const activeTerm = useStore((s) => s.activeTerm);
  const { termSessions, filtered } = useFilteredSessions();
  return (
    <header className="border-b border-rule bg-surface/60 backdrop-blur px-6">
      <div className="mx-auto max-w-[1400px] flex items-center justify-between">
        <nav className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-3 text-sm font-medium border-b-2 transition -mb-px",
                tab === t.id
                  ? "border-brass text-ink"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <div className="text-xs text-muted font-mono">
          Term {activeTerm} · {filtered.length}/{termSessions.length} sessions
        </div>
      </div>
    </header>
  );
}

function Landing() {
  const loadArrayBuffer = useStore((s) => s.loadArrayBuffer);
  const loadCsvText = useStore((s) => s.loadCsvText);
  const loading = useStore((s) => s.loading);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File) => {
    if (f.name.toLowerCase().endsWith(".csv")) {
      loadCsvText(await f.text(), f.name);
    } else {
      loadArrayBuffer(await f.arrayBuffer(), f.name);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="max-w-lg text-center animate-rise">
        <div className="font-mono text-xs tracking-[0.22em] uppercase text-brass mb-2">
          Vol. I · Registrar&apos;s Office · Est. 2026
        </div>
        <h1 className="font-serif text-5xl font-semibold text-ink mb-3">
          Timetable <span className="italic text-brass">Manager</span>
        </h1>
        <p className="text-muted mb-6 leading-relaxed">
          An intelligent scheduling assistant — resolve clashes by transferring lecturers,
          balance workload, and export a clean schedule. Everything runs in your browser;
          your data never leaves this device.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <button
          type="button"
          disabled={loading}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded border border-brass bg-brass px-5 py-2.5 text-white font-medium hover:brightness-110 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Reading your timetable…
            </>
          ) : (
            <>
              <Upload size={16} /> Upload your timetable
            </>
          )}
        </button>
        <p className="text-xs text-muted mt-4">
          {loading
            ? "Parsing in your browser — nothing is uploaded to a server."
            : "Choose a CSV or Excel (.xlsx) file from your computer."}
        </p>
      </div>
    </div>
  );
}
