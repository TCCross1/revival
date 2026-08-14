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

export const BRAND = {
  logo: "https://customer-assets-lxgj4vgw.emergentagent.net/job_a0b60c79-694f-4789-8f44-c88f5bec0abf/artifacts/7b1gd1pi_29B98378-43E4-4E5E-9059-E73074B861FB.png",
  bg: "https://customer-assets-lxgj4vgw.emergentagent.net/job_a0b60c79-694f-4789-8f44-c88f5bec0abf/artifacts/8y6jtssj_676A1DF1-2965-47D7-B3A5-70E8A72E6D04.png",
};
