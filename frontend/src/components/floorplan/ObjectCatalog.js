import { useEffect, useMemo, useState } from "react";
import { LibraryThumb } from "@/components/floorplan/symbols";
import { libraryGroups } from "@/lib/floorPlan/library";
import { priceLibraryItem } from "@/lib/floorPlan/priceBook";
import { formatFtIn } from "@/lib/floorPlan/units";
import { usd } from "@/lib/format";

const FAVORITES_KEY = "revival.floorplan.favorites";
const SIZE_FILTERS = [
  { id: "all", name: "Any size" },
  { id: "sm", name: "≤ 18\"" },
  { id: "md", name: "21–30\"" },
  { id: "lg", name: "33–48\"" },
  { id: "xl", name: "60\"+" },
];

function loadFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch (err) {
    console.warn("Could not read catalogue favorites", err);
    return [];
  }
}

function sizeOk(item, size) {
  const w = Number(item.width) || 0;
  if (size === "sm") return w <= 18;
  if (size === "md") return w >= 21 && w <= 30;
  if (size === "lg") return w >= 33 && w <= 48;
  if (size === "xl") return w >= 60;
  return true;
}

export default function ObjectCatalog({ placing, onPlace, houseFavorites = [], onToggleFavorite }) {
  const groups = useMemo(() => libraryGroups(), []);
  const [group, setGroup] = useState(groups[0]?.name || "Kitchen");
  const [query, setQuery] = useState("");
  const [subgroup, setSubgroup] = useState("All");
  const [size, setSize] = useState("all");
  const [onlyFav, setOnlyFav] = useState(false);
  const [favorites, setFavorites] = useState(() => loadFavorites());

  useEffect(() => {
    const merged = Array.from(new Set([...favorites, ...houseFavorites]));
    if (merged.length !== favorites.length) setFavorites(merged);
  }, [houseFavorites]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = groups.find((g) => g.name === group)?.items || [];
  const subs = ["All", ...Array.from(new Set(items.map((row) => row.subgroup).filter(Boolean)))];
  const filtered = items.filter((row) => {
    const q = query.trim().toLowerCase();
    const subOk = subgroup === "All" || row.subgroup === subgroup;
    const favOk = !onlyFav || favorites.includes(row.id);
    const text = `${row.name} ${row.id} ${row.subgroup} ${(row.tags || []).join(" ")} ${row.line || ""} ${row.manufacturer || ""}`.toLowerCase();
    return subOk && favOk && sizeOk(row, size) && (!q || text.includes(q));
  });

  const toggleFav = (id, event) => {
    event.stopPropagation();
    const next = favorites.includes(id) ? favorites.filter((row) => row !== id) : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn("Could not save catalogue favorites", err);
    }
    onToggleFavorite?.(id, next);
  };

  return (
    <div className="space-y-2" data-testid="object-library">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0A4D68]">Object catalogue</div>
      <input
        className="h-10 w-full rounded-full border border-slate-200 bg-[#FBF8F2] px-3 text-xs"
        placeholder="Search cabinets, appliances, showers…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="flex gap-1 overflow-x-auto pb-1">
        {groups.map((g) => (
          <button
            key={g.name}
            type="button"
            onClick={() => { setGroup(g.name); setSubgroup("All"); }}
            className={`shrink-0 rounded-full px-2.5 py-1.5 text-[11px] ${group === g.name ? "bg-[#0A4D68] text-white" : "bg-slate-100 text-[#4B6370]"}`}
          >
            {g.name}
          </button>
        ))}
      </div>
      {subs.length > 2 ? (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {subs.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSubgroup(name)}
              className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${subgroup === name ? "bg-[#C9A227] text-[#061A23]" : "bg-[#F4F1EA] text-[#4B6370]"}`}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {SIZE_FILTERS.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => setSize(row.id)}
            className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${size === row.id ? "bg-[#0A4D68] text-white" : "bg-slate-100 text-[#4B6370]"}`}
          >
            {row.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOnlyFav((v) => !v)}
          className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${onlyFav ? "bg-[#C9A227] text-[#061A23]" : "bg-slate-100 text-[#4B6370]"}`}
        >
          Favorites
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {filtered.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPlace(item)}
            className={`rounded-xl border overflow-hidden text-left bg-white min-h-[7.5rem] ${placing?.id === item.id ? "border-[#C9A227] ring-1 ring-[#C9A227]/50" : "border-slate-200"}`}
          >
            <div className="relative px-2 pt-2 bg-white border-b border-slate-100">
              <LibraryThumb item={item} />
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => toggleFav(item.id, e)}
                onKeyDown={(e) => { if (e.key === "Enter") toggleFav(item.id, e); }}
                className={`absolute top-1.5 right-1.5 h-7 w-7 rounded-full text-sm leading-7 text-center ${favorites.includes(item.id) ? "bg-[#C9A227] text-[#061A23]" : "bg-white/90 text-[#8AA0AB] border border-slate-200"}`}
                aria-label="Favorite"
              >
                ★
              </span>
            </div>
            <div className="px-2 py-1.5">
              <div className="text-[11px] font-semibold leading-tight text-[#061A23]">{item.name}</div>
              <div className="text-[10px] text-[#8AA0AB]">
                {formatFtIn(item.width)} × {formatFtIn(item.depth)} × {formatFtIn(item.height)}
              </div>
              <div className="text-[10px] text-[#4B6370]">{usd(priceLibraryItem(item))}</div>
            </div>
          </button>
        ))}
      </div>
      {!filtered.length ? <p className="text-[11px] text-[#4B6370]">No objects match that search.</p> : null}
    </div>
  );
}
