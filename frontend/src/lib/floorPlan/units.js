export const FOOT = 12;
export const DEFAULT_WALL_HEIGHT = 96;
export const EXT_THICKNESS = 6;
export const INT_THICKNESS = 4.5;
/** Nominal 2x4 stud depth used for rectangular room blocks (outside-to-outside). */
export const STUD_THICKNESS = 3.5;

export function inches(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function round2(value) {
  return Math.round((inches(value) + Number.EPSILON) * 100) / 100;
}

function splitFeetInches(totalInches) {
  let total = Math.abs(inches(totalInches));
  let feet = Math.floor(total / 12);
  let rem = round2(total - feet * 12);
  if (rem >= 11.999) {
    feet += 1;
    rem = 0;
  }
  return { sign: inches(totalInches) < 0 ? "-" : "", feet, rem };
}

/** Inch body without the closing quote — e.g. 5, 5½, ½. */
export function formatInchBody(remInches) {
  const n = round2(Math.abs(inches(remInches)));
  const whole = Math.floor(n + 1e-9);
  const frac = round2(n - whole);
  if (frac < 0.01) return `${whole}`;
  const glyph = formatArchFraction(frac);
  if (whole === 0) return glyph || "0";
  return `${whole}${glyph}`;
}

export function formatFtIn(totalInches) {
  const { sign, feet, rem } = splitFeetInches(totalInches);
  if (rem === 0) return `${sign}${feet}'`;
  return `${sign}${feet}' ${formatInchBody(rem)}"`;
}

/** Compact architectural feet-inches: 15'5", 11'10". */
export function formatFtInTight(totalInches) {
  const { sign, feet, rem } = splitFeetInches(totalInches);
  if (rem === 0) return `${sign}${feet}'`;
  return `${sign}${feet}'${formatInchBody(rem)}"`;
}

/** Architectural inch label with common fractions (3½", 5½", 7¼"). */
export function formatArchInches(totalInches) {
  const n = round2(Math.abs(inches(totalInches)));
  const sign = inches(totalInches) < 0 ? "-" : "";
  if (n >= 12) return `${sign}${formatFtInTight(n)}`;
  return `${sign}${formatInchBody(n)}"`;
}

function formatArchFraction(frac) {
  const table = [
    [0, ""],
    [0.125, "⅛"],
    [0.25, "¼"],
    [0.375, "⅜"],
    [0.5, "½"],
    [0.625, "⅝"],
    [0.75, "¾"],
    [0.875, "⅞"],
  ];
  let best = table[0];
  let bestDist = Infinity;
  table.forEach((row) => {
    const dist = Math.abs(frac - row[0]);
    if (dist < bestDist) {
      best = row;
      bestDist = dist;
    }
  });
  if (bestDist < 0.04) return best[1] || "";
  // Fallback for uncommon fractions
  const sixteenths = Math.round(frac * 16);
  if (sixteenths <= 0) return "";
  if (sixteenths >= 16) return "";
  const simplified = simplifyFraction(sixteenths, 16);
  return ` ${simplified[0]}/${simplified[1]}`;
}

function simplifyFraction(num, den) {
  let a = num;
  let b = den;
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return [num / a, den / a];
}

export function parseFtIn(text) {
  try {
    if (text == null || text === "") return 0;
    if (typeof text === "number") return Number.isFinite(text) ? round2(text) : 0;
    let raw = String(text)
      .replace(/[\u2018\u2019\u2032]/g, "'")
      .replace(/[\u201C\u201D\u2033]/g, '"')
      .replace(/½/g, " 1/2")
      .replace(/¼/g, " 1/4")
      .replace(/¾/g, " 3/4")
      .replace(/⅛/g, " 1/8")
      .replace(/⅜/g, " 3/8")
      .replace(/⅝/g, " 5/8")
      .replace(/⅞/g, " 7/8")
      .trim()
      .toLowerCase()
      .replace(/feet|foot|ft/g, "'")
      .replace(/inches|inch|\bin\b/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) return 0;

    // 5-3 or 5-3-1/2 → feet-inches
    const dash = raw.match(/^(-?\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+)\s*\/\s*(\d+))?$/);
    if (dash) {
      const feet = Number(dash[1]);
      const inch = Number(dash[2]);
      const frac = dash[3] && dash[4] ? Number(dash[3]) / Number(dash[4]) : 0;
      return round2(feet * 12 + inch + frac);
    }

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
      let inch = 0;
      if (inchTxt) {
        const fracMatch = inchTxt.match(/^(\d+)?\s*(\d+)\s*\/\s*(\d+)$/);
        const mixed = inchTxt.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
        if (mixed) {
          inch = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
        } else if (fracMatch) {
          inch = (fracMatch[1] ? Number(fracMatch[1]) : 0) + Number(fracMatch[2]) / Number(fracMatch[3]);
        } else {
          inch = Number(inchTxt);
        }
      }
      const total = (Number.isFinite(feet) ? feet : 0) * 12 + (Number.isFinite(inch) ? inch : 0);
      return round2(total);
    }

    const bareFrac = raw.match(/^(-?\d+)?\s*(\d+)\s*\/\s*(\d+)$/);
    if (bareFrac) {
      const whole = bareFrac[1] ? Number(bareFrac[1]) : 0;
      return round2(whole + Number(bareFrac[2]) / Number(bareFrac[3]));
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
