import { useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Grid2x2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

function tabClass(active) {
  return [
    "rp-phone-tab flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 py-1",
    "text-[10px] font-semibold tracking-[0.04em] uppercase font-['Outfit']",
    active ? "text-[#F0D078]" : "text-white/75",
  ].join(" ");
}

export default function PhoneTabBar({ primaryItems, moreItems, fieldShell }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  const moreActive = useMemo(() => {
    if (!moreItems?.length) return false;
    return moreItems.some((item) => {
      if (item.end) return location.pathname === item.to;
      return location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
    });
  }, [location.pathname, moreItems]);

  return (
    <>
      <nav
        className={`rp-phone-tabbar ${fieldShell ? "is-field" : ""}`}
        data-testid="phone-tabbar"
        aria-label="Phone navigation"
      >
        {primaryItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-testid={`phone-${item.testid}`}
            className={({ isActive }) => tabClass(isActive)}
          >
            {({ isActive }) => (
              <>
                <span className={`rp-phone-tab-glyph ${isActive ? "is-active" : ""}`}>
                  <item.icon active={isActive} size={20} />
                </span>
                <span className="truncate max-w-full px-0.5">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}

        {moreItems?.length ? (
          <button
            type="button"
            data-testid="phone-nav-more"
            aria-label="More destinations"
            onClick={() => setMoreOpen(true)}
            className={tabClass(moreActive || moreOpen)}
          >
            <span className={`rp-phone-tab-glyph ${moreActive || moreOpen ? "is-active" : ""}`}>
              <Grid2x2 size={20} strokeWidth={1.75} />
            </span>
            <span>More</span>
          </button>
        ) : null}
      </nav>

      {moreItems?.length ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent
            side="bottom"
            className="rp-phone-more-sheet rounded-t-3xl border-[#C9A227]/35 bg-[#0B3A8F] text-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 [&>button]:text-white [&>button]:hover:bg-white/10 [&>button]:opacity-90"
          >
            <SheetHeader className="text-left pb-2 pr-8">
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/35" aria-hidden="true" />
              <SheetTitle className="font-['Outfit'] text-white text-lg">
                All tools
              </SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-3 gap-2 pt-1" data-testid="phone-more-grid">
              {moreItems.map((item) => {
                const active =
                  item.end
                    ? location.pathname === item.to
                    : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
                return (
                  <button
                    key={item.to}
                    type="button"
                    data-testid={`phone-more-${item.testid}`}
                    onClick={() => {
                      setMoreOpen(false);
                      navigate(item.to);
                    }}
                    className={[
                      "flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 border transition-colors",
                      active
                        ? "bg-[#061A23]/45 border-[#C9A227]/70 text-[#F0D078]"
                        : "bg-white/8 border-white/10 text-white/90 hover:bg-white/14",
                    ].join(" ")}
                  >
                    <span className={`rp-phone-tab-glyph ${active ? "is-active" : ""}`}>
                      <item.icon active={active} size={22} />
                    </span>
                    <span className="text-[11px] font-semibold font-['Outfit'] tracking-wide text-center leading-tight">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
