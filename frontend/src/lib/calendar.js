/** Office calendar helpers — categories, months, grid math, lane packing, recurrence. */

export const CALENDAR_CATEGORIES = [
  { id: "consultation", label: "Consultation", color: "#0B3A8F", soft: "rgba(11,58,143,0.16)" },
  { id: "job", label: "Project / Job", color: "#C9A227", soft: "rgba(201,162,39,0.22)" },
  { id: "reminder", label: "Reminder", color: "#7C3AED", soft: "rgba(124,58,237,0.16)" },
  { id: "todo", label: "To Do", color: "#059669", soft: "rgba(5,150,105,0.16)" },
  { id: "time_off", label: "Time Off", color: "#DC2626", soft: "rgba(220,38,38,0.16)" },
  { id: "custom", label: "Custom", color: "#EA580C", soft: "rgba(234,88,12,0.16)" },
];

export const CATEGORY_BY_ID = Object.fromEntries(CALENDAR_CATEGORIES.map((c) => [c.id, c]));

export const RECURRENCE_OPTIONS = [
  { id: "none", label: "Does not repeat" },
  { id: "daily", label: "Daily" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];

/** Decorative month pages currently shipped with the app. */
export const CALENDAR_MONTHS = [
  {
    key: "2026-10",
    year: 2026,
    month: 10, // 1-based
    label: "October 2026",
    src: "/brand/calendar/2026-10.jpg",
    // Fraction of the artwork occupied by the interactive date grid (below weekday headers).
    grid: { top: 0.398, bottom: 0.925, left: 0.048, right: 0.048 },
  },
  {
    key: "2026-11",
    year: 2026,
    month: 11,
    label: "November 2026",
    src: "/brand/calendar/2026-11.jpg",
    grid: { top: 0.398, bottom: 0.925, left: 0.048, right: 0.048 },
  },
  {
    key: "2026-12",
    year: 2026,
    month: 12,
    label: "December 2026",
    src: "/brand/calendar/2026-12.jpg",
    grid: { top: 0.398, bottom: 0.925, left: 0.048, right: 0.048 },
  },
];

export function calendarRange() {
  const first = CALENDAR_MONTHS[0];
  const last = CALENDAR_MONTHS[CALENDAR_MONTHS.length - 1];
  const start = `${first.key}-01`;
  const endDay = daysInMonth(last.year, last.month);
  const end = `${last.key}-${String(endDay).padStart(2, "0")}`;
  return { start, end };
}

/** Format a local Date or YMD string without UTC shift. */
export function ymd(date) {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    return date.slice(0, 10);
  }
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYmd(value) {
  const [y, m, d] = String(value || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function addDays(dateStr, days) {
  const d = parseYmd(dateStr);
  if (!d) return dateStr;
  d.setDate(d.getDate() + days);
  return ymd(d);
}

export function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

/** Sunday-first grid cells for a month (null = empty leading/trailing). */
export function buildMonthCells(year, month1) {
  const first = new Date(year, month1 - 1, 1);
  const startPad = first.getDay(); // 0=Sun
  const total = daysInMonth(year, month1);
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let day = 1; day <= total; day += 1) {
    cells.push({ day, date: ymd(new Date(year, month1 - 1, day)) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 35) cells.push(null); // keep 5 rows for art alignment
  return cells;
}

export function eventOverlapsDay(event, dateStr) {
  return event.start_date <= dateStr && event.end_date >= dateStr;
}

export function eventsForDay(events, dateStr) {
  return (events || []).filter((e) => eventOverlapsDay(e, dateStr)).sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date.localeCompare(b.start_date);
    return String(a.title).localeCompare(String(b.title));
  });
}

export function eventSpanDays(event) {
  const a = parseYmd(event.start_date);
  const b = parseYmd(event.end_date || event.start_date);
  if (!a || !b) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/**
 * Expand recurring masters into concrete occurrences that touch [rangeStart, rangeEnd].
 * Each occurrence keeps source_id pointing at the master event id.
 */
export function expandEvents(events, rangeStart, rangeEnd) {
  const out = [];
  for (const ev of events || []) {
    const recurrence = (ev.recurrence || "none").toLowerCase();
    const span = eventSpanDays(ev);
    const until = (ev.recurrence_until || rangeEnd).slice(0, 10);
    const hardEnd = until < rangeEnd ? until : rangeEnd;

    if (!recurrence || recurrence === "none") {
      if (ev.start_date <= rangeEnd && (ev.end_date || ev.start_date) >= rangeStart) {
        out.push({ ...ev, source_id: ev.id, occurrence_date: ev.start_date });
      }
      continue;
    }

    let cursor = ev.start_date.slice(0, 10);
    // Walk back if a long span started before the visible window.
    let guard = 0;
    while (cursor <= hardEnd && guard < 800) {
      guard += 1;
      const occEnd = addDays(cursor, span - 1);
      if (cursor <= rangeEnd && occEnd >= rangeStart && cursor >= ev.start_date.slice(0, 10) && cursor <= hardEnd) {
        out.push({
          ...ev,
          id: `${ev.id}__${cursor}`,
          source_id: ev.id,
          occurrence_date: cursor,
          start_date: cursor,
          end_date: occEnd,
        });
      }
      if (recurrence === "daily") {
        cursor = addDays(cursor, 1);
      } else if (recurrence === "monthly") {
        const d = parseYmd(cursor);
        const day = d.getDate();
        d.setMonth(d.getMonth() + 1);
        // Clamp to last day of month (e.g. Jan 31 → Feb 28).
        const dim = daysInMonth(d.getFullYear(), d.getMonth() + 1);
        d.setDate(Math.min(day, dim));
        cursor = ymd(d);
      } else if (recurrence === "yearly") {
        const d = parseYmd(cursor);
        d.setFullYear(d.getFullYear() + 1);
        cursor = ymd(d);
      } else {
        break;
      }
      if (cursor > hardEnd) break;
    }
  }
  return out.sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date.localeCompare(b.start_date);
    return String(a.title).localeCompare(String(b.title));
  });
}

/**
 * Pack event chips/bars into lanes for one month page.
 * Single-day and multi-day both return positioned segments so titles always render on the grid.
 * Returns { lanes: number, bars: [{event, lane, startCol, endCol, row, single}] }
 */
export function packMonthBars(events, year, month1) {
  const cells = buildMonthCells(year, month1);
  const monthStart = ymd(new Date(year, month1 - 1, 1));
  const monthEnd = ymd(new Date(year, month1, 0));
  const relevant = (events || []).filter((e) => e.start_date <= monthEnd && e.end_date >= monthStart);

  const dateToIndex = new Map();
  cells.forEach((c, idx) => {
    if (c) dateToIndex.set(c.date, idx);
  });

  const sorted = [...relevant].sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date.localeCompare(b.start_date);
    return b.end_date.localeCompare(a.end_date);
  });

  const bars = [];
  const laneEnds = []; // last occupied cell index per lane

  for (const event of sorted) {
    const clippedStart = event.start_date < monthStart ? monthStart : event.start_date;
    const clippedEnd = event.end_date > monthEnd ? monthEnd : event.end_date;
    let startIdx = dateToIndex.get(clippedStart);
    let endIdx = dateToIndex.get(clippedEnd);
    if (startIdx == null || endIdx == null) continue;

    let cursor = startIdx;
    while (cursor <= endIdx) {
      const row = Math.floor(cursor / 7);
      const rowEnd = row * 7 + 6;
      const segEnd = Math.min(endIdx, rowEnd);
      const startCol = cursor % 7;
      const endCol = segEnd % 7;
      const single = event.start_date === event.end_date;

      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] >= cursor) lane += 1;
      if (lane === laneEnds.length) laneEnds.push(-1);
      laneEnds[lane] = segEnd;

      bars.push({
        event,
        lane,
        row,
        startCol,
        endCol,
        single,
        key: `${event.id}-${row}-${startCol}`,
      });
      cursor = segEnd + 1;
    }
  }

  return { lanes: Math.max(laneEnds.length, 1), bars };
}

export function currentMonthKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function resolveFocusMonthKey(now = new Date()) {
  const key = currentMonthKey(now);
  const keys = CALENDAR_MONTHS.map((m) => m.key);
  if (keys.includes(key)) return key;
  // Before Oct 2026 → October; after Dec 2026 → December
  if (key < keys[0]) return keys[0];
  return keys[keys.length - 1];
}

/** Default create-date: stay inside the printed calendar window. */
export function defaultCalendarDate(preferred, now = new Date()) {
  const { start, end } = calendarRange();
  if (preferred && preferred >= start && preferred <= end) return preferred;
  const today = ymd(now);
  if (today >= start && today <= end) return today;
  const focus = resolveFocusMonthKey(now);
  return `${focus}-01`;
}

export function monthKeyFromDate(dateStr) {
  return String(dateStr || "").slice(0, 7);
}
