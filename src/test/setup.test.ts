import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { cn } from "@/lib/utils";

describe("project setup", () => {
  it("cn utility merges class names correctly", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
    expect(cn("px-2", "px-4")).toBe("px-4"); // tailwind-merge deduplication
  });

  it("fast-check is available and functional", () => {
    // Feature: fantasy-survivor, Property 0: setup verification
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const result = cn(a, b);
        return typeof result === "string";
      })
    );
  });
});
