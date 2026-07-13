/// <reference lib="webworker" />
// Off-main-thread ingest: parses the uploaded workbook/CSV and runs the full
// prepare pipeline so the UI never freezes while loading large files.
import { ingestArrayBuffer, ingestCsvText, IngestResult } from "@/lib/pipeline";

interface RequestMsg {
  id: number;
  kind: "xlsx" | "csv";
  buffer?: ArrayBuffer;
  text?: string;
}
type ResponseMsg =
  | { id: number; ok: true; result: IngestResult }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Use addEventListener (not ctx.onmessage): Turbopack's worker bootstrap may set
// self.onmessage for its own module RPC, which would otherwise clobber ours and
// swallow inbound jobs. A registered listener coexists with the wrapper.
ctx.addEventListener("message", (e: MessageEvent<RequestMsg>) => {
  const data = e.data;
  if (!data || typeof data.id !== "number") return; // ignore bootstrap/internal msgs
  const { id, kind, buffer, text } = data;
  try {
    const result =
      kind === "csv" ? ingestCsvText(text ?? "") : ingestArrayBuffer(buffer as ArrayBuffer);
    const msg: ResponseMsg = { id, ok: true, result };
    ctx.postMessage(msg);
  } catch (err) {
    const msg: ResponseMsg = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    ctx.postMessage(msg);
  }
});

// Signal readiness AFTER our listener is installed so the client only sends jobs
// once Turbopack's worker bootstrap has finished.
ctx.postMessage({ ready: true });
