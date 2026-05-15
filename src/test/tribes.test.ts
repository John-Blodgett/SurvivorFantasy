import { describe, it, expect } from "vitest";
import { validateCreateTribe, buildTribeEvents } from "@/lib/tribes";

describe("validateCreateTribe", () => {
  it("accepts valid input with name and color", () => {
    const result = validateCreateTribe({ name: "Tika", color: "#3B82F6" });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts valid input with name and empty color", () => {
    const result = validateCreateTribe({ name: "Reba", color: "" });
    expect(result.valid).toBe(true);
  });

  it("rejects empty name", () => {
    const result = validateCreateTribe({ name: "", color: "" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Tribe name is required.");
  });

  it("rejects whitespace-only name", () => {
    const result = validateCreateTribe({ name: "   ", color: "" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Tribe name is required.");
  });

  it("rejects name longer than 50 characters", () => {
    const longName = "a".repeat(51);
    const result = validateCreateTribe({ name: longName, color: "" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Tribe name must be 50 characters or fewer.");
  });

  it("accepts name exactly 50 characters", () => {
    const name = "a".repeat(50);
    const result = validateCreateTribe({ name, color: "" });
    expect(result.valid).toBe(true);
  });

  it("rejects invalid color format", () => {
    const result = validateCreateTribe({ name: "Tika", color: "red" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Color must be a valid hex color (e.g., #FF5733).");
  });

  it("rejects color with wrong length", () => {
    const result = validateCreateTribe({ name: "Tika", color: "#FFF" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Color must be a valid hex color (e.g., #FF5733).");
  });

  it("accepts valid hex color", () => {
    const result = validateCreateTribe({ name: "Tika", color: "#FF5733" });
    expect(result.valid).toBe(true);
  });

  it("accepts lowercase hex color", () => {
    const result = validateCreateTribe({ name: "Tika", color: "#abcdef" });
    expect(result.valid).toBe(true);
  });
});

describe("buildTribeEvents", () => {
  it("returns correct number of events", () => {
    const events = buildTribeEvents("ep-1", ["c1", "c2", "c3"], "rule-1", 5);
    expect(events).toHaveLength(3);
  });

  it("preserves all castaway IDs", () => {
    const castawayIds = ["c1", "c2", "c3"];
    const events = buildTribeEvents("ep-1", castawayIds, "rule-1", 5);
    const resultIds = events.map((e) => e.castaway_id);
    expect(resultIds).toEqual(castawayIds);
  });

  it("sets correct episode_id, scoring_rule_id, and points on all events", () => {
    const events = buildTribeEvents("ep-1", ["c1", "c2"], "rule-1", 3);
    for (const event of events) {
      expect(event.episode_id).toBe("ep-1");
      expect(event.scoring_rule_id).toBe("rule-1");
      expect(event.points).toBe(3);
    }
  });

  it("returns empty array for empty castaway list", () => {
    const events = buildTribeEvents("ep-1", [], "rule-1", 5);
    expect(events).toEqual([]);
  });

  it("handles single castaway", () => {
    const events = buildTribeEvents("ep-1", ["c1"], "rule-1", 10);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      episode_id: "ep-1",
      castaway_id: "c1",
      scoring_rule_id: "rule-1",
      points: 10,
    });
  });
});
