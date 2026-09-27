import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import {
  CALENDAR_CATEGORIES,
  CALENDAR_MONTHS,
  CATEGORY_BY_ID,
  RECURRENCE_OPTIONS,
  buildMonthCells,
  calendarRange,
  defaultCalendarDate,
  eventsForDay,
  expandEvents,
  monthKeyFromDate,
  packMonthBars,
  resolveFocusMonthKey,
  ymd,
} from "@/lib/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";

const EMPTY_FORM = {
  category: "consultation",
  title: "",
  notes: "",
  start_date: "",
  end_date: "",
  recurrence: "none",
  recurrence_until: "",
};

function ColorKey() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-[#C9A227]/35 bg-white/95 px-3 py-2 shadow-sm"
      data-testid="calendar-color-key"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4B6370]">Key</span>
      {CALENDAR_CATEGORIES.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: c.color }}>
          <span className="h-2 w-5 rounded-sm" style={{ background: c.color }} />
          {c.label}
        </span>
      ))}
    </div>
  );
}

function MonthPage({ month, events, onDayClick, onEventClick }) {
  const cells = useMemo(() => buildMonthCells(month.year, month.month), [month.year, month.month]);
  const { lanes, bars } = useMemo(
    () => packMonthBars(events, month.year, month.month),
    [events, month.year, month.month],
  );
  const laneHeight = 15;

  const { top, bottom, left, right } = month.grid;
  const gridHeight = (bottom - top) * 100;
  const gridTop = top * 100;
  const gridLeft = left * 100;
  const gridWidth = (1 - left - right) * 100;
  const rows = Math.max(Math.ceil(cells.length / 7), 5);

  return (
    <section
      className="relative mx-auto w-full max-w-[820px] scroll-mt-24 space-y-3"
      data-testid={`calendar-month-${month.key}`}
      data-month-key={month.key}
      id={`cal-${month.key}`}
    >
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <h2 className="font-['Outfit'] text-lg font-semibold text-[#061A23]">{month.label}</h2>
        <span className="text-[11px] uppercase tracking-[0.12em] text-[#4B6370]">Office calendar</span>
      </div>
      <ColorKey />
      <div className="relative overflow-hidden rounded-xl border border-[#C9A227]/30 bg-[#F7F1E6] shadow-[0_18px_40px_rgba(6,26,35,0.14)]">
        <img
          src={month.src}
          alt={month.label}
          width={792}
          height={1024}
          className="block w-full h-auto select-none pointer-events-none"
          draggable="false"
        />

        {/* Interactive grid overlay aligned to the printed calendar cells */}
        <div
          className="absolute"
          style={{
            top: `${gridTop}%`,
            left: `${gridLeft}%`,
            width: `${gridWidth}%`,
            height: `${gridHeight}%`,
          }}
        >
          <div
            className="relative grid h-full w-full"
            style={{
              gridTemplateColumns: "repeat(7, 1fr)",
              gridTemplateRows: `repeat(${rows}, 1fr)`,
            }}
          >
            {cells.map((cell, idx) => {
              const dayEvents = cell ? eventsForDay(events, cell.date) : [];
              return (
                <button
                  key={`${month.key}-${idx}`}
                  type="button"
                  disabled={!cell}
                  onClick={(e) => {
                    if (!cell) return;
                    if (e.target.closest("[data-cal-bar]")) return;
                    onDayClick(cell.date, dayEvents);
                  }}
                  className={`relative z-0 min-h-0 border border-transparent text-left transition ${
                    cell ? "hover:bg-[#0B3A8F]/08 focus-visible:bg-[#0B3A8F]/10 cursor-pointer" : "cursor-default"
                  }`}
                  aria-label={cell ? cell.date : undefined}
                  data-testid={cell ? `cal-day-${cell.date}` : undefined}
                />
              );
            })}

            {/* Titles + multi-day bars — always painted on the grid so they stay visible */}
            <div className="pointer-events-none absolute inset-0 z-10">
              {bars.map((bar) => {
                const cat = CATEGORY_BY_ID[bar.event.category] || CATEGORY_BY_ID.custom;
                const leftPct = (bar.startCol / 7) * 100;
                const widthPct = ((bar.endCol - bar.startCol + 1) / 7) * 100;
                const topPct = ((bar.row + 0.22 + bar.lane * 0.14) / rows) * 100;
                const title = bar.event.title;
                return (
                  <button
                    key={bar.key}
                    type="button"
                    data-cal-bar="1"
                    data-testid={`cal-event-${bar.event.source_id || bar.event.id}`}
                    className="pointer-events-auto absolute z-10 truncate rounded-md px-1.5 text-left text-[10px] font-semibold shadow-sm"
                    style={{
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      top: `calc(${topPct}% )`,
                      height: laneHeight,
                      lineHeight: `${laneHeight}px`,
                      background: bar.single ? cat.soft : cat.color,
                      color: bar.single ? cat.color : "#fff",
                      border: bar.single ? `1px solid ${cat.color}` : "none",
                    }}
                    title={`${title} (${bar.event.start_date}${bar.event.end_date !== bar.event.start_date ? ` → ${bar.event.end_date}` : ""})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(bar.event);
                    }}
                  >
                    {title}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function OfficeCalendar() {
  const qc = useQueryClient();
  const scrollerRef = useRef(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [visibleMonthKey, setVisibleMonthKey] = useState(() => resolveFocusMonthKey(new Date()));
  const [dayEvents, setDayEvents] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { start: rangeStart, end: rangeEnd } = useMemo(() => calendarRange(), []);

  const { data: rawEvents = [], isLoading } = useQuery({
    queryKey: ["calendar-events", rangeStart, rangeEnd],
    queryFn: async () =>
      (await api.get("/calendar/events", { params: { start: rangeStart, end: rangeEnd } })).data,
  });

  const events = useMemo(
    () => expandEvents(rawEvents, rangeStart, rangeEnd),
    [rawEvents, rangeStart, rangeEnd],
  );

  useEffect(() => {
    const key = resolveFocusMonthKey(new Date());
    const el = document.getElementById(`cal-${key}`);
    if (el) {
      const t = setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    const nodes = CALENDAR_MONTHS.map((m) => document.getElementById(`cal-${m.key}`)).filter(Boolean);
    if (!nodes.length || typeof IntersectionObserver === "undefined") return undefined;
    const ratios = new Map();
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const k = entry.target.getAttribute("data-month-key");
          if (k) ratios.set(k, entry.intersectionRatio);
        });
        let best = null;
        let bestRatio = 0;
        ratios.forEach((ratio, k) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = k;
          }
        });
        if (best) setVisibleMonthKey(best);
      },
      { root: null, threshold: [0.15, 0.35, 0.55, 0.75] },
    );
    nodes.forEach((n) => obs.observe(n));
    return () => obs.disconnect();
  }, []);

  const scrollToMonthForDate = (dateStr) => {
    const key = monthKeyFromDate(dateStr);
    const el = document.getElementById(`cal-${key}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const save = useMutation({
    mutationFn: async (payload) => {
      const body = {
        ...payload,
        end_date: payload.end_date || payload.start_date,
        recurrence: payload.recurrence || "none",
        recurrence_until:
          payload.recurrence && payload.recurrence !== "none"
            ? payload.recurrence_until || rangeEnd
            : null,
      };
      const masterId = editing?.source_id || editing?.id;
      if (masterId && !String(masterId).includes("__")) {
        return (await api.put(`/calendar/events/${masterId}`, body)).data;
      }
      return (await api.post("/calendar/events", body)).data;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
      toast.success(editing ? "Appointment updated" : "Appointment added");
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      if (saved?.start_date) {
        setSelectedDate(saved.start_date);
        setTimeout(() => scrollToMonthForDate(saved.start_date), 80);
      }
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save appointment.")),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/calendar/events/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
      toast.success("Appointment removed");
      setFormOpen(false);
      setDayOpen(false);
      setEditing(null);
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not delete appointment.")),
  });

  const openCreate = (category, dateStr) => {
    const start = defaultCalendarDate(dateStr || selectedDate || `${visibleMonthKey}-01`);
    setEditing(null);
    setSelectedDate(start);
    setForm({
      ...EMPTY_FORM,
      category,
      start_date: start,
      end_date: start,
      recurrence: "none",
      recurrence_until: "",
      title:
        category === "consultation"
          ? "Client consultation"
          : category === "job"
            ? "Job schedule"
            : category === "time_off"
              ? "Time off"
              : "",
    });
    setActionOpen(false);
    setFormOpen(true);
  };

  const openDay = (dateStr, list) => {
    setSelectedDate(dateStr);
    setDayEvents(list);
    setDayOpen(true);
  };

  const openEvent = (ev) => {
    const masterId = ev.source_id || String(ev.id).split("__")[0];
    const master = rawEvents.find((e) => e.id === masterId) || ev;
    setEditing({ ...master, id: masterId, source_id: masterId });
    setForm({
      category: master.category,
      title: master.title,
      notes: master.notes || "",
      start_date: master.start_date,
      end_date: master.end_date,
      recurrence: master.recurrence || "none",
      recurrence_until: master.recurrence_until || "",
    });
    setDayOpen(false);
    setFormOpen(true);
  };

  const addDefaultDate = defaultCalendarDate(selectedDate || `${visibleMonthKey}-01`);

  const syncGoogle = useMutation({
    mutationFn: async () => (await api.post("/calendar/sync-google")).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
      toast.success(`Google Calendar synced · ${data.created || 0} new, ${data.updated || 0} updated`);
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not sync Google Calendar.")),
  });

  return (
    <div className="space-y-5" data-testid="office-calendar-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight flex items-center gap-2">
            <CalendarDays className="text-[#0B3A8F]" /> Calendar
          </h1>
          <p className="text-[#4B6370] mt-1 max-w-2xl">
            Scroll October–December 2026. Sync pulls appointments from the Vapi Google Calendar
            (revivalhomeremodelingllc@gmail.com) onto these pages.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2 border-[#C9A227]/50"
            disabled={syncGoogle.isPending}
            onClick={() => syncGoogle.mutate()}
            data-testid="calendar-sync-google-btn"
          >
            {syncGoogle.isPending ? "Syncing…" : "Sync Google Calendar"}
          </Button>
          <Button
            type="button"
            className="bg-[#0B3A8F] hover:bg-[#082C73] gap-2"
            onClick={() => {
              const d = defaultCalendarDate(selectedDate || `${visibleMonthKey}-01`);
              setSelectedDate(d);
              setActionOpen(true);
            }}
            data-testid="calendar-add-btn"
          >
            <Plus size={16} /> Add to calendar
          </Button>
        </div>
      </div>

      {isLoading ? <div className="text-[#4B6370]">Loading appointments…</div> : null}

      <div
        ref={scrollerRef}
        className="space-y-8 pb-10 overscroll-contain"
        data-testid="calendar-scroll"
      >
        {CALENDAR_MONTHS.map((month) => (
          <MonthPage
            key={month.key}
            month={month}
            events={events}
            onDayClick={(date, list) => {
              setSelectedDate(date);
              if (list.length) openDay(date, list);
              else setActionOpen(true);
            }}
            onEventClick={openEvent}
          />
        ))}
      </div>

      {/* Action picker */}
      <Dialog open={actionOpen} onOpenChange={setActionOpen}>
        <DialogContent className="sm:max-w-md" data-testid="calendar-action-dialog">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">
              {selectedDate ? `Add for ${selectedDate}` : `Add for ${addDefaultDate}`}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-[#4B6370] -mt-1">
            Dates default to the month you are viewing (inside October–December 2026).
          </p>
          <div className="grid gap-2">
            {CALENDAR_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-left hover:bg-slate-50"
                onClick={() => openCreate(c.id, selectedDate || addDefaultDate)}
                data-testid={`calendar-action-${c.id}`}
              >
                <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                <span className="font-medium" style={{ color: c.color }}>
                  {c.id === "consultation"
                    ? "Schedule Consultation"
                    : c.id === "job"
                      ? "Schedule Job"
                      : c.id === "reminder"
                        ? "Schedule a Reminder"
                        : c.id === "todo"
                          ? "To Do list"
                          : c.id === "time_off"
                            ? "Request Time Off"
                            : "Custom"}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Day list */}
      <Dialog open={dayOpen} onOpenChange={setDayOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="calendar-day-dialog">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Day · {selectedDate}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {dayEvents.length === 0 ? (
              <p className="text-sm text-[#4B6370]">Nothing scheduled.</p>
            ) : (
              dayEvents.map((ev) => {
                const cat = CATEGORY_BY_ID[ev.category] || CATEGORY_BY_ID.custom;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    className="flex w-full items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
                    onClick={() => openEvent(ev)}
                  >
                    <span className="mt-1 h-2.5 w-2.5 rounded-full shrink-0" style={{ background: cat.color }} />
                    <span className="min-w-0">
                      <span className="block font-medium" style={{ color: cat.color }}>
                        {ev.title}
                      </span>
                      <span className="block text-xs text-[#4B6370]">
                        {cat.label}
                        {ev.recurrence && ev.recurrence !== "none" ? ` · ${ev.recurrence}` : ""}
                        {ev.start_date !== ev.end_date ? ` · ${ev.start_date} → ${ev.end_date}` : ""}
                      </span>
                    </span>
                    <Pencil size={14} className="ml-auto text-[#4B6370] shrink-0" />
                  </button>
                );
              })
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => { setDayOpen(false); setActionOpen(true); }}>
              Add…
            </Button>
            <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" onClick={() => setDayOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / edit form */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="calendar-form-dialog">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">{editing ? "Edit appointment" : "New appointment"}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const start = form.start_date;
              if (!start || start < rangeStart || start > rangeEnd) {
                toast.error(`Pick a date between ${rangeStart} and ${rangeEnd} so it shows on these calendar pages.`);
                return;
              }
              save.mutate({
                ...form,
                end_date: form.end_date || form.start_date,
              });
            }}
          >
            <div>
              <Label>Category</Label>
              <select
                className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                data-testid="calendar-form-category"
              >
                {CALENDAR_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Title</Label>
              <Input
                className="mt-1 h-11"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder="e.g. Tony's Birthday"
                data-testid="calendar-form-title"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Begin date</Label>
                <Input
                  type="date"
                  className="mt-1 h-11"
                  value={form.start_date}
                  min={rangeStart}
                  max={rangeEnd}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      start_date: e.target.value,
                      end_date:
                        form.end_date && form.end_date < e.target.value
                          ? e.target.value
                          : form.end_date || e.target.value,
                    })
                  }
                  required
                  data-testid="calendar-form-start"
                />
              </div>
              <div>
                <Label>End date</Label>
                <Input
                  type="date"
                  className="mt-1 h-11"
                  value={form.end_date}
                  min={form.start_date || rangeStart}
                  max={rangeEnd}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  data-testid="calendar-form-end"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Recurring</Label>
                <select
                  className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={form.recurrence || "none"}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      recurrence: e.target.value,
                      recurrence_until:
                        e.target.value === "none"
                          ? ""
                          : form.recurrence_until || rangeEnd,
                    })
                  }
                  data-testid="calendar-form-recurrence"
                >
                  {RECURRENCE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {form.recurrence && form.recurrence !== "none" ? (
                <div>
                  <Label>Repeat until</Label>
                  <Input
                    type="date"
                    className="mt-1 h-11"
                    value={form.recurrence_until || ""}
                    min={form.start_date || rangeStart}
                    onChange={(e) => setForm({ ...form, recurrence_until: e.target.value })}
                    data-testid="calendar-form-recurrence-until"
                  />
                </div>
              ) : null}
            </div>
            <div>
              <Label>Notes</Label>
              <textarea
                className="mt-1 min-h-[96px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                data-testid="calendar-form-notes"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              {editing ? (
                <Button
                  type="button"
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50 gap-1"
                  onClick={() => remove.mutate(editing.source_id || editing.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 size={14} /> Delete
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-[#0B3A8F] hover:bg-[#082C73]" disabled={save.isPending} data-testid="calendar-form-save">
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
