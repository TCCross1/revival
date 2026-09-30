export const usd = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

export const usdCents = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n || 0));

export const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
};

export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

export function toE164(phone, { required = false } = {}) {
  const raw = String(phone || "").trim();
  if (!raw) {
    if (required) throw new Error("A phone number is required.");
    return "";
  }
  const digits = digitsOnly(raw);
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw new Error("Enter a valid US phone number, like (512) 555-0100.");
}

export function formatPhone(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  try {
    const e164 = toE164(raw);
    const digits = digitsOnly(e164);
    if (digits.length === 11 && digits.startsWith("1")) {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
    }
    return e164;
  } catch {
    return raw;
  }
}

export const BRAND = {
  name: "Revival Home Remodeling",
  tagline: "Revive your home, renew your spirit.",
  logo: "/brand/revival-landing.jpg",
  banner: "/brand/revival-header-banner.jpg",
  bg: "/brand/revival-header-banner.jpg",
};
