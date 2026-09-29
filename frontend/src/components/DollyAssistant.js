import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send, Sparkles, X } from "lucide-react";

const QUICK = [
  "How do I import a proposal?",
  "What is the job sheet?",
  "How do I scan a kitchen or bath?",
  "Who can sign in?",
];

const POS_KEY = "dolly-widget-pos";
const FAB_SIZE = 64;
const PANEL_W = 320;
const PANEL_H = 420;
const DRAG_THRESHOLD = 8;

function defaultPos() {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  return {
    x: Math.max(16, window.innerWidth - FAB_SIZE - 20),
    y: Math.max(16, window.innerHeight - FAB_SIZE - 20),
  };
}

function clampPos(x, y, open = false) {
  if (typeof window === "undefined") return { x, y };
  const w = open ? PANEL_W : FAB_SIZE;
  const h = open ? PANEL_H : FAB_SIZE;
  const maxX = Math.max(8, window.innerWidth - w - 8);
  const maxY = Math.max(8, window.innerHeight - h - 8);
  return {
    x: Math.min(Math.max(8, x), maxX),
    y: Math.min(Math.max(8, y), maxY),
  };
}

function loadPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return defaultPos();
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return defaultPos();
    return clampPos(parsed.x, parsed.y, false);
  } catch (err) {
    console.error("[dolly] failed to load widget position", err);
    return defaultPos();
  }
}

