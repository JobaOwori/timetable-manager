"use client";

// Runs the ingest pipeline off the main thread via a Web Worker so the browser
// stays responsive while large workbooks parse. Falls back to synchronous
// parsing (yielded to a macrotask) if Workers are unavailable or fail to start.
import { IngestResult, ingestArrayBuffer, ingestCsvText } from "@/lib/pipeline";

type ResponseMsg =
  | { ready: true }
  | { id: number; ok: true; result: IngestResult }
  | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let readyPromise: Promise<boolean> | null = null;
let seq = 0;
const pending = new Map<
  number,
  { resolve: (r: IngestResult) => void; reject: (e: Error) => void }
>();

function ensureWorker(): Promise<boolean> {
  if (readyPromise) return readyPromise;
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    readyPromise = Promise.resolve(false);
    return readyPromise;
  }
  readyPromise = new Promise<boolean>((resolve) => {
    let settled = false;
    try {
      worker = new Worker(new URL("../workers/ingest.worker.ts", import.meta.url));
    } catch {
      worker = null;
      resolve(false);
      return;
    }
    // If the worker never signals ready (e.g. bootstrap failure), fall back.
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, 5000);

    worker.onmessage = (e: MessageEvent<ResponseMsg>) => {
      const data = e.data;
      if ("ready" in data) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(true);
        }
        return;
      }
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.ok) entry.resolve(data.result);
      else entry.reject(new Error(data.error));
    };
    worker.onerror = () => {
      for (const [, entry] of pending) entry.reject(new Error("Ingest worker crashed."));
      pending.clear();
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }
      worker = null;
      readyPromise = null;
    };
  });
  return readyPromise;
}

/** Yield to the event loop so a spinner can paint before any sync fallback runs. */
const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

function runSync(kind: "xlsx" | "csv", data: ArrayBuffer | string): IngestResult {
  return kind === "csv" ? ingestCsvText(data as string) : ingestArrayBuffer(data as ArrayBuffer);
}

export async function ingestFileInWorker(
  kind: "xlsx" | "csv",
  data: ArrayBuffer | string,
): Promise<IngestResult> {
  const ready = await ensureWorker();
  if (!ready || !worker) {
    await nextTick(); // let the loading spinner paint before the blocking parse
    return runSync(kind, data);
  }
  const id = ++seq;
  // Keep a copy of the data so we can fall back to synchronous parsing if the
  // worker never answers (some bundler dev workers don't reliably deliver
  // inbound messages). Do NOT transfer the buffer, so the fallback copy stays valid.
  const w = worker;
  return new Promise<IngestResult>((resolve, reject) => {
    let done = false;
    const settle = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pending.delete(id);
      fn();
    };
    const timer = setTimeout(async () => {
      // Worker didn't respond in time — parse synchronously as a safety net.
      try {
        const r = runSync(kind, data);
        settle(() => resolve(r));
      } catch (e) {
        settle(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    }, 2500);

    pending.set(id, {
      resolve: (r) => settle(() => resolve(r)),
      reject: (e) => settle(() => reject(e)),
    });
    w.postMessage({ id, kind, buffer: kind === "xlsx" ? data : undefined, text: kind === "csv" ? data : undefined });
  });
}
