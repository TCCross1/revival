import {
  buildMonthCells,
  defaultCalendarDate,
  expandEvents,
  packMonthBars,
  resolveFocusMonthKey,
  eventsForDay,
} from "./calendar";

test("October 2026 starts on Thursday", () => {
  const cells = buildMonthCells(2026, 10);
  expect(cells.slice(0, 4)).toEqual([null, null, null, null]);
  expect(cells[4]).toEqual({ day: 1, date: "2026-10-01" });
  expect(cells[4 + 30]).toEqual({ day: 31, date: "2026-10-31" });
});

test("focus month is October before Oct 2026 and December after", () => {
  expect(resolveFocusMonthKey(new Date(2026, 8, 11))).toBe("2026-10"); // Sep
  expect(resolveFocusMonthKey(new Date(2026, 10, 15))).toBe("2026-11");
  expect(resolveFocusMonthKey(new Date(2027, 1, 1))).toBe("2026-12");
});

test("default create date stays inside printed calendar months", () => {
  expect(defaultCalendarDate(null, new Date(2026, 8, 11))).toBe("2026-10-01");
  expect(defaultCalendarDate("2026-11-11", new Date(2026, 8, 11))).toBe("2026-11-11");
  expect(defaultCalendarDate("2026-09-11", new Date(2026, 8, 11))).toBe("2026-10-01");
});

test("multi-day job packs a horizontal bar across Mon–Fri", () => {
  const events = [
    {
      id: "1",
      category: "job",
      title: "Kitchen remodel",
      start_date: "2026-10-12",
      end_date: "2026-10-16",
    },
  ];
  const { bars } = packMonthBars(events, 2026, 10);
  expect(bars).toHaveLength(1);
  expect(bars[0].startCol).toBe(1); // Monday
  expect(bars[0].endCol).toBe(5); // Friday
  expect(eventsForDay(events, "2026-10-14")).toHaveLength(1);
  expect(eventsForDay(events, "2026-10-17")).toHaveLength(0);
});

test("single-day reminder packs a visible chip on that date", () => {
  const events = [
    {
      id: "bday",
      category: "reminder",
      title: "Tony's Birthday",
      start_date: "2026-11-11",
      end_date: "2026-11-11",
    },
  ];
  const { bars } = packMonthBars(events, 2026, 11);
  expect(bars).toHaveLength(1);
  expect(bars[0].single).toBe(true);
  expect(bars[0].event.title).toBe("Tony's Birthday");
  // Nov 1 2026 is Sunday → Nov 11 is Wednesday col 3, row 1
  expect(bars[0].startCol).toBe(3);
  expect(bars[0].row).toBe(1);
});

test("yearly recurrence expands birthday onto Nov 11 within range", () => {
  const masters = [
    {
      id: "bday",
      category: "reminder",
      title: "Tony's Birthday",
      start_date: "2026-11-11",
      end_date: "2026-11-11",
      recurrence: "yearly",
      recurrence_until: "2030-12-31",
    },
  ];
  const expanded = expandEvents(masters, "2026-10-01", "2026-12-31");
  expect(expanded).toHaveLength(1);
  expect(expanded[0].start_date).toBe("2026-11-11");
  expect(expanded[0].title).toBe("Tony's Birthday");
});

test("monthly recurrence fills each month in the window", () => {
  const masters = [
    {
      id: "rent",
      category: "reminder",
      title: "Rent due",
      start_date: "2026-10-01",
      end_date: "2026-10-01",
      recurrence: "monthly",
      recurrence_until: "2026-12-31",
    },
  ];
  const expanded = expandEvents(masters, "2026-10-01", "2026-12-31");
  expect(expanded.map((e) => e.start_date)).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
});
