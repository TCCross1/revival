import { useEffect, useRef, useState } from "react";
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

export default function DollyAssistant({ openByDefault = true }) {
  const [open, setOpen] = useState(openByDefault);
  const [greeting, setGreeting] = useState(
    "Hey honey — I'm Dolly. Ask me anything about Revival Pro.",
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const bottomRef = useRef(null);
  const sessionId = useRef(`dolly-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/public/dolly");
        if (!alive) return;
        if (data?.greeting) setGreeting(data.greeting);
        setMessages([{ role: "dolly", text: data?.greeting || greeting }]);
      } catch {
        if (alive) setMessages([{ role: "dolly", text: greeting }]);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

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
      setMessages((prev) => [...prev, { role: "dolly", text: data?.reply || "I'm right here — try asking another way." }]);
    } catch {
      setMessages((prev) => [...prev, { role: "dolly", text: "I hit a snag, sugar. Try that question one more time." }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid="dolly-open-btn"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-full bg-[#0B3A8F] text-white pl-2 pr-4 py-2 shadow-lg border border-[#C9A227]/60 hover:bg-[#082C73]"
      >
        <img src="/brand/dolly.png" alt="" className="h-12 w-12 rounded-full object-cover border-2 border-[#C9A227]" />
        <span className="text-sm font-semibold font-['Outfit']">Ask Dolly</span>
      </button>
    );
  }

  return (
    <section
      data-testid="dolly-assistant"
      className="fixed bottom-4 right-4 z-50 w-[min(100vw-1.5rem,22rem)] overflow-hidden rounded-2xl border border-[#C9A227]/50 bg-white shadow-2xl"
    >
      <header className="flex items-center gap-3 bg-[#0B3A8F] px-3 py-3 text-white">
        <img src="/brand/dolly.png" alt="Dolly" className="h-14 w-14 rounded-full object-cover border-2 border-[#C9A227] bg-[#082C73]" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold font-['Outfit'] text-lg leading-tight flex items-center gap-1.5">
            Dolly <Sparkles size={14} className="text-[#C9A227]" />
          </div>
          <div className="text-xs text-white/80">Your Revival Pro guide</div>
        </div>
        <button type="button" aria-label="Close Dolly" data-testid="dolly-close-btn" onClick={() => setOpen(false)} className="rounded-md p-1.5 hover:bg-white/10">
          <X size={18} />
        </button>
      </header>

      <div className="max-h-72 space-y-2 overflow-y-auto bg-[#F8FAFC] px-3 py-3">
        {messages.map((m, i) => (
          <div
            key={`${m.role}-${i}`}
            className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
              m.role === "you"
                ? "ml-8 bg-[#0B3A8F] text-white"
                : "mr-4 bg-white border border-slate-200 text-[#061A23]"
            }`}
          >
            {m.text}
          </div>
        ))}
        {busy ? (
          <div className="mr-4 flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm text-[#4B6370]">
            <Loader2 size={14} className="animate-spin" /> Dolly is thinking…
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-slate-100 bg-white px-3 py-2">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => ask(q)}
            className="rounded-full border border-[#0B3A8F]/20 bg-[#F4F6FA] px-2.5 py-1 text-[11px] font-medium text-[#0B3A8F] hover:bg-[#0B3A8F]/10"
          >
            {q}
          </button>
        ))}
      </div>

      <form
        className="flex gap-2 border-t border-slate-100 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <Input
          data-testid="dolly-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Dolly about the app…"
          className="h-10"
        />
        <Button type="submit" data-testid="dolly-send-btn" disabled={busy || !input.trim()} className="h-10 bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23]">
          <Send size={16} />
        </Button>
      </form>
    </section>
  );
}
