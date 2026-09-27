import { BRAND } from "@/lib/format";
import { ClipboardList, TrendingUp, Users } from "lucide-react";

const PITCH_POINTS = [
  { icon: TrendingUp, text: "Track your entire estimate pipeline in dollars" },
  { icon: Users, text: "Keep every client and lead in one simple place" },
  { icon: ClipboardList, text: "Run job costing and invoicing without spreadsheets" },
];

export function AuthBrandMark({ className = "", decorative = false }) {
  return (
    <img
      src={BRAND.logo}
      alt={decorative ? "" : BRAND.name}
      width={1024}
      height={1024}
      decoding="async"
      draggable="false"
      className={className}
    />
  );
}

export default function AuthSplitLayout({ children, pitch = false }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 font-['Work_Sans']">
      <aside className="relative hidden lg:flex flex-col items-center justify-center overflow-y-auto bg-[#0B3A8F] px-8 py-10">
        <AuthBrandMark
          decorative
          className="w-full max-w-[28rem] h-auto select-none"
        />
        {pitch ? (
          <div className="relative mt-2 max-w-lg space-y-5 text-center">
            <h1 className="text-4xl lg:text-5xl font-semibold text-white font-['Outfit'] tracking-tight leading-tight">Capture. Organize. Close.</h1>
            <p className="text-white/85 text-lg">The all-in-one command center for your remodeling business — from first lead to final invoice.</p>
            <div className="space-y-4 text-left">
              {PITCH_POINTS.map((f) => (
                <div key={f.text} className="flex items-center gap-3 text-white/92">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#C9A227] text-[#061A23]"><f.icon size={20} /></span>
                  <span>{f.text}</span>
                </div>
              ))}
            </div>
            <div className="text-white/50 text-sm">© 2026 {BRAND.name}</div>
          </div>
        ) : null}
      </aside>

      <div className="flex items-center justify-center p-8 bg-[#F4F6FA]">
        <div className="w-full max-w-md">
          <AuthBrandMark className="mx-auto mb-8 w-full max-w-[16rem] h-auto object-contain lg:hidden" />
          {children}
        </div>
      </div>
    </div>
  );
}
