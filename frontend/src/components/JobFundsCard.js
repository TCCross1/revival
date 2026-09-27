import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { usdCents, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Landmark, Wallet } from "lucide-react";
import CollectDeposit from "@/components/CollectDeposit";
import { depositStatusLabel, folderStatusLabel } from "@/lib/jobFunds";
import { useAuth } from "@/context/AuthContext";
import { isFieldOnly } from "@/lib/permissions";

export default function JobFundsCard({ jobId, field = false }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const office = !isFieldOnly(user);
  const [collectOpen, setCollectOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);
  const [folderId, setFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [spendAmount, setSpendAmount] = useState("");
  const [spendNotes, setSpendNotes] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["job-funds", jobId],
    enabled: Boolean(jobId),
    refetchInterval: 8000,
    queryFn: async () => (await api.get(`/jobs/${jobId}/funds`)).data,
  });

  const createFolder = useMutation({
    mutationFn: async () => (await api.post(`/jobs/${jobId}/funds/folder`, { action: "create", name: folderName })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-funds", jobId] });
      setLinkOpen(false);
      toast.success("Square Savings folder linked to this job.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not create the Square Savings folder.")),
  });

  const linkFolder = useMutation({
    mutationFn: async () => (await api.post(`/jobs/${jobId}/funds/folder`, { action: "link", folder_id: folderId, name: folderName })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-funds", jobId] });
      setLinkOpen(false);
      toast.success("Existing Square Savings folder linked.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not link that folder.")),
  });

  const spend = useMutation({
    mutationFn: async () => (await api.post(`/jobs/${jobId}/funds/spend`, { amount: Number(spendAmount), notes: spendNotes })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-funds", jobId] });
      setSpendOpen(false);
      setSpendAmount("");
      setSpendNotes("");
      toast.success("Funds moved into Square Checking. You can spend on the Square debit card now.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not move funds into Square Checking.")),
  });

  const retryPark = useMutation({
    mutationFn: async (depositId) => (await api.post(`/jobs/${jobId}/deposits/${depositId}/park`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-funds", jobId] });
      toast.success("Parking retry sent to Square.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not park that deposit.")),
  });

  if (isLoading) return <div className={field ? "text-white/70" : "text-[#4B6370]"}>Loading job funds…</div>;
  if (isError || !data) return <div className={field ? "text-white/70" : "text-[#4B6370]"}>Job funds could not be loaded.</div>;

  const linked = Boolean(data.folder_id);
  const shell = field
    ? "rounded-2xl border border-white/10 bg-white/5 p-5"
    : "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const muted = field ? "text-white/60" : "text-[#4B6370]";
  const title = field ? "text-white" : "text-[#061A23]";

  return (
    <section className={shell} data-testid="job-funds-card">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className={`flex items-center gap-2 font-['Outfit'] font-semibold ${field ? "text-[#C9A227]" : "text-[#0B3A8F]"}`}>
            <Wallet size={16} /> Job Funds
          </div>
          <p className={`mt-1 text-sm ${muted}`}>
            {data.folder_name ? `${data.folder_name} · ${folderStatusLabel(data.folder_link_status)}` : "Link a Square Savings folder so every deposit parks on this job."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="h-10 bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23]" onClick={() => setCollectOpen(true)} data-testid="collect-deposit-btn">
            Collect Deposit
          </Button>
          {office ? (
            <>
              <Button type="button" variant="outline" className={field ? "border-white/20 text-white" : "border-[#0B3A8F]/25 text-[#0B3A8F]"} onClick={() => setLinkOpen(true)}>
                {linked ? "Change folder" : "Link folder"}
              </Button>
              <Button type="button" variant="outline" className={field ? "border-white/20 text-white" : "border-[#0B3A8F]/25 text-[#0B3A8F]"} onClick={() => setSpendOpen(true)} disabled={!linked}>
                Spend from funds
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FundStat label="Folder balance" value={usdCents(data.folder_balance)} field={field} />
        <FundStat label="Total deposited" value={usdCents(data.total_deposits)} field={field} />
        <FundStat label="Spent / allocated" value={usdCents(data.total_spent)} field={field} />
        <FundStat label="Remaining available" value={usdCents(data.remaining_available)} field={field} warn={Number(data.remaining_available) <= 0} />
      </div>
      <p className={`mt-2 text-sm ${muted}`}>Remaining on contract: {usdCents(data.remaining_on_contract)}</p>
      {data.banking_error ? (
        <div className="mt-3 rounded-lg border border-[#C9A227]/40 bg-[#FBF6E8] px-3 py-2 text-sm text-[#061A23]">
          {data.banking_error}
        </div>
      ) : null}

      {(data.deposits || []).length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={`${muted} text-left`}>
                <th className="py-2 font-medium">When</th>
                <th className="py-2 font-medium">Amount</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Park</th>
              </tr>
            </thead>
            <tbody>
              {data.deposits.slice(0, 8).map((row) => (
                <tr key={row.id} className={field ? "border-t border-white/10" : "border-t border-slate-100"}>
                  <td className={`py-2 ${title}`}>{fmtDate(row.received_at || row.created_at)}</td>
                  <td className={title}>{usdCents(row.amount)}</td>
                  <td>{depositStatusLabel(row.status)}</td>
                  <td>
                    {row.folder_transfer_id ? "Parked" : row.status === "received" && office ? (
                      <button type="button" className="text-[#0B3A8F] underline" onClick={() => retryPark.mutate(row.id)}>Retry park</button>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <CollectDeposit
        jobId={jobId}
        open={collectOpen}
        onOpenChange={setCollectOpen}
        suggestedAmount={data.suggested_deposit}
        field={field}
      />

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Square Savings folder</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#4B6370]">
            Default name: {data.folder_name_pattern || "{client_name} – {job_short_name}"}. Create a new folder, or paste an existing Square folder ID.
          </p>
          <div>
            <Label>Display name</Label>
            <Input className="mt-1" value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder={data.folder_name || ""} />
          </div>
          <div>
            <Label>Existing folder ID</Label>
            <Input className="mt-1 font-mono text-xs" value={folderId} onChange={(e) => setFolderId(e.target.value)} placeholder="Optional — from Square Dashboard" />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button type="button" variant="outline" className="border-[#0B3A8F]/25 text-[#0B3A8F]" disabled={!folderId || linkFolder.isPending} onClick={() => linkFolder.mutate()}>
              {linkFolder.isPending ? "Linking…" : "Link existing"}
            </Button>
            <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" disabled={createFolder.isPending} onClick={() => {
              if (!window.confirm("Create a new Square Savings folder for this job and link it permanently?")) return;
              createFolder.mutate();
            }}>
              {createFolder.isPending ? "Creating…" : "Create new folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={spendOpen} onOpenChange={setSpendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-['Outfit'] flex items-center gap-2"><Landmark size={16} /> Spend from this job’s funds</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#4B6370]">
            Square requires funds in Checking before debit-card spending. This moves money from the job folder into Square Checking first.
          </p>
          <div>
            <Label>Amount</Label>
            <Input className="mt-1" type="number" min="0.01" step="0.01" value={spendAmount} onChange={(e) => setSpendAmount(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Input className="mt-1" value={spendNotes} onChange={(e) => setSpendNotes(e.target.value)} placeholder="Materials run, dump trailer…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSpendOpen(false)}>Cancel</Button>
            <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" disabled={spend.isPending} onClick={() => {
              if (!window.confirm(`Move ${usdCents(spendAmount)} from this job’s Savings folder into Square Checking?`)) return;
              spend.mutate();
            }}>
              {spend.isPending ? "Transferring…" : "Transfer to Checking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function FundStat({ label, value, field, warn }) {
  return (
    <div className={field ? "rounded-xl bg-black/20 px-3 py-3" : "rounded-xl bg-slate-50 px-3 py-3"}>
      <div className={`text-[11px] uppercase tracking-wide ${field ? "text-white/50" : "text-[#4B6370]"}`}>{label}</div>
      <div className={`mt-1 text-lg font-semibold font-['Outfit'] ${warn ? "text-amber-600" : field ? "text-white" : "text-[#061A23]"}`}>{value}</div>
    </div>
  );
}
