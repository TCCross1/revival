import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { usdCents } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { depositStatusLabel, hasNativeSquareReader, requestNativeSquareReader } from "@/lib/jobFunds";

export default function CollectDeposit({ jobId, open, onOpenChange, suggestedAmount = 0, field = false }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [park, setPark] = useState(true);
  const [sendReceipt, setSendReceipt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (open) {
      setAmount(suggestedAmount ? String(suggestedAmount) : "");
      setNotes("");
      setPark(true);
      setSendReceipt(true);
      setActive(null);
    }
  }, [open, suggestedAmount]);

  useEffect(() => {
    if (!open) return undefined;
    window.revivalSquarePayment = async (payload) => {
      if (!payload?.ok) {
        toast.error(payload?.error || "Square Reader did not complete the payment.");
        return;
      }
      if (!active?.id) return;
      try {
        const res = (await api.post(`/jobs/${jobId}/deposits/${active.id}/complete`, {
          source_id: payload.source_id || "",
          square_payment_id: payload.square_payment_id || "",
        })).data;
        if (res?.deposit) setActive(res.deposit);
        qc.invalidateQueries({ queryKey: ["job-funds", jobId] });
      } catch (err) {
        toast.error(await formatApiError(err, "Could not finish the Reader payment."));
      }
    };
    return () => {
      delete window.revivalSquarePayment;
    };
  }, [open, active?.id, jobId, qc]);

  const { data: poll } = useQuery({
    queryKey: ["job-deposit", jobId, active?.id],
    enabled: Boolean(open && jobId && active?.id) && ["pending"].includes(active?.status || "pending"),
    refetchInterval: 2500,
    queryFn: async () => (await api.get(`/jobs/${jobId}/deposits/${active.id}`)).data,
  });

  useEffect(() => {
    if (!poll?.deposit) return;
    setActive(poll.deposit);
    if (poll.deposit.status === "received") {
      qc.invalidateQueries({ queryKey: ["job-funds", jobId] });
      qc.invalidateQueries({ queryKey: ["job-sheet", jobId] });
      toast.success(`Deposit of ${usdCents(poll.deposit.amount)} recorded and parked when Square Banking is available.`);
    }
    if (poll.deposit.status === "failed") {
      toast.error(poll.deposit.error_message || "Square did not complete this payment.");
    }
  }, [poll, jobId, qc]);

  const collect = useMutation({
    mutationFn: async (method) => (await api.post(`/jobs/${jobId}/deposits/collect`, {
      amount: Number(amount),
      notes,
      park,
      send_receipt: sendReceipt,
      method,
    })).data,
    onSuccess: async (res) => {
      const deposit = res.deposit;
      setActive(deposit);
      qc.invalidateQueries({ queryKey: ["job-funds", jobId] });
      if (res.native && hasNativeSquareReader()) {
        requestNativeSquareReader({
          action: "collect",
          jobId,
          depositId: deposit.id,
          amount: Number(amount),
        });
        toast.message("Present the Square Reader to the client.");
        return;
      }
      if (res.checkout?.url) {
        window.open(res.checkout.url, "_blank", "noopener,noreferrer");
        toast.message("Finish the payment in Square, then this screen will update.");
        return;
      }
      if (res.checkout?.id) {
        toast.message("Take the card on the Square Reader. This screen updates when Square confirms.");
        return;
      }
      toast.success("Deposit started.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not start deposit collection.")),
  });

  const onCollect = async () => {
    const value = Number(amount);
    if (!value || value <= 0) {
      toast.error("Enter a deposit amount greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const method = hasNativeSquareReader() ? "native" : "terminal";
      await collect.mutateAsync(method);
    } finally {
      setBusy(false);
    }
  };

  const received = active?.status === "received";
  const failed = active?.status === "failed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={field ? "bg-[#0B1C24] border-white/10 text-white" : ""} data-testid="collect-deposit-dialog">
        <DialogHeader>
          <DialogTitle className="font-['Outfit']">Collect deposit</DialogTitle>
        </DialogHeader>
        {received ? (
          <div className="space-y-3" data-testid="collect-deposit-success">
            <p className="text-sm">Payment received. Revival Pro recorded this deposit on the job{park ? " and will park the net amount in the job’s Square Savings folder" : ""}.</p>
            <div className="rounded-xl border border-[#C9A227]/40 bg-[#C9A227]/10 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-[#4B6370]">Amount</div>
              <div className="text-2xl font-semibold font-['Outfit']">{usdCents(active.amount)}</div>
              <div className="text-sm mt-1">{depositStatusLabel(active.status)}{active.net_amount ? ` · net ${usdCents(active.net_amount)}` : ""}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Amount</Label>
              <Input
                className="mt-1"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="collect-deposit-amount"
              />
              <p className="text-xs text-[#4B6370] mt-1">Pre-filled from the job sheet. You can change it before taking the card.</p>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Signing deposit, progress payment…" />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={park} onChange={(e) => setPark(e.target.checked)} className="mt-1" />
              Park the net amount in this job’s Square Savings folder after Square confirms the payment.
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={sendReceipt} onChange={(e) => setSendReceipt(e.target.checked)} className="mt-1" />
              Email a professional receipt and save the PDF to the client’s Google Drive folder.
            </label>
            {active?.status === "pending" ? (
              <div className="rounded-lg border border-[#C9A227]/40 bg-[#FBF6E8] px-3 py-2 text-sm text-[#061A23]">
                Waiting for Square… {active.checkout_url ? "Complete the payment in the Square window." : "Present the card on the Reader."}
              </div>
            ) : null}
            {failed ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{active.error_message || "Payment failed."}</div>
            ) : null}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{received ? "Done" : "Cancel"}</Button>
          {!received ? (
            <Button
              type="button"
              className="bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23]"
              onClick={onCollect}
              disabled={busy || collect.isPending || active?.status === "pending"}
              data-testid="collect-deposit-submit"
            >
              {busy || collect.isPending || active?.status === "pending" ? "Waiting for Square…" : "Collect with Square"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
