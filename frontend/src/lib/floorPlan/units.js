export const FOOT = 12;
export const DEFAULT_WALL_HEIGHT = 96;
export const EXT_THICKNESS = 6;
export const INT_THICKNESS = 4.5;

export function inches(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function round2(value) {
  return Math.round((inches(value) + Number.EPSILON) * 100) / 100;
}

export function formatFtIn(totalInches) {
  let total = inches(totalInches);
  const sign = total < 0 ? "-" : "";
  total = Math.abs(total);
  let feet = Math.floor(total / 12);
  let rem = round2(total - feet * 12);
  if (rem >= 11.999) {
    feet += 1;
    rem = 0;
  }
  if (rem === 0) return `${sign}${feet}'`;
  if (rem === Math.floor(rem)) return `${sign}${feet}' ${Math.floor(rem)}"`;
  return `${sign}${feet}' ${rem}"`;
}

export function parseFtIn(text) {
  try {
    if (text == null || text === "") return 0;
    if (typeof text === "number") return Number.isFinite(text) ? round2(text) : 0;
    const raw = String(text)
      .replace(/[\u2018\u2019\u2032]/g, "'")
      .replace(/[\u201C\u201D\u2033]/g, '"')
      .trim()
      .toLowerCase()
      .replace(/feet|foot|ft/g, "'")
      .replace(/inches|inch|\bin\b/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) return 0;
    if (raw.includes("'") || raw.includes('"')) {
      let feet = 0;
      let rest = raw;
      if (raw.includes("'")) {
        const parts = raw.split("'");
        const left = String(parts[0] || "").trim();
        feet = left ? Number(left) : 0;
        rest = String(parts.slice(1).join("'") || "");
      }
      const inchTxt = String(rest).replace(/"/g, "").trim();
      const inch = inchTxt ? Number(inchTxt) : 0;
      const total = (Number.isFinite(feet) ? feet : 0) * 12 + (Number.isFinite(inch) ? inch : 0);
      return round2(total);
    }
    const n = Number(raw);
    return Number.isFinite(n) ? round2(n) : 0;
  } catch {
    return 0;
  }
}

export function dist(x1, y1, x2, y2) {
  return Math.hypot(inches(x2) - inches(x1), inches(y2) - inches(y1));
}

export function snapTo(value, snap = 6) {
  const step = Math.max(inches(snap), 0.25);
  return Math.round(inches(value) / step) * step;
}

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `fp_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
