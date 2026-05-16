/**
 * Timezone utilities — all deadlines are treated as America/Los_Angeles (Pacific).
 */

const PACIFIC_TZ = "America/Los_Angeles";

/**
 * Converts a naive datetime-local string (e.g. "2024-06-15T20:00") to an ISO
 * string with the correct Pacific timezone offset. This ensures the stored
 * timestamptz in Postgres represents the intended Pacific time.
 */
export function toPacificISO(datetimeLocal: string): string {
  // Normalize: ensure we have seconds but not duplicated
  const normalized = datetimeLocal.length === 16
    ? `${datetimeLocal}:00`  // "2024-06-15T20:00" -> add seconds
    : datetimeLocal;          // already has seconds like "2024-06-15T20:00:00"

  // We need the Pacific offset for this specific date (handles DST).
  // Create a Date from the naive string — on the server this interprets as UTC,
  // but we only use it to determine whether DST is active for that calendar date.
  const naive = new Date(datetimeLocal);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TZ,
    timeZoneName: "shortOffset",
  });

  const parts = formatter.formatToParts(naive);
  const offsetPart = parts.find((p) => p.type === "timeZoneName");
  // offsetPart.value is like "GMT-7" or "GMT-8"
  const offsetMatch = offsetPart?.value?.match(/GMT([+-]\d+)/);

  let offsetStr = "-08:00"; // fallback to PST
  if (offsetMatch) {
    const hours = parseInt(offsetMatch[1], 10);
    const sign = hours >= 0 ? "+" : "-";
    offsetStr = `${sign}${String(Math.abs(hours)).padStart(2, "0")}:00`;
  }

  return `${normalized}${offsetStr}`;
}

/**
 * Formats a deadline (ISO/timestamptz string) for display in Pacific time.
 */
export function formatPacificDeadline(deadline: string): string {
  const date = new Date(deadline);
  return date.toLocaleString("en-US", {
    timeZone: PACIFIC_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Converts a stored deadline to a datetime-local value string in Pacific time
 * for pre-filling edit forms.
 */
export function toPacificDatetimeLocal(deadline: string): string {
  const date = new Date(deadline);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
