import api, { BACKEND_URL } from "@/lib/api";

export function publicBidFileHref(asset, token) {
  const remote = String(asset?.web_view_link || asset?.url || "");
  if (remote.startsWith("http")) return remote;
  if (remote.startsWith("/api/public/")) return `${BACKEND_URL}${remote}`;
  const fid = String(asset?.file_id || "").trim() || (remote.includes("/bid-files/") ? remote.split("/").pop() : "");
  if (fid && token) return `${BACKEND_URL}/api/public/sub/${token}/files/${fid}`;
  if (remote.startsWith("/")) return `${BACKEND_URL}${remote}`;
  return remote;
}

export async function openGcBidFile(asset) {
  const remote = String(asset?.web_view_link || asset?.url || "");
  if (remote.startsWith("http") && !remote.includes("/bid-files/") && !remote.includes("/public/sub/")) {
    window.open(remote, "_blank", "noopener,noreferrer");
    return;
  }
  const fid = String(asset?.file_id || "").trim() || (remote.includes("/bid-files/") ? remote.split("/").pop() : "");
  if (!fid) {
    if (remote) window.open(remote, "_blank", "noopener,noreferrer");
    return;
  }
  const res = await api.get(`/bid-files/${fid}`, { responseType: "blob" });
  const url = window.URL.createObjectURL(res.data);
  window.open(url, "_blank", "noopener,noreferrer");
}