export default function DollyAssistant() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(() => loadPos());
  const [greeting] = useState(
    "Hey honey — I'm Dolly. Ask me anything about Revival Pro.",
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const bottomRef = useRef(null);
  const sessionId = useRef(`dolly-${Math.random().toString(36).slice(2, 10)}`);
  const openRef = useRef(open);
  openRef.current = open;
  const posRef = useRef(pos);
  posRef.current = pos;
  const drag = useRef(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/public/dolly");
        if (!alive) return;
        const text = data?.greeting || greeting;
        setMessages([{ role: "dolly", text }]);
      } catch (err) {
        console.error("[dolly] greeting load failed", err);
        if (alive) setMessages([{ role: "dolly", text: greeting }]);
      }
    })();
    return () => { alive = false; };
  }, [greeting]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    const onResize = () => {
      const next = clampPos(posRef.current.x, posRef.current.y, openRef.current);
      posRef.current = next;
      setPos(next);
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(next));
      } catch (err) {
        console.error("[dolly] failed to persist position", err);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const persistPos = useCallback((next) => {
    posRef.current = next;
    setPos(next);
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(next));
    } catch (err) {
      console.error("[dolly] failed to persist position", err);
    }
  }, []);

  const endDragListeners = useCallback(() => {
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWindowPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      // Only cancel default once a real drag starts so a tap can still open.
      try { e.preventDefault(); } catch { /* ignore */ }
    }
    const next = clampPos(d.originX + dx, d.originY + dy, openRef.current);
    d.lastX = next.x;
    d.lastY = next.y;
    setPos(next);
  }, []);

  const onWindowPointerUp = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);
    if (d.moved) {
      suppressClick.current = true;
      persistPos(clampPos(d.lastX, d.lastY, openRef.current));
      window.setTimeout(() => { suppressClick.current = false; }, 50);
      return;
    }
    // Open on pointerup when the FAB was pressed without dragging.
    // Do not rely on click — preventDefault during drag would cancel it.
    if (d.fromFab && !openRef.current && !suppressClick.current) {
      const next = clampPos(posRef.current.x, posRef.current.y, true);
      persistPos(next);
      setOpen(true);
    }
  }, [onWindowPointerMove, persistPos]);

  const startDrag = (e, { fromFab = false } = {}) => {
    if (e.button != null && e.button !== 0) return;
    drag.current = {
      moved: false,
      fromFab,
      startX: e.clientX,
      startY: e.clientY,
      originX: posRef.current.x,
      originY: posRef.current.y,
      lastX: posRef.current.x,
      lastY: posRef.current.y,
    };
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
  };

  useEffect(() => () => endDragListeners(), [endDragListeners]);

  const openChat = () => {
    if (suppressClick.current || drag.current?.moved) return;
    const next = clampPos(posRef.current.x, posRef.current.y, true);
    persistPos(next);
    setOpen(true);
  };

  const closeChat = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setOpen(false);
    persistPos(clampPos(posRef.current.x, posRef.current.y, false));
  };

  const ask = async (text) => {
    const message = (text || "").trim();
    if (!message || busy) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "you", text: message }]);
    setBusy(true);
    try {
      const { data } = await api.post("/public/dolly/chat", {
        message,
        session_id: sessionId.current,
      });
      setMessages((prev) => [
        ...prev,
        { role: "dolly", text: data?.reply || "I'm right here — try asking another way." },
      ]);
    } catch (err) {
      console.error("[dolly] chat failed", err);
      setMessages((prev) => [
        ...prev,
        { role: "dolly", text: "I hit a snag, sugar. Try that question one more time." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="dolly-widget"
      className="fixed z-[100]"
      style={{ left: pos.x, top: pos.y }}
    >
      {!open ? (
        <button
          type="button"
          data-testid="dolly-open-btn"
          aria-label="Open Dolly assistant"
          onPointerDown={(e) => startDrag(e, { fromFab: true })}
          onClick={(e) => {
            if (suppressClick.current || drag.current?.moved) {
              e.preventDefault();
              return;
            }
            openChat();
          }}
          className="h-16 w-16 rounded-full overflow-hidden border-[3px] border-[#C9A227] shadow-[0_8px_28px_rgba(11,58,143,0.45)] bg-[#0B3A8F] ring-2 ring-white/80 hover:scale-105 transition-transform cursor-grab active:cursor-grabbing"
        >
          <img
            src="/brand/dolly.png"
            alt="Dolly"
            draggable={false}
            className="h-full w-full object-cover object-top pointer-events-none"
          />
        </button>
      ) : (
        <section
          data-testid="dolly-assistant"
          className="w-[min(100vw-1rem,20rem)] overflow-hidden rounded-2xl border border-[#C9A227]/55 bg-white shadow-2xl"
        >
          <header
            data-testid="dolly-drag-handle"
            onPointerDown={(e) => startDrag(e, { fromFab: false })}
            className="flex items-center gap-2.5 bg-[#0B3A8F] px-2.5 py-2.5 text-white cursor-grab active:cursor-grabbing"
          >
            <img
              src="/brand/dolly.png"
              alt="Dolly"
              draggable={false}
              className="h-11 w-11 rounded-full object-cover object-top border-2 border-[#C9A227] bg-[#082C73] pointer-events-none"
            />
            <div className="min-w-0 flex-1 pointer-events-none">
              <div className="font-semibold font-['Outfit'] text-base leading-tight flex items-center gap-1.5">
                Dolly <Sparkles size={13} className="text-[#C9A227]" />
              </div>
              <div className="text-[11px] text-white/80">Drag me anywhere · Your guide</div>
            </div>
            <button
              type="button"
              aria-label="Close Dolly"
              data-testid="dolly-close-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={closeChat}
              className="rounded-md p-1.5 hover:bg-white/10 cursor-pointer touch-auto"
            >
              <X size={16} />
            </button>
          </header>

          <div className="max-h-48 space-y-2 overflow-y-auto bg-[#F8FAFC] px-2.5 py-2.5">
            {messages.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={`rounded-xl px-2.5 py-1.5 text-[13px] leading-relaxed ${
                  m.role === "you"
                    ? "ml-6 bg-[#0B3A8F] text-white"
                    : "mr-3 bg-white border border-slate-200 text-[#061A23]"
                }`}
              >
                {m.text}
              </div>
            ))}
            {busy ? (
              <div className="mr-3 flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-2.5 py-1.5 text-[13px] text-[#4B6370]">
                <Loader2 size={13} className="animate-spin" /> Dolly is thinking…
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <div className="flex flex-wrap gap-1 border-t border-slate-100 bg-white px-2.5 py-1.5">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                data-testid="dolly-quick-chip"
                disabled={busy}
                onClick={() => ask(q)}
                className="rounded-full border border-[#0B3A8F]/20 bg-[#F4F6FA] px-2 py-0.5 text-[10px] font-medium text-[#0B3A8F] hover:bg-[#0B3A8F]/10"
              >
                {q}
              </button>
            ))}
          </div>

          <form
            className="flex gap-1.5 border-t border-slate-100 bg-white p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <Input
              data-testid="dolly-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Dolly…"
              className="h-9 text-sm"
            />
            <Button
              type="submit"
              data-testid="dolly-send-btn"
              disabled={busy || !input.trim()}
              className="h-9 w-9 shrink-0 p-0 bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23]"
            >
              <Send size={14} />
            </Button>
          </form>
        </section>
      )}
    </div>
  );
}
