import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { BRAND } from "@/lib/format";
import { publicBidFileHref } from "@/lib/bidFiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FloorPlanCanvas from "@/components/floorplan/FloorPlanCanvas";
import FloorPlan3D from "@/components/floorplan/FloorPlan3D";
import { activeLevel } from "@/lib/floorPlan/model";
import { defaultLayers } from "@/lib/floorPlan/layers";
import { toast } from "sonner";
import { Box, FileText, Loader2, Send, Upload } from "lucide-react";

const TABS = [
  { id: "package", label: "Package" },
  { id: "plan", label: "Floor plan / 3D" },
  { id: "bid", label: "Your bid" },
  { id: "messages", label: "Questions" },
];

const REQUEST_KINDS = [
  { id: "photo", label: "Need photos" },
  { id: "video", label: "Need video" },
  { id: "walkthrough", label: "Need walkthrough" },
  { id: "measurement", label: "Need measurements" },
  { id: "other", label: "Other request" },
];

export default function PublicBid() {
  const { token } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState("package");
  const [show3d, setShow3d] = useState(false);
  const [form, setForm] = useState({ amount: "", notes: "", exclusions: "", timeline: "" });
  const [message, setMessage] = useState("");
  const [asQuestion, setAsQuestion] = useState(true);
  const [requestKind, setRequestKind] = useState("");
  const pdfRef = useRef(null);
  const fileRef = useRef(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-bid", token],
    enabled: Boolean(token),
    refetchInterval: 4000,
    retry: false,
    queryFn: async () => (await api.get(`/public/sub/${token}`)).data,
  });

  useEffect(() => {
    const bid = data?.my_bid;
    if (!bid) return;
    setForm((prev) => (prev.amount ? prev : {
      amount: bid.amount ? String(bid.amount) : "",
      notes: bid.notes || "",
      exclusions: bid.exclusions || "",
      timeline: bid.timeline || "",
    }));
  }, [data?.my_bid]);

  const submit = useMutation({
    mutationFn: async () => (await api.post(`/public/sub/${token}/bid`, {
      amount: Number(form.amount),
      notes: form.notes,
      exclusions: form.exclusions,
      timeline: form.timeline,
    })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["public-bid", token] });
      toast.success("Bid submitted. You can revise it after we answer questions.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not submit that bid.")),
  });

  const decline = useMutation({
    mutationFn: async () => (await api.post(`/public/sub/${token}/decline`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["public-bid", token] }),
  });

  const sendMsg = useMutation({
    mutationFn: async () => (await api.post(`/public/sub/${token}/messages`, {
      body: message,
      question: Boolean(asQuestion || requestKind),
      request_kind: requestKind || "",
    })).data,
    onSuccess: () => {
      const kind = requestKind;
      setMessage("");
      setRequestKind("");
      qc.invalidateQueries({ queryKey: ["public-bid", token] });
      toast.success(kind ? "Media request sent to Revival" : "Message sent");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not send that message.")),
  });

  const uploadPdf = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    try {
      await api.post(`/public/sub/${token}/bid-pdf`, body, { timeout: 120000 });
      qc.invalidateQueries({ queryKey: ["public-bid", token] });
      toast.success("Official bid PDF saved to this job.");
    } catch (err) {
      toast.error(await formatApiError(err, "Could not upload that PDF."));
    }
  };

  const uploadAsk = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    body.append("note", message || "Please review this file.");
    try {
      await api.post(`/public/sub/${token}/message-file`, body, { timeout: 120000 });
      setMessage("");
      qc.invalidateQueries({ queryKey: ["public-bid", token] });
      toast.success("File sent to Revival.");
    } catch (err) {
      toast.error(await formatApiError(err, "Could not send that file."));
    }
  };

  const plan = data?.plans?.[0];
  const level = useMemo(() => (plan?.document ? activeLevel(plan.document) : null), [plan]);
  const layers = useMemo(() => defaultLayers(), []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B3A8F]">
        <Loader2 className="animate-spin text-white" size={32} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F7F8] p-6 text-center font-['Work_Sans']">
        <img src={BRAND.logo} alt="Revival Home Remodeling" className="h-24 w-auto mb-6" />
        <h1 className="text-2xl font-semibold font-['Outfit'] text-[#061A23]">Link not found</h1>
        <p className="text-[#4B6370] mt-2">This bid invitation is invalid or has expired. Please contact Revival Home Remodeling.</p>
      </div>
    );
  }

  const pkg = data.package;
  const closed = data.invitation?.status === "declined" || pkg.status === "closed";

  return (
    <div className="min-h-screen bg-[#F4F7F8] font-['Work_Sans'] pb-16" data-testid="public-bid">
      <header className="bg-[#0B3A8F] text-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <img src="/brand/revival-mark.svg" alt="" className="h-12 w-12" />
          <div className="min-w-0">
            <div className="font-['Outfit'] font-semibold text-lg leading-tight">{data.company?.name || "Revival Home Remodeling"}</div>
            <div className="text-white/75 text-sm truncate">{pkg.scope} · {data.job?.job_number} · {data.job?.name}</div>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4">
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-wrap gap-3 text-sm text-[#4B6370]">
          <span>Due {pkg.due_at ? new Date(pkg.due_at).toLocaleString() : "see package"}</span>
          <span>Status: {data.invitation?.status}</span>
          {data.my_bid?.amount ? <span className="text-[#0B3A8F] font-medium">Your bid ${Number(data.my_bid.amount).toLocaleString()}</span> : null}
        </div>

        <div className="mt-4 flex gap-1 overflow-x-auto">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${tab === item.id ? "bg-[#0B3A8F] text-white" : "bg-white border border-slate-200 text-[#4B6370]"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "package" ? (
          <div className="mt-4 space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Scope</h2>
              <p className="mt-2 text-sm text-[#4B6370] whitespace-pre-wrap">{pkg.description}</p>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Plans, photos, and specs</h2>
              {(pkg.assets || []).length === 0 && !(data.plans || []).length ? (
                <p className="mt-2 text-sm text-[#4B6370]">Revival will add job-site photos and files here. Ask in Questions if you need a measurement or another video.</p>
              ) : (
                <div className="mt-3 grid sm:grid-cols-2 gap-2">
                  {(pkg.assets || []).map((asset) => (
                    <div key={asset.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-[#C9A227]">{String(asset.kind || "").replace(/_/g, " ")}</div>
                      <div className="font-medium truncate">{asset.name}</div>
                      {asset.url || asset.web_view_link || asset.file_id ? (
                        <a className="text-sm text-[#0B3A8F] hover:underline" href={publicBidFileHref(asset, token)} target="_blank" rel="noreferrer">Open</a>
                      ) : (
                        <div className="text-xs text-[#8AA0AB] mt-1">{asset.note || "Included in the Floor plan / 3D tab"}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {tab === "plan" ? (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-3 flex items-center justify-between bg-[#0B3A8F] text-white">
              <div className="font-['Outfit'] font-semibold">{plan?.name || "Floor plan"}</div>
              <button type="button" className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs" onClick={() => setShow3d((v) => !v)}>
                <Box size={14} /> {show3d ? "2D plan" : "3D view"}
              </button>
            </div>
            <div className="h-[min(70vh,640px)] relative bg-[#F3F1EC]">
              {!level ? (
                <div className="p-8 text-sm text-[#4B6370]">No floor plan is attached yet. Request photos or a layout in Questions.</div>
              ) : show3d ? (
                <FloorPlan3D level={level} layers={layers} phase="all" walkMode={false} onClose={() => setShow3d(false)} />
              ) : (
                <FloorPlanCanvas
                  level={level}
                  mode="select"
                  view={{ x: 24, y: 48, scale: 0.85 }}
                  onViewChange={() => {}}
                  selected={null}
                  onSelect={() => {}}
                  clientView
                  phase="all"
                  layers={layers}
                />
              )}
            </div>
          </section>
        ) : null}

        {tab === "bid" ? (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h2 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Submit your bid</h2>
            {closed ? (
              <p className="text-sm text-[#4B6370]">This invitation is closed.</p>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><Label>Bid amount (USD)</Label><Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="sub-bid-amount" /></div>
                  <div><Label>Timeline</Label><Input value={form.timeline} onChange={(e) => setForm({ ...form, timeline: e.target.value })} placeholder="e.g. 3 weeks after award" /></div>
                </div>
                <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                <div><Label>Exclusions</Label><Input value={form.exclusions} onChange={(e) => setForm({ ...form, exclusions: e.target.value })} /></div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" disabled={submit.isPending} onClick={() => submit.mutate()}>
                    {data.my_bid ? "Submit revision" : "Submit bid"}
                  </Button>
                  <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={uploadPdf} />
                  <Button type="button" variant="outline" className="gap-1 border-[#0B3A8F]/25 text-[#0B3A8F]" onClick={() => pdfRef.current?.click()}>
                    <Upload size={14} /> Official bid PDF
                  </Button>
                  <Button type="button" variant="outline" className="text-red-600" onClick={() => decline.mutate()}>Decline</Button>
                </div>
                {data.my_bid?.pdf?.filename ? (
                  <div className="text-sm text-[#4B6370] flex items-center gap-1">
                    <FileText size={14} /> {data.my_bid.pdf.filename} on file
                    {data.my_bid.pdf.web_view_link || data.my_bid.pdf.file_id ? (
                      <a className="text-[#0B3A8F] hover:underline" href={publicBidFileHref(data.my_bid.pdf, token)} target="_blank" rel="noreferrer">Open</a>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-[#8AA0AB]">Upload your official bid PDF. Revival stores it on this job (and in the job’s Google Drive folder when connected).</p>
                )}
              </>
            )}
          </section>
        ) : null}

        {tab === "messages" ? (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h2 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Ask for photos, video, or a walkthrough</h2>
            <p className="text-sm text-[#4B6370]">
              After you review the package, request what you still need. Revival will shoot it on-site or schedule a walkthrough.
            </p>
            <div className="space-y-2 max-h-[360px] overflow-y-auto">
              {(data.messages || []).map((msg) => (
                <div key={msg.id} className={`rounded-xl border p-3 ${msg.author_kind === "sub" ? "border-[#0B3A8F]/20 bg-[#0B3A8F]/5" : "border-slate-200"}`}>
                  <div className="text-[11px] text-[#8AA0AB] flex flex-wrap gap-2 items-center">
                    <span>{msg.author_name} · {new Date(msg.created_at).toLocaleString()}</span>
                    {msg.request_kind ? (
                      <span className="rounded-full bg-[#C9A227]/20 text-[#8a6f17] px-2 py-0.5 font-medium uppercase tracking-wide">
                        {msg.request_kind}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm whitespace-pre-wrap">{msg.body}</div>
                  {(msg.attachments || []).map((att) => (
                    att.web_view_link || att.url || att.file_id ? (
                      <a key={att.id || att.filename} className="mt-1 inline-block text-xs text-[#0B3A8F] hover:underline" href={publicBidFileHref(att, token)} target="_blank" rel="noreferrer">
                        {att.filename}
                      </a>
                    ) : null
                  ))}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {REQUEST_KINDS.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    setRequestKind((prev) => (prev === row.id ? "" : row.id));
                    setAsQuestion(true);
                    if (!message.trim()) {
                      const presets = {
                        photo: "Please add clear photos of: ",
                        video: "Please shoot a short walkthrough video showing: ",
                        walkthrough: "Please schedule an on-site walkthrough so we can verify: ",
                        measurement: "Please confirm these measurements: ",
                        other: "",
                      };
                      setMessage(presets[row.id] || "");
                    }
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-medium border ${
                    requestKind === row.id
                      ? "bg-[#0B3A8F] text-white border-[#0B3A8F]"
                      : "bg-white text-[#4B6370] border-slate-200"
                  }`}
                  data-testid={`request-kind-${row.id}`}
                >
                  {row.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-[#4B6370]">
              <input type="checkbox" checked={asQuestion} onChange={(e) => setAsQuestion(e.target.checked)} />
              Mark as a question that needs an answer
            </label>
            <div className="flex gap-2">
              <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Need a sink-wall photo, a rough-in dimension, or a walkthrough video?" />
              <Button type="button" className="h-10 bg-[#0B3A8F] hover:bg-[#082C73] gap-1" disabled={!message.trim() || sendMsg.isPending} onClick={() => sendMsg.mutate()}>
                <Send size={14} /> Send
              </Button>
            </div>
            <input ref={fileRef} type="file" accept="image/*,video/*,.pdf,.heic,.mov,.mp4" capture="environment" className="hidden" onChange={uploadAsk} />
            <Button type="button" variant="outline" className="gap-1" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Attach photo or video
            </Button>
          </section>
        ) : null}
      </div>
    </div>
  );
}
