import { useRef, useState } from "react";
import { Camera, Film, Image as ImageIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";

const MEDIA_KINDS = [
  { id: "magicplan", label: "Magicplan / Plan screenshot", accept: "image/*,.heic,.heif" },
  { id: "floor_plan", label: "Floor plan export", accept: "image/*,application/pdf,.heic,.heif" },
  { id: "photo_before", label: "Site photo", accept: "image/*,.heic,.heif" },
  { id: "site_video", label: "Walkthrough video", accept: "video/*,.mov,.mp4" },
  { id: "photo_during", label: "Photo — During", accept: "image/*,.heic,.heif" },
];

/**
 * iPhone-friendly uploads into the job Drive folder for bid packages.
 * Uses capture=environment so the camera opens on mobile Safari/Chrome.
 */
export default function JobSiteMediaCard({ jobId, clientId, drive, onRefresh }) {
  const libraryRef = useRef(null);
  const cameraRef = useRef(null);
  const videoRef = useRef(null);
  const [kind, setKind] = useState("magicplan");
  const [uploading, setUploading] = useState(false);

  const connected = Boolean(drive?.connected);
  const canUpload = Boolean(connected && jobId && !drive?.unlinked);
  const selected = MEDIA_KINDS.find((row) => row.id === kind) || MEDIA_KINDS[0];
  const files = (Array.isArray(drive?.files) ? drive.files : []).filter((row) =>
    ["magicplan", "floor_plan", "site_video", "photo_before", "photo_during", "photo_after", "bid_asset"].includes(row.kind),
  );

  const upload = async (file, forceKind = "") => {
    if (!file) return;
    const uploadKind = forceKind || kind;
    if (forceKind && forceKind !== kind) setKind(forceKind);
    const body = new FormData();
    body.append("kind", uploadKind);
    body.append("file", file);
    if (clientId) body.append("job_id", jobId);
    setUploading(true);
    try {
      const res = (await api.post(`/jobs/${jobId}/drive/files`, body, { timeout: 180000 })).data;
      if (typeof onRefresh === "function") onRefresh(res);
      toast.success("Saved to the job file for contractors");
    } catch (err) {
      toast.error(await formatApiError(err, "Could not upload that media. Please try again."));
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="job-site-media-card">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#C9A227]/15 text-[#C9A227] shrink-0">
          <Camera size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-['Outfit'] font-semibold text-[#061A23]">Job site media</h2>
          <p className="text-sm text-[#4B6370] mt-0.5">
            Upload Magicplan screenshots, Revival Plan exports, iPhone photos, and walkthrough videos. Bid packages pull these into the contractor portal.
          </p>
        </div>
      </div>

      {!canUpload ? (
        <p className="mt-4 text-sm text-[#4B6370]">
          {drive?.unlinked
            ? "Link this job to a client, then create the Drive folder to upload site media."
            : "Connect Google Drive in Company Profile so media lands in the job folder."}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <select
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-[#061A23]"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            data-testid="job-media-kind"
          >
            {MEDIA_KINDS.map((row) => (
              <option key={row.id} value={row.id}>{row.label}</option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <input
              ref={libraryRef}
              type="file"
              accept={selected.accept}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                upload(file);
              }}
              data-testid="job-media-library"
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*,.heic,.heif"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                upload(file);
              }}
              data-testid="job-media-camera"
            />
            <input
              ref={videoRef}
              type="file"
              accept="video/*,.mov,.mp4"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                upload(file, "site_video");
              }}
              data-testid="job-media-video"
            />
            <Button type="button" variant="outline" className="gap-2 border-[#0B3A8F]/25 text-[#0B3A8F]" disabled={uploading} onClick={() => libraryRef.current?.click()}>
              <Upload size={16} /> {uploading ? "Uploading…" : "Choose from Photos"}
            </Button>
            <Button type="button" className="gap-2 bg-[#0B3A8F] hover:bg-[#082C73]" disabled={uploading} onClick={() => cameraRef.current?.click()}>
              <ImageIcon size={16} /> Take photo
            </Button>
            <Button type="button" className="gap-2 bg-[#C9A227] hover:bg-[#B38F22] text-[#061A23]" disabled={uploading} onClick={() => videoRef.current?.click()}>
              <Film size={16} /> Record / pick video
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="text-sm font-medium text-[#061A23]">On this job</div>
        {files.length === 0 ? (
          <p className="mt-1 text-sm text-[#4B6370]">No site photos, Magicplan shots, or videos yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {files.slice(0, 16).map((file) => (
              <li key={file.id || file.google_drive_file_id || file.filename} className="py-2 flex items-center justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="text-sm text-[#061A23] truncate">{file.filename || "Media"}</div>
                  <div className="text-xs text-[#4B6370]">{file.kind_label || file.kind}</div>
                </div>
                {file.web_view_link ? (
                  <a href={file.web_view_link} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-[#0B3A8F] hover:underline shrink-0">
                    Open
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
