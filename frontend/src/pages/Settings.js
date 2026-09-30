import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Building2, FileText, Receipt, FileSignature, Save, FolderOpen, Percent, Copy, CheckCircle2, ExternalLink, ShieldCheck, CreditCard } from "lucide-react";
import { toast } from "sonner";

const DRIVE_WHY = {
  denied: "Google cancelled the sign-in. Choose revivalhomeremodelingllc@gmail.com and tap Allow.",
  google: "Google rejected the sign-in. Click Connect Google Drive and try again.",
  state: "That Google sign-in expired. Click Connect Google Drive again.",
  expired: "That Google sign-in expired. Click Connect Google Drive again.",
  token: "Google did not send a lasting sign-in. In Google Account → Security → Third-party access, remove Revival Pro, then connect again and tap Allow.",
  unknown: "Could not connect Google Drive. Confirm the redirect URI matches Google Cloud exactly, then try again.",
};

export default function Settings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState(null);
  const [driveKeys, setDriveKeys] = useState({ client_id: "", client_secret: "" });
  const [squareForm, setSquareForm] = useState({
    access_token: "",
    location_id: "",
    application_id: "",
    application_secret: "",
    environment: "production",
    webhook_signature_key: "",
    terminal_device_id: "",
    checking_account_id: "",
    balance_account_id: "",
  });
  const driveToast = useRef(false);
  const squareToast = useRef(false);
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/settings")).data,
  });
  const { data: drive } = useQuery({
    queryKey: ["google-drive-status"],
    queryFn: async () => (await api.get("/google-drive/status")).data,
  });
  const { data: square } = useQuery({
    queryKey: ["square-status"],
    queryFn: async () => (await api.get("/square/status")).data,
  });
  useEffect(() => { if (data) setForm(data); }, [data]);

  useEffect(() => {
    const flag = searchParams.get("drive");
    if (!flag || driveToast.current) return;
    driveToast.current = true;
    const why = searchParams.get("why") || "";
    if (flag === "connected") {
      toast.success("Google Drive is connected. Revival Pro / Clients is ready.");
      api.post("/google-drive/bootstrap").then(() => {
        qc.invalidateQueries({ queryKey: ["google-drive-status"] });
      }).catch(() => {});
    }
    if (flag === "error") {
      toast.error(DRIVE_WHY[why] || DRIVE_WHY.unknown);
    }
    qc.invalidateQueries({ queryKey: ["google-drive-status"] });
    const next = new URLSearchParams(searchParams);
    next.delete("drive");
    next.delete("why");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, qc]);

  useEffect(() => {
    const flag = searchParams.get("square");
    if (!flag || squareToast.current) return;
    squareToast.current = true;
    if (flag === "connected") toast.success("Square is connected. Job deposits can park into Savings folders.");
    if (flag === "error") toast.error("Could not connect Square. Check the Application ID and secret, then try again.");
    qc.invalidateQueries({ queryKey: ["square-status"] });
    const next = new URLSearchParams(searchParams);
    next.delete("square");
    next.delete("why");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, qc]);

  const save = useMutation({
    mutationFn: async (payload) => (await api.put("/settings", payload)).data,
    onSuccess: (res) => {
      setForm(res);
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Company profile saved");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save company settings. Please try again.")),
  });

  const connectDrive = useMutation({
    mutationFn: async () => (await api.get("/google-drive/connect")).data,
    onSuccess: (res) => {
      if (res?.auth_url) window.location.href = res.auth_url;
      else toast.error("Google did not return a sign-in link.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not start Google Drive sign-in. Please try again.")),
  });

  const disconnectDrive = useMutation({
    mutationFn: async () => (await api.post("/google-drive/disconnect")).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["google-drive-status"] });
      toast.success("Google Drive disconnected. Your Google keys are still saved — click Connect to sign in again.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not disconnect Google Drive. Please try again.")),
  });

  const verifyDrive = useMutation({
    mutationFn: async () => (await api.post("/google-drive/verify")).data,
    onSuccess: (res) => {
      qc.setQueryData(["google-drive-status"], res);
      qc.invalidateQueries({ queryKey: ["google-drive-status"] });
      if (res?.connected) toast.success(`Drive is live as ${res.email || "the company Gmail"}.`);
      else toast.error(res?.last_error || "Drive is not connected yet. Click Connect Google Drive.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not verify Google Drive. Connect again in Company Profile.")),
  });

  const saveSquare = useMutation({
    mutationFn: async () => (await api.post("/square/credentials", squareForm)).data,
    onSuccess: (res) => {
      qc.setQueryData(["square-status"], res);
      setSquareForm((prev) => ({ ...prev, access_token: "", application_secret: "", webhook_signature_key: "" }));
      toast.success(res?.connected ? "Square credentials saved." : "Square settings saved.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save Square credentials.")),
  });

  const connectSquare = useMutation({
    mutationFn: async () => (await api.get("/square/connect")).data,
    onSuccess: (res) => {
      if (res?.auth_url) window.location.href = res.auth_url;
      else toast.error("Square did not return a sign-in link.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not start Square sign-in.")),
  });

  const disconnectSquare = useMutation({
    mutationFn: async () => (await api.post("/square/disconnect")).data,
    onSuccess: (res) => {
      qc.setQueryData(["square-status"], res);
      toast.success("Square disconnected. Saved application keys stay on the server.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not disconnect Square.")),
  });

  const saveDriveKeys = useMutation({
    mutationFn: async () => (await api.post("/google-drive/credentials", driveKeys)).data,
    onSuccess: () => {
      setDriveKeys({ client_id: "", client_secret: "" });
      qc.invalidateQueries({ queryKey: ["google-drive-status"] });
      toast.success("Google keys saved. Click Connect Google Drive next.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save the Google keys. Please try again.")),
  });

  const copyRedirect = async () => {
    const uri = drive?.redirect_uri || "http://localhost:8001/api/google-drive/callback";
    try {
      await navigator.clipboard.writeText(uri);
      toast.success("Redirect URI copied");
    } catch {
      toast.error("Copy the redirect URI from the box below.");
    }
  };

  if (isLoading || !form) return <div className="text-[#4B6370]">Loading…</div>;
  const set = (k, v) => setForm({ ...form, [k]: v });

  const payload = () => ({
    name: form.name,
    address: form.address,
    phone: form.phone,
    license: form.license,
    email: form.email,
    estimate_terms: form.estimate_terms || "",
    invoice_terms: form.invoice_terms || "",
    contract_terms: form.contract_terms || "",
    change_order_terms: form.change_order_terms || "",
    exclusions_text: form.exclusions_text || "",
    default_change_order_markup: Number(form.default_change_order_markup || 20),
    default_profit_margin: Number(form.default_profit_margin ?? 20),
    credit_card_fee_pct: Number(form.credit_card_fee_pct ?? 3),
    sales_tax_pct: Number(form.sales_tax_pct ?? 6),
    optional_tax_pct: Number(form.optional_tax_pct ?? 5),
    job_fund_folder_name_pattern: form.job_fund_folder_name_pattern || "{client_name} – {job_short_name}",
  });

  return (
    <div className="space-y-6 max-w-3xl" data-testid="settings-page">
      <div>
        <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Company Profile</h1>
        <p className="text-[#4B6370] mt-1">Write these once. They fill in on new estimates, invoices, and contracts — and you can still tweak them on each job.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 bg-[#0B3A8F]">
          <Building2 size={18} className="text-[#C9A227]" />
          <h2 className="text-white font-['Outfit'] font-semibold">Contractor Details</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <Label className="text-xs text-[#4B6370]">Business name</Label>
            <Input className="mt-1" data-testid="company-name" value={form.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="Revival Home Remodeling" />
          </div>
          <div>
            <Label className="text-xs text-[#4B6370]">Address</Label>
            <Input className="mt-1" data-testid="company-address" value={form.address || ""} onChange={(e) => set("address", e.target.value)} placeholder="123 Main St, Austin, TX 78701" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-[#4B6370]">Phone</Label>
              <Input className="mt-1" data-testid="company-phone" value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} placeholder="859-227-0340" />
            </div>
            <div>
              <Label className="text-xs text-[#4B6370]">Contact email</Label>
              <Input className="mt-1" data-testid="company-email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} placeholder="revivalhomeremodelingllc@gmail.com" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-[#4B6370]">License info</Label>
            <Input className="mt-1" data-testid="company-license" value={form.license || ""} onChange={(e) => set("license", e.target.value)} placeholder="TX Lic. #RRC-000000" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" data-testid="google-drive-settings">
        <div className="flex items-center justify-between gap-3 px-6 py-4 bg-[#0B3A8F]">
          <div className="flex items-center gap-2">
            <FolderOpen size={18} className="text-[#C9A227]" />
            <h2 className="text-white font-['Outfit'] font-semibold">Google Drive</h2>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${drive?.connected ? "bg-emerald-400/20 text-emerald-100" : drive?.configured || drive?.keys_saved ? "bg-[#C9A227]/25 text-[#F6E7A8]" : "bg-white/15 text-white"}`} data-testid="drive-status-badge">
            {drive?.connected ? "Connected" : drive?.configured || drive?.keys_saved ? "Keys saved — connect next" : "Not connected"}
          </span>
        </div>
        <div className="p-6 space-y-5">
          <p className="text-sm text-[#4B6370]">
            Connect <span className="font-medium text-[#061A23]">revivalhomeremodelingllc@gmail.com</span> once. Floor plans, receipt photos, client reports, and permit PDFs then save into the matching client folder.
          </p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#061A23] font-mono leading-7" data-testid="drive-folder-structure">
            Revival Pro /<br />
            &nbsp;&nbsp;Clients /<br />
            &nbsp;&nbsp;&nbsp;&nbsp;{"{Client Name}"} /<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Floor Plans<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Receipts<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Reports<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Permit Details<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Job Sheets
          </div>

          {drive?.last_error && !drive?.connected ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="drive-last-error">
              {drive.last_error}
            </div>
          ) : null}

          {drive?.connected ? (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3" data-testid="drive-connected-panel">
              <p className="text-sm text-[#061A23] flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-700" />
                Connected as <span className="font-semibold">{drive.email || drive.expected_email}</span>
              </p>
              {drive.email_mismatch ? (
                <p className="text-sm text-amber-800">This is not {drive.expected_email}. Disconnect and sign in with the company Gmail.</p>
              ) : null}
              <p className="text-sm text-[#4B6370]">
                {drive.folders_ready
                  ? "Revival Pro / Clients is ready. New client work saves into the folders above."
                  : "Signed in. Click Verify Drive to create Revival Pro / Clients if it is missing."}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {drive.root_folder_url || drive.parent_folder_url ? (
                  <a className="inline-flex items-center gap-1.5 text-sm text-[#0B3A8F] hover:underline" href={drive.root_folder_url || drive.parent_folder_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={14} /> Open Revival Pro folder
                  </a>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-3" data-testid="drive-setup-steps">
              <div className={`rounded-lg border px-4 py-3 ${drive?.configured || drive?.keys_saved ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"}`}>
                <p className="text-sm font-semibold text-[#061A23]">Step 1 — Enable Drive in Google Cloud</p>
                <ol className="text-sm text-[#4B6370] space-y-1.5 list-decimal pl-5 mt-2">
                  <li>Open <a className="text-[#0B3A8F] underline" href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer">Google Cloud → Drive API</a> and click Enable.</li>
                  <li>On the OAuth consent screen, add <span className="font-medium text-[#061A23]">revivalhomeremodelingllc@gmail.com</span> as a test user.</li>
                  <li>Go to <a className="text-[#0B3A8F] underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Credentials</a> → Create credentials → OAuth client ID → Web application.</li>
                  <li>Paste the redirect URI below into Authorized redirect URIs, then create the client.</li>
                </ol>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${drive?.configured || drive?.keys_saved ? "border-emerald-200 bg-emerald-50/60" : "border-[#C9A227]/40 bg-[#C9A227]/5"}`}>
                <p className="text-sm font-semibold text-[#061A23]">Step 2 — Save the Google keys here</p>
                <p className="text-sm text-[#4B6370] mt-1">
                  {drive?.configured || drive?.keys_saved
                    ? `Keys are saved${drive.client_id_hint ? ` (${drive.client_id_hint})` : ""}. You can update them below if Google issued a new secret.`
                    : "Paste the Client ID and Client Secret from that Google Cloud client, then click Save Google keys."}
                </p>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${drive?.configured || drive?.keys_saved ? "border-[#C9A227]/40 bg-[#C9A227]/5" : "border-slate-200 bg-white"}`}>
                <p className="text-sm font-semibold text-[#061A23]">Step 3 — Connect the company Gmail</p>
                <p className="text-sm text-[#4B6370] mt-1">
                  After the keys are saved, click Connect Google Drive, choose <span className="font-medium text-[#061A23]">revivalhomeremodelingllc@gmail.com</span>, and tap Allow. This page will come back with a Connected badge.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <Input readOnly value={drive?.redirect_uri || "http://localhost:8001/api/google-drive/callback"} className="font-mono text-xs" data-testid="drive-redirect-uri" />
            <Button type="button" variant="outline" onClick={copyRedirect} className="gap-1.5 shrink-0" data-testid="copy-drive-redirect-btn">
              <Copy size={14} /> Copy URI
            </Button>
          </div>

          {user?.role === "admin" ? (
            <div className="space-y-3">
              {!drive?.connected ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-[#4B6370]">Google Client ID</Label>
                    <Input className="mt-1 font-mono text-xs" data-testid="drive-client-id" value={driveKeys.client_id} onChange={(e) => setDriveKeys({ ...driveKeys, client_id: e.target.value })} placeholder="….apps.googleusercontent.com" autoComplete="off" />
                  </div>
                  <div>
                    <Label className="text-xs text-[#4B6370]">Google Client Secret</Label>
                    <Input className="mt-1 font-mono text-xs" type="password" data-testid="drive-client-secret" value={driveKeys.client_secret} onChange={(e) => setDriveKeys({ ...driveKeys, client_secret: e.target.value })} placeholder="GOCSPX-…" autoComplete="new-password" />
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {!drive?.connected ? (
                  <Button type="button" variant="outline" data-testid="save-drive-keys-btn" onClick={() => saveDriveKeys.mutate()} disabled={saveDriveKeys.isPending} className="border-[#0B3A8F]/30 text-[#0B3A8F]">
                    {saveDriveKeys.isPending ? "Saving keys…" : drive?.configured || drive?.keys_saved ? "Update Google keys" : "Save Google keys"}
                  </Button>
                ) : null}
                {(drive?.configured || drive?.keys_saved) && !drive?.connected ? (
                  <Button type="button" data-testid="connect-drive-btn" onClick={() => connectDrive.mutate()} disabled={connectDrive.isPending} className="bg-[#0B3A8F] hover:bg-[#082C73]">
                    {connectDrive.isPending ? "Opening Google…" : "Connect Google Drive"}
                  </Button>
                ) : null}
                {drive?.connected ? (
                  <Button type="button" data-testid="verify-drive-btn" onClick={() => verifyDrive.mutate()} disabled={verifyDrive.isPending} className="bg-[#0B3A8F] hover:bg-[#082C73] gap-1.5">
                    <ShieldCheck size={14} /> {verifyDrive.isPending ? "Checking Drive…" : "Verify Drive"}
                  </Button>
                ) : null}
                {drive?.connected ? (
                  <Button type="button" data-testid="disconnect-drive-btn" variant="outline" onClick={() => { if (window.confirm("Disconnect Google Drive? Client folder links in Revival Pro will stay, but new folders cannot be created until you connect again. Your Google keys stay saved.")) disconnectDrive.mutate(); }} disabled={disconnectDrive.isPending}>
                    {disconnectDrive.isPending ? "Disconnecting…" : "Disconnect"}
                  </Button>
                ) : null}
              </div>
              {!drive?.connected ? (
                <p className="text-xs text-[#4B6370]">Save the keys first. Then click Connect, choose <span className="font-medium text-[#061A23]">revivalhomeremodelingllc@gmail.com</span>, and tap Allow. Status stays Not connected until that sign-in finishes.</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[#4B6370]">Ask an admin to connect Google Drive.</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" data-testid="square-settings">
        <div className="flex items-center justify-between gap-3 px-6 py-4 bg-[#0B3A8F]">
          <div className="flex items-center gap-2">
            <CreditCard size={18} className="text-[#C9A227]" />
            <h2 className="text-white font-['Outfit'] font-semibold">Square Job Funds</h2>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${square?.connected ? "bg-emerald-400/20 text-emerald-100" : "bg-white/15 text-white"}`} data-testid="square-status-badge">
            {square?.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-[#4B6370]">
            Revival Pro is the source of truth for client deposits. Connect Square so Collect Deposit can charge the Reader, record the deposit on the job, and park net funds in that job’s Savings folder.
          </p>
          <div>
            <Label className="text-xs text-[#4B6370]">Folder name pattern</Label>
            <Input className="mt-1" data-testid="job-fund-folder-pattern" value={form.job_fund_folder_name_pattern || ""} onChange={(e) => set("job_fund_folder_name_pattern", e.target.value)} placeholder="{client_name} – {job_short_name}" />
            <p className="text-xs text-[#4B6370] mt-1">Tokens: {"{client_name}"}, {"{job_short_name}"}, {"{job_name}"}, {"{job_number}"}.</p>
          </div>
          {user?.role === "admin" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-[#4B6370]">Access token</Label>
                  <Input className="mt-1 font-mono text-xs" type="password" autoComplete="new-password" value={squareForm.access_token} onChange={(e) => setSquareForm({ ...squareForm, access_token: e.target.value })} placeholder={square?.connected ? "Saved on the server" : "EAAA…"} />
                </div>
                <div>
                  <Label className="text-xs text-[#4B6370]">Location ID</Label>
                  <Input className="mt-1 font-mono text-xs" value={squareForm.location_id} onChange={(e) => setSquareForm({ ...squareForm, location_id: e.target.value })} placeholder={square?.location_id || "L…"} />
                </div>
                <div>
                  <Label className="text-xs text-[#4B6370]">Application ID</Label>
                  <Input className="mt-1 font-mono text-xs" value={squareForm.application_id} onChange={(e) => setSquareForm({ ...squareForm, application_id: e.target.value })} placeholder={square?.application_id || "sq0idp-…"} />
                </div>
                <div>
                  <Label className="text-xs text-[#4B6370]">Application secret</Label>
                  <Input className="mt-1 font-mono text-xs" type="password" autoComplete="new-password" value={squareForm.application_secret} onChange={(e) => setSquareForm({ ...squareForm, application_secret: e.target.value })} placeholder="Optional for OAuth" />
                </div>
                <div>
                  <Label className="text-xs text-[#4B6370]">Terminal / Reader device ID</Label>
                  <Input className="mt-1 font-mono text-xs" value={squareForm.terminal_device_id} onChange={(e) => setSquareForm({ ...squareForm, terminal_device_id: e.target.value })} placeholder={square?.terminal_device_id || "Optional"} />
                </div>
                <div>
                  <Label className="text-xs text-[#4B6370]">Webhook signature key</Label>
                  <Input className="mt-1 font-mono text-xs" type="password" autoComplete="new-password" value={squareForm.webhook_signature_key} onChange={(e) => setSquareForm({ ...squareForm, webhook_signature_key: e.target.value })} placeholder="From Square Developer Dashboard" />
                </div>
                <div>
                  <Label className="text-xs text-[#4B6370]">Environment</Label>
                  <select className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={squareForm.environment} onChange={(e) => setSquareForm({ ...squareForm, environment: e.target.value })}>
                    <option value="production">Production</option>
                    <option value="sandbox">Sandbox</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-[#4B6370]">Webhook URL</Label>
                  <Input className="mt-1 font-mono text-xs" readOnly value={square?.webhook_url || "http://localhost:8001/api/webhooks/square"} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" disabled={saveSquare.isPending} onClick={() => saveSquare.mutate()}>
                  {saveSquare.isPending ? "Saving…" : "Save Square credentials"}
                </Button>
                {square?.oauth_configured ? (
                  <Button type="button" variant="outline" className="border-[#0B3A8F]/30 text-[#0B3A8F]" disabled={connectSquare.isPending} onClick={() => connectSquare.mutate()}>
                    {connectSquare.isPending ? "Opening Square…" : "Connect with Square OAuth"}
                  </Button>
                ) : null}
                {square?.connected ? (
                  <Button type="button" variant="outline" disabled={disconnectSquare.isPending} onClick={() => { if (window.confirm("Disconnect Square? Job folder links stay, but new deposits cannot charge a card until you connect again.")) disconnectSquare.mutate(); }}>
                    {disconnectSquare.isPending ? "Disconnecting…" : "Disconnect"}
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-[#4B6370]">Tokens are encrypted on the server and never shown again. Paste a new token only when you rotate it.</p>
            </div>
          ) : (
            <p className="text-sm text-[#4B6370]">Ask an admin to connect Square.</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 bg-[#0B3A8F]">
          <FileText size={18} className="text-[#C9A227]" />
          <h2 className="text-white font-['Outfit'] font-semibold">Estimate Terms</h2>
        </div>
        <div className="p-6 space-y-2">
          <p className="text-sm text-[#4B6370]">This prints on every estimate PDF. Edit it here, or change it on one estimate before you send it.</p>
          <Textarea data-testid="estimate-terms-input" rows={8} value={form.estimate_terms || ""} onChange={(e) => set("estimate_terms", e.target.value)} placeholder="Validity, what’s included, hidden conditions…" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 bg-[#0B3A8F]">
          <Receipt size={18} className="text-[#C9A227]" />
          <h2 className="text-white font-['Outfit'] font-semibold">Invoice Terms</h2>
        </div>
        <div className="p-6 space-y-2">
          <p className="text-sm text-[#4B6370]">Payment due dates, how to pay, and late-balance language for invoice PDFs.</p>
          <Textarea data-testid="invoice-terms-input" rows={8} value={form.invoice_terms || ""} onChange={(e) => set("invoice_terms", e.target.value)} placeholder="Payment due by the date on this invoice…" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 bg-[#0B3A8F]">
          <FileSignature size={18} className="text-[#C9A227]" />
          <h2 className="text-white font-['Outfit'] font-semibold">Contract Terms</h2>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <Label className="text-xs text-[#4B6370]">Standard general contractor terms</Label>
            <p className="text-sm text-[#4B6370] mt-1 mb-2">Access, delays, what the price covers, and that the written contract is the full agreement.</p>
            <Textarea data-testid="contract-terms-input" rows={10} value={form.contract_terms || ""} onChange={(e) => set("contract_terms", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-[#4B6370]">Standard exclusions (one per line)</Label>
            <p className="text-sm text-[#4B6370] mt-1 mb-2">These copy onto new contracts. You can still add or remove lines on a single contract.</p>
            <Textarea data-testid="exclusions-text-input" rows={8} value={form.exclusions_text || ""} onChange={(e) => set("exclusions_text", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-[#4B6370]">Change-order requirements</Label>
            <p className="text-sm text-[#4B6370] mt-1 mb-2">Use {"{markup}"} where the percentage should appear.</p>
            <Textarea data-testid="change-order-terms-input" rows={8} value={form.change_order_terms || ""} onChange={(e) => set("change_order_terms", e.target.value)} />
          </div>
          <div className="max-w-xs">
            <Label className="text-xs text-[#4B6370]">Default change-order markup (%)</Label>
            <Input className="mt-1" data-testid="default-markup-input" type="number" step="any" min="0" value={form.default_change_order_markup ?? 20} onChange={(e) => set("default_change_order_markup", e.target.value)} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" data-testid="pricing-defaults">
        <div className="flex items-center gap-2 px-6 py-4 bg-[#0B3A8F]">
          <Percent size={18} className="text-[#C9A227]" />
          <h2 className="text-white font-['Outfit'] font-semibold">Estimate Pricing</h2>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-[#4B6370]">These fill in on new estimates and job sheets. Sales tax applies to materials only. The 5% tax is optional on each estimate.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-[#4B6370]">Default profit margin (%)</Label>
              <Input className="mt-1" data-testid="default-profit-margin" type="number" step="any" min="0" value={form.default_profit_margin ?? 20} onChange={(e) => set("default_profit_margin", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-[#4B6370]">Card fee (%)</Label>
              <Input className="mt-1" data-testid="cc-fee-pct" type="number" step="any" min="0" value={form.credit_card_fee_pct ?? 3} onChange={(e) => set("credit_card_fee_pct", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-[#4B6370]">Sales tax on materials (%)</Label>
              <Input className="mt-1" data-testid="sales-tax-pct" type="number" step="any" min="0" value={form.sales_tax_pct ?? 6} onChange={(e) => set("sales_tax_pct", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-[#4B6370]">Optional federal + state tax (%)</Label>
              <Input className="mt-1" data-testid="optional-tax-pct" type="number" step="any" min="0" value={form.optional_tax_pct ?? 5} onChange={(e) => set("optional_tax_pct", e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <Button data-testid="save-settings-btn" onClick={() => save.mutate(payload())} disabled={save.isPending} className="gap-1.5 bg-[#0B3A8F] hover:bg-[#082C73]">
        <Save size={16} /> {save.isPending ? "Saving…" : "Save Profile"}
      </Button>
    </div>
  );
}
