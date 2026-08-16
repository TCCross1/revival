import { useRef, useState } from "react";
import { FolderOpen, FolderPlus, ExternalLink, Upload, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";

function formatWhen(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

export default function ClientDriveCard({
  drive,
  onCreate,
  creating,
  compact = false,
  clientId = "",
  jobId = "",
  onRefresh,
}) {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const connected = Boolean(drive?.connected);
  const configured = Boolean(drive?.configured);
  const hasFolder = Boolean(drive?.has_folder && drive?.folder_url);
  const name = drive?.folder_name || drive?.suggested_name || "Client folder";
  const files = Array.isArray(drive?.files) ? drive.files : [];
  const kinds = Array.isArray(drive?.upload_kinds) && drive.upload_kinds.length
    ? drive.upload_kinds
    : [
        { id: "floor_plan", label: "Floor plan" },
        { id: "materials_list", label: "Materials list" },
        { id: "vendor_quote", label: "Vendor quote" },
        { id: "photo_before", label: "Photo — Before" },
        { id: "photo_during", label: "Photo — During" },
        { id: "photo_after", label: "Photo — After" },
        { id: "receipt", label: "Receipt" },
        { id: "other", label: "Other" },
      ];
  const [kind, setKind] = useState(kinds[0]?.id || "other");
  const [uploading, setUploading] = useState(false);
  const canUpload = Boolean(connected && (clientId || jobId) && !drive?.unlinked);

  const uploadTo = jobId ? `/jobs/${jobId}/drive/files` : `/clients/${clientId}/drive/files`;

  const onPickFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const body = new FormData();
    body.append("kind", kind);
    body.append("file", file);
    if (jobId && clientId) body.append("job_id", jobId);
    setUploading(true);
    try {
      const res = (await api.post(uploadTo, body)).data;
      if (typeof onRefresh === "function") onRefresh(res);
      toast.success("Saved to Google Drive");
    } catch (err) {
      toast.error(await formatApiError(err, "Could not upload that file. Please try again."));
    } finally {
      setUploading(false);
    }
  };

  if (!configured) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-white ${compact ? "p-3" : "p-5"}`} data-testid="client-drive-card">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0A4D68]/10 text-[#0A4D68] shrink-0">
            <FolderOpen size={18} />
          </span>
          <div className="min-w-0">
            <div className="font-['Outfit'] font-semibold text-[#061A23]">Google Drive folder</div>
            <p className="text-sm text-[#4B6370] mt-1">Google Drive is not set up yet. Save the Google keys in Company Profile, then connect revivalhomeremodelingllc@gmail.com.</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => navigate("/settings")} data-testid="client-drive-settings-btn">
              Open Company Profile
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-white ${compact ? "p-3" : "p-5"}`} data-testid="client-drive-card">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0A4D68]/10 text-[#0A4D68] shrink-0">
            <FolderOpen size={18} />
          </span>
          <div className="min-w-0">
            <div className="font-['Outfit'] font-semibold text-[#061A23]">Google Drive folder</div>
            <p className="text-sm text-[#4B6370] mt-1">Connect <span className="font-medium text-[#0A4D68]">{drive?.expected_email || "revivalhomeremodelingllc@gmail.com"}</span> in Company Profile. Files then save under Revival Pro → Clients → this client → Floor Plans, Receipts, Reports, or Job Sheets.</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => navigate("/settings")} data-testid="client-drive-settings-btn">
              Connect Google Drive
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-slate-200 bg-white ${compact ? "p-3" : "p-5"}`} data-testid="client-drive-card">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#C9A227]/15 text-[#C9A227] shrink-0">
            <FolderOpen size={18} />
          </span>
          <div className="min-w-0">
            <div className="font-['Outfit'] font-semibold text-[#061A23]">Google Drive folder</div>
            {hasFolder ? (
              <p className="text-sm text-[#4B6370] mt-0.5 truncate">Ready: <span className="font-medium text-[#061A23]">{name}</span></p>
            ) : (
              <p className="text-sm text-[#4B6370] mt-0.5">No folder yet. Revival Pro will create <span className="font-medium text-[#061A23]">{name}</span> when you create it or save a document.</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {hasFolder ? (
            <Button type="button" asChild className="bg-[#0A4D68] hover:bg-[#083D53] gap-2" data-testid="client-drive-open-btn">
              <a href={drive.folder_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={16} /> Open folder
              </a>
            </Button>
          ) : (
            <Button type="button" onClick={onCreate} disabled={creating} className="bg-[#0A4D68] hover:bg-[#083D53] gap-2" data-testid="client-drive-create-btn">
              <FolderPlus size={16} /> {creating ? "Creating…" : "Create folder"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-[#061A23]">Saved documents</div>
          <div className="text-xs text-[#4B6370]">{files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "None yet"}</div>
        </div>
        {files.length ? (
          <ul className="mt-2 divide-y divide-slate-100" data-testid="client-drive-file-list">
            {files.slice(0, 12).map((file) => (
              <li key={file.id || file.google_drive_file_id || file.filename} className="py-2 flex items-center justify-between gap-3 min-w-0">
                <div className="flex items-start gap-2 min-w-0">
                  <FileText size={14} className="mt-0.5 text-[#0A4D68] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm text-[#061A23] truncate">{file.filename || "Document"}</div>
                    <div className="text-xs text-[#4B6370]">{file.kind_label || file.kind}{formatWhen(file.uploaded_at) ? ` · ${formatWhen(file.uploaded_at)}` : ""}</div>
                  </div>
                </div>
                {file.web_view_link ? (
                  <a href={file.web_view_link} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-[#0A4D68] hover:underline shrink-0">
                    Open
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[#4B6370] mt-2">Floor plans, receipt photos, client reports, and job sheets save into the matching subfolder automatically.</p>
        )}
      </div>

      {canUpload ? (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
          <select
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-[#061A23]"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            data-testid="client-drive-kind"
          >
            {kinds.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} data-testid="client-drive-file-input" />
          <Button
            type="button"
            variant="outline"
            className="gap-2 border-[#0A4D68]/25 text-[#0A4D68]"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            data-testid="client-drive-upload-btn"
          >
            <Upload size={16} /> {uploading ? "Uploading…" : "Upload file"}
          </Button>
        </div>
      ) : drive?.unlinked ? (
        <p className="text-sm text-[#4B6370] mt-4">Link this job to a client to create a Drive folder and upload files.</p>
      ) : null}
    </div>
  );
}
