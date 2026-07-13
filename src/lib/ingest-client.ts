"use client";

// Ingest runner. Parsing a workbook now takes on the order of ~150ms even for a
// ~1,000-session sheet (we trim the inflated worksheet range in lib/ingest), so
// we no longer need a Web Worker. We simply yield once so the loading spinner can
// paint, then parse. This is fully reliable across environments (no bundler
// worker quirks) and imperceptible to the user.
import { IngestResult, ingestArrayBuffer, ingestCsvText } from "@/lib/pipeline";

/** Yield to the event loop so the spinner paints before the (brief) parse. */
const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function ingestFile(
  kind: "xlsx" | "csv",
  data: ArrayBuffer | string,
): Promise<IngestResult> {
  await nextTick();
  return kind === "csv" ? ingestCsvText(data as string) : ingestArrayBuffer(data as ArrayBuffer);
}
