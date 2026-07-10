import { describe, it, expect } from "vitest";
import {
  normalizeDay, parseTimeRange, normalizeLecturer, normalizeRoom, normalizeCode, isBlank,
} from "@/lib/clean";

describe("clean", () => {
  it("normalizes day variants", () => {
    expect(normalizeDay("MON")).toBe("MON");
    expect(normalizeDay("Monday")).toBe("MON");
    expect(normalizeDay("THUR")).toBe("THU");
    expect(normalizeDay("Thursday")).toBe("THU");
    expect(normalizeDay("wed")).toBe("WED");
    expect(normalizeDay(null)).toBeNull();
    expect(normalizeDay("Funday")).toBeNull();
  });

  it("parses time ranges", () => {
    expect(parseTimeRange("11:05AM - 1:00PM")).toEqual({ startMin: 665, endMin: 780, error: null });
    expect(parseTimeRange("2:00PM-3:55PM")).toEqual({ startMin: 840, endMin: 955, error: null });
    expect(parseTimeRange(null).error).toBe("missing");
    expect(parseTimeRange("n").error).toBe("unparseable");
    expect(parseTimeRange("11:05PM - 1:00PM").error).toBe("end_before_start");
  });

  it("treats placeholder lecturers as unassigned", () => {
    expect(normalizeLecturer("X")).toBeNull();
    expect(normalizeLecturer("TBA")).toBeNull();
    expect(normalizeLecturer("  ")).toBeNull();
    expect(normalizeLecturer("Jane Doe ")).toBe("Jane Doe");
  });

  it("flags virtual rooms and cleans codes", () => {
    expect(normalizeRoom("ONLINE")).toEqual({ room: "ONLINE", isVirtual: true });
    expect(normalizeRoom(206)).toEqual({ room: "206", isVirtual: false });
    expect(normalizeCode(206.0)).toBe("206");
    expect(normalizeCode("206.0")).toBe("206");
  });

  it("isBlank handles NaN/empty", () => {
    expect(isBlank(NaN)).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank(0)).toBe(false);
    expect(isBlank("x")).toBe(false);
  });
});
