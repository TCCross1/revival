import { inches, round2, snapTo, uid } from "./units";
import { isBaseRunObject, isCountertopObject } from "./library";
import { objectFootprint } from "./cabinetRun";

function box(obj) {
  const fp = objectFootprint(obj);
  return {
    x1: fp.x,
    y1: fp.y,
    x2: fp.x + fp.w,
    y2: fp.y + fp.h,
  };
}

function near(a, b, gap = 2) {
  const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  const gapX = Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2);
  const gapY = Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2);
  const touchX = overlapX >= -gap && overlapY > 4;
  const touchY = overlapY >= -gap && overlapX > 4;
  return touchX || touchY || (gapX <= gap && overlapY > 4) || (gapY <= gap && overlapX > 4);
}

function clusters(items) {
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const unite = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  };
  items.forEach((a, i) => {
    items.forEach((b, j) => {
      if (j > i && near(box(a), box(b))) unite(i, j);
    });
  });
  const groups = new Map();
  items.forEach((item, i) => {
    const key = find(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.values()];
}

export function fitCountertops(level, options = {}) {
  const snap = Math.max(inches(options.snap) || 6, 1);
  const material = options.material || "quartz";
  const overhang = inches(options.overhang) || 1;
  const objects = level?.objects || [];
  const kept = objects.filter((obj) => !(isCountertopObject(obj) && obj.auto));
  const hosts = kept.filter(isBaseRunObject);
  if (!hosts.length) return { ...level, objects: kept };
  const tops = clusters(hosts).map((group) => {
    const boxes = group.map(box);
    const x1 = snapTo(Math.min(...boxes.map((b) => b.x1)) - (group.some((g) => (g.tags || []).includes("island")) ? overhang : 0), snap);
    const y1 = snapTo(Math.min(...boxes.map((b) => b.y1)), snap);
    const x2 = snapTo(Math.max(...boxes.map((b) => b.x2)), snap);
    const y2 = snapTo(Math.max(...boxes.map((b) => b.y2)) + overhang, snap);
    const island = group.some((g) => (g.tags || []).includes("island"));
    return {
      id: uid(),
      library_id: "counter-run",
      name: island ? "Island countertop" : "Countertop",
      group: "Kitchen",
      tags: ["countertop"],
      x: round2(island ? x1 - overhang : x1),
      y: round2(island ? y1 - overhang : y1),
      width: round2((island ? x2 + overhang : x2) - (island ? x1 - overhang : x1)),
      depth: round2((island ? y2 + overhang : y2) - (island ? y1 - overhang : y1)),
      height: 1.5,
      rotation: 0,
      work: "new",
      note: "",
      auto: true,
      counter_material: material,
      finish: material,
    };
  });
  return { ...level, objects: [...kept, ...tops] };
}
