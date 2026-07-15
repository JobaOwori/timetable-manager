import { describe, it, expect } from "vitest";
import { subjectFamilyKey, sameSubjectFamily } from "@/lib/subjectGroup";

describe("subject family classification", () => {
  it("collapses qualifier/level/variant prefixes to one family", () => {
    const pairs: [string, string][] = [
      ["Entrepreneurship Skills", "IT Entrepreneurship Skills"],
      ["Research Methods", "Business Research Methods"],
      ["Research Methods", "Marketing Research Methods"],
      ["Communication Skills", "Professional Communication Skills"],
      ["Financial Accounting", "Fundamentals of Financial Accounting"],
      ["Programming in Python", "Python Programming - Lab"],
      ["Programming in C", "C Programming Theory"],
      ["Human Resource Management", "Principles of Human Resource Management"],
      ["Financial & Management Accounting", "Financial and Management Accounting"],
      ["Basics of Computer Application", "Computer Application in Business"],
    ];
    for (const [a, b] of pairs) {
      expect(sameSubjectFamily(a, b)).toBe(true);
    }
  });

  it("normalises common synonyms/abbreviations", () => {
    expect(sameSubjectFamily("Introduction to IoT", "Internet of Things")).toBe(true);
    expect(sameSubjectFamily("HRM", "Human Resource Management")).toBe(true);
    expect(sameSubjectFamily("Artificial Intelligence", "AI")).toBe(true);
  });

  it("keeps genuinely different subjects distinct", () => {
    const pairs: [string, string][] = [
      ["Human Anatomy and character design", "Interventional Imaging Technology"],
      ["Principles of Human Resource Management", "Corporate and Business Law"],
      ["Digital Marketing Strategies", "Fundamentals of Artificial Intelligence"],
      ["Introduction to IoT", "Fundamentals of Networking - Theory"],
      ["Global Financial Markets", "Oil & Gas Economics"],
      ["Discrete Mathematics", "Microeconomics"],
      ["Cost and Management Accounting", "Environmental Economics"],
    ];
    for (const [a, b] of pairs) {
      expect(sameSubjectFamily(a, b)).toBe(false);
    }
  });

  it("returns null for empty or qualifier-only names", () => {
    expect(subjectFamilyKey(null)).toBeNull();
    expect(subjectFamilyKey("")).toBeNull();
    expect(subjectFamilyKey("Lab")).toBeNull();
    expect(subjectFamilyKey("Introduction to")).toBeNull();
  });
});
