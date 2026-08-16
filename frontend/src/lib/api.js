import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://127.0.0.1:8001";
export const API = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API,
  withCredentials: true,
  timeout: 12000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("session_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function formatApiError(err, fallback = "Something went wrong. Please try again.") {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (typeof parsed?.detail === "string" && parsed.detail.trim()) return parsed.detail;
      if (Array.isArray(parsed?.detail)) {
        const joined = parsed.detail.map((e) => e?.msg || "").filter(Boolean).join(" ");
        if (joined) return joined;
      }
    } catch {
      /* not JSON */
    }
    return fallback;
  }
  const detail = data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const joined = detail.map((e) => e?.msg || "").filter(Boolean).join(" ");
    if (joined) return joined;
  }
  if (typeof data === "string" && data.trim()) return data;
  if (err?.message && !String(err.message).startsWith("Request failed")) return err.message;
  return fallback;
}

export async function downloadAuthenticatedPdf(path, filename, fallback = "Could not download the PDF. Please try again.") {
  const res = await api.get(path, { responseType: "blob" });
  const type = res.data?.type || "";
  if (type.includes("application/json")) {
    const parsed = JSON.parse(await res.data.text());
    const msg = typeof parsed?.detail === "string" ? parsed.detail : fallback;
    throw new Error(msg);
  }
  const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export async function downloadAuthenticatedPdfPost(path, body, filename, fallback = "Could not download the PDF. Please try again.") {
  const res = await api.post(path, body, { responseType: "blob" });
  const type = res.data?.type || "";
  if (type.includes("application/json")) {
    const parsed = JSON.parse(await res.data.text());
    const msg = typeof parsed?.detail === "string" ? parsed.detail : fallback;
    throw new Error(msg);
  }
  const blob = new Blob([res.data], { type: "application/pdf" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}

export default api;
