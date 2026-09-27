import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { usd } from "@/lib/format";
import { openGcBidFile } from "@/lib/bidFiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowLeft, Award, Copy, FileText, HardHat, Image as ImageIcon, Send, Upload,
} from "lucide-react";

const TABS = [
  { id: "package", label: "Package" },
  { id: "invites", label: "Invites" },
  { id: "compare", label: "Compare & award" },
  { id: "messages", label: "Messages" },
  { id: "activity", label: "Activity" },
];

function statusChip(status) {
  const map = {
    invited: "bg-slate-100 text-[#4B6370]",
    viewed: "bg-sky-50 text-sky-800",
    submitted: "bg-amber-50 text-[#8A7018]",
    declined: "bg-red-50 text-red-700",
    awarded: "bg-emerald-50 text-emerald-800",
    open: "bg-emerald-50 text-emerald-800",
    draft: "bg-slate-100 text-[#4B6370]",
    closed: "bg-slate-100 text-[#4B6370]",
  };
  return map[status] || map.invited;
}

export default function BidPackageDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState("package");
  const [invite, setInvite] = useState({ subcontractor_id: "", email: "", name: "" });
  const [inviteLinks, setInviteLinks] = useState({});
  const [message, setMessage] = useState("");
  const [answerTo, setAnswerTo] = useState("");
  const [pkgForm, setPkgForm] = useState(null);
  const fileRef = useRef(null);
  const msgFileRef = useRef(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["bid-package", id],
    enabled: Boolean(id),
    refetchInterval: 4000,
    queryFn: async () => (await api.get(`/bid-packages/${id}`)).data,
  });
  const { data: directory = [] } = useQuery({
    queryKey: ["subcontractors"],
    queryFn: async () => {
      try {
        return (await api.get("/subcontractors")).data;
      } catch {
        return [];
      }
    },
  });
  const { data: meta } = useQuery({
    queryKey: ["sub-meta"],
    queryFn: async () => (await api.get("/subcontractor-meta")).data,
  });

  useEffect(() => {
    setPkgForm(null);
  }, [id]);

  useEffect(() => {
    const next = data?.package;
    if (!next || next.id !== id) return;
    setPkgForm((prev) => prev || {
      name: next.name || "",
      scope: next.scope || "Entire job",
      description: next.description || "",
      due_at: String(next.due_at || "").slice(0, 16),
    });
  }, [id, data?.package]);

  const sendInvite = useMutation({
    mutationFn: async () => (await api.post(`/bid-packages/${id}/invite`, invite)).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["bid-package", id] });
      setInvite({ subcontractor_id: "", email: "", name: "" });
      if (res?.id && res?.invite_url) setInviteLinks((prev) => ({ ...prev, [res.id]: res.invite_url }));
      toast.success("Invitation sent.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not send that invitation.")),
  });

  const award = useMutation({
    mutationFn: async (invitationId) => (await api.post(`/bid-packages/${id}/award`, { invitation_id: invitationId })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bid-package", id] });
      toast.success("Awarded. The bid PDF stays on this job.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not award that bid.")),
  });

  const postMessage = useMutation({
    mutationFn: async () => (await api.post(`/bid-packages/${id}/messages`, { body: message, answer_to: answerTo })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bid-package", id] });
      setMessage("");
      setAnswerTo("");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not send that message.")),
  });

  const savePackage = useMutation({
    mutationFn: async () => (await api.put(`/bid-packages/${id}`, pkgForm)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bid-package", id] });
      toast.success("Package updated.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not update that package.")),
  });

  const onUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const body = new FormData();
    const kind = file.type.startsWith("image/") ? "photo_during" : file.type.startsWith("video/") ? "bid_asset" : file.type.includes("pdf") ? "materials_list" : "bid_asset";
    body.append("kind", kind);
    body.append("file", file);
    try {
      await api.post(`/bid-packages/${id}/assets`, body, { timeout: 120000 });
      qc.invalidateQueries({ queryKey: ["bid-package", id] });
      toast.success("Added to the bid package and saved with the job.");
    } catch (err) {
      toast.error(await formatApiError(err, "Could not attach that file."));
    }
  };

  const pkg = data?.package;
  const bidsByInvite = useMemo(() => {
    const map = {};
    (data?.bids || []).forEach((bid) => {
      const current = map[bid.invitation_id];
      if (!current || Number(bid.revision || 0) > Number(current.revision || 0)) map[bid.invitation_id] = bid;
    });
    return map;
  }, [data?.bids]);

  if (isLoading) return <div className="text-[#4B6370]">Loading bid package…</div>;
  if (isError || !pkg) return <div className="text-[#4B6370]">That bid package could not be found.</div>;

  const unanswered = Number(data.unanswered || 0);

  return (
    <div className="space-y-5" data-testid="bid-package-detail">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button type="button" onClick={() => navigate(`/jobs/${pkg.job_id}?room=bids`)} className="flex items-center gap-1.5 text-sm font-medium text-[#0B3A8F] hover:underline">
            <ArrowLeft size={16} /> Job bids
          </button>
          <h1 className="mt-2 text-2xl sm:text-4xl font-['Outfit'] font-semibold text-[#061A23]">{pkg.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#4B6370]">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusChip(pkg.status)}`}>{pkg.status}</span>
            <span>{pkg.scope}</span>
            <span>{data.job?.job_number}</span>
            {pkg.due_at ? <span>Due {new Date(pkg.due_at).toLocaleString()}</span> : null}
            {unanswered ? <span className="text-[#C45C26] font-medium">{unanswered} unanswered</span> : null}
          </div>
        </div>
        <Link to={`/jobs/${pkg.job_id}`} className="text-sm text-[#0B3A8F] hover:underline">Open job</Link>
      </div>

      <div className="flex gap-1 overflow-x-auto">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${tab === item.id ? "bg-[#0B3A8F] text-white" : "bg-white border border-slate-200 text-[#4B6370]"}`}
          >
            {item.label}{item.id === "messages" && unanswered ? ` (${unanswered})` : ""}
          </button>
        ))}
      </div>

      {tab === "package" ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h2 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Scope & due date</h2>
            {pkgForm ? (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Name</Label>
                    <Input value={pkgForm.name} onChange={(e) => setPkgForm({ ...pkgForm, name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Scope</Label>
                    <select
                      className="h-10 w-full rounded-md border border-slate-200 px-2 text-sm bg-white"
                      value={pkgForm.scope}
                      onChange={(e) => setPkgForm({ ...pkgForm, scope: e.target.value })}
                    >
                      {(meta?.scopes || [pkg.scope]).map((scope) => (
                        <option key={scope} value={scope}>{scope}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Due</Label>
                    <Input type="datetime-local" value={pkgForm.due_at} onChange={(e) => setPkgForm({ ...pkgForm, due_at: e.target.value })} />
                  </div>
                </div>
                <textarea
                  className="w-full min-h-[96px] rounded-md border border-slate-200 px-3 py-2 text-sm"
                  value={pkgForm.description}
                  onChange={(e) => setPkgForm({ ...pkgForm, description: e.target.value })}
                />
                <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" disabled={savePackage.isPending} onClick={() => savePackage.mutate()}>
                  Save package
                </Button>
              </>
            ) : (
              <p className="text-sm text-[#4B6370] whitespace-pre-wrap">{pkg.description}</p>
            )}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Job assets</h2>
              <div>
                <input ref={fileRef} type="file" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" className="hidden" onChange={onUpload} />
                <Button type="button" className="h-9 bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23] gap-1" onClick={() => fileRef.current?.click()}>
                  <Upload size={14} /> Photo, video, or spec
                </Button>
              </div>
            </div>
            {(pkg.assets || []).length === 0 ? (
              <p className="mt-3 text-sm text-[#4B6370]">No floor plans or files yet. Upload job-site photos and videos, or attach a plan on the job first.</p>
            ) : (
              <div className="mt-3 grid sm:grid-cols-2 gap-2">
                {(pkg.assets || []).map((asset) => (
                  <div key={asset.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-[#C9A227]">{asset.kind?.replace(/_/g, " ")}</div>
                    <div className="font-medium text-[#061A23] truncate">{asset.name}</div>
                    <div className="mt-2 flex gap-2 text-sm">
                      {asset.studio_url ? <Link className="text-[#0B3A8F] hover:underline" to={asset.studio_url}>Open in Studio</Link> : null}
                      {asset.url || asset.web_view_link || asset.file_id ? (
                        <button type="button" className="text-[#0B3A8F] hover:underline" onClick={() => openGcBidFile(asset).catch(() => toast.error("Could not open that file."))}>
                          Open file
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "invites" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Invite a trade</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>From directory</Label>
              <select
                className="h-10 w-full rounded-md border border-slate-200 px-2 text-sm bg-white"
                value={invite.subcontractor_id}
                onChange={(e) => {
                  const row = directory.find((d) => d.id === e.target.value);
                  setInvite({
                    subcontractor_id: e.target.value,
                    email: row?.email || "",
                    name: row?.contact_name || row?.company_name || "",
                  });
                }}
              >
                <option value="">Choose a company</option>
                {directory.map((row) => (
                  <option key={row.id} value={row.id}>{row.company_name}</option>
                ))}
              </select>
            </div>
            <div><Label>Or email</Label><Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="trade@example.com" /></div>
          </div>
          <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" disabled={sendInvite.isPending} onClick={() => sendInvite.mutate()}>Send invitation</Button>
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {(data.invitations || []).length === 0 ? (
              <p className="py-6 text-sm text-[#4B6370]">No invitations yet. Pick a trusted trade or send an email.</p>
            ) : (data.invitations || []).map((row) => (
              <div key={row.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{row.company_name || row.name}</div>
                  <div className="text-sm text-[#4B6370]">{row.email}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusChip(row.status)}`}>{row.status}</span>
                {inviteLinks[row.id] ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteLinks[row.id]);
                      toast.success("Invite link copied.");
                    }}
                  >
                    <Copy size={14} /> Copy link
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "compare" ? (
        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-[#0B3A8F] text-white font-['Outfit'] font-semibold">Side-by-side · {pkg.scope}</div>
          {(data.invitations || []).filter((row) => bidsByInvite[row.id] || row.status === "submitted" || row.status === "awarded").length === 0 ? (
            <div className="p-8 text-center text-[#4B6370]">
              <HardHat className="mx-auto text-[#C9A227]" size={28} />
              <p className="mt-2">Bids land here as soon as a sub submits. You do not need to refresh.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[#4B6370] border-b border-slate-100">
                    <th className="p-3">Company</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Timeline</th>
                    <th className="p-3">Notes / exclusions</th>
                    <th className="p-3">PDF</th>
                    <th className="p-3">Date</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {(data.invitations || []).map((row) => {
                    const bid = bidsByInvite[row.id];
                    if (!bid && row.status !== "awarded") return null;
                    return (
                      <tr key={row.id} className="border-t border-slate-100 align-top">
                        <td className="p-3">
                          <div className="font-medium">{row.company_name || row.name}</div>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusChip(row.status)}`}>{row.status}</span>
                        </td>
                        <td className="p-3 font-['Outfit'] font-semibold">{bid?.amount ? usd(bid.amount) : "—"}</td>
                        <td className="p-3 text-[#4B6370]">{bid?.timeline || "—"}</td>
                        <td className="p-3 text-[#4B6370] max-w-xs">
                          <div>{bid?.notes || "—"}</div>
                          {bid?.exclusions ? <div className="text-[11px] mt-1">Excl: {bid.exclusions}</div> : null}
                        </td>
                        <td className="p-3">
                          {bid?.pdf?.web_view_link || bid?.pdf?.file_id ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[#0B3A8F] hover:underline"
                              onClick={() => openGcBidFile(bid.pdf).catch(() => toast.error("Could not open that PDF."))}
                            >
                              <FileText size={14} /> {bid.pdf.filename || "Bid PDF"}
                            </button>
                          ) : "—"}
                        </td>
                        <td className="p-3 text-[#8AA0AB] whitespace-nowrap">{bid?.updated_at ? new Date(bid.updated_at).toLocaleString() : "—"}</td>
                        <td className="p-3">
                          {pkg.status === "awarded" && pkg.awarded_invitation_id === row.id ? (
                            <span className="text-emerald-800 text-xs font-semibold">Awarded</span>
                          ) : (
                            <Button type="button" size="sm" className="h-8 bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23] gap-1" onClick={() => award.mutate(row.id)} disabled={award.isPending || row.status === "declined"}>
                              <Award size={14} /> Award
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {tab === "messages" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Thread</h2>
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {(data.messages || []).length === 0 ? (
              <p className="text-sm text-[#4B6370]">Subs ask for extra photos, measurements, or video here. Unanswered questions stay highlighted.</p>
            ) : (data.messages || []).map((msg) => (
              <div key={msg.id} className={`rounded-xl border p-3 ${msg.question && !msg.answered ? "border-[#C45C26]/40 bg-[#C45C26]/5" : "border-slate-200"}`}>
                <div className="flex justify-between gap-2 text-[11px] text-[#8AA0AB]">
                  <span className="flex flex-wrap items-center gap-2">
                    {msg.author_kind === "gc" ? "Revival" : msg.author_name} · {new Date(msg.created_at).toLocaleString()}
                    {msg.request_kind ? (
                      <span className="rounded-full bg-[#C9A227]/25 text-[#8a6f17] px-2 py-0.5 font-semibold uppercase tracking-wide">
                        {msg.request_kind === "walkthrough" ? "Walkthrough requested" : `${msg.request_kind} requested`}
                      </span>
                    ) : null}
                  </span>
                  {msg.question && !msg.answered ? (
                    <button type="button" className="text-[#C45C26] font-medium" onClick={() => setAnswerTo(msg.id)}>Reply</button>
                  ) : null}
                </div>
                <div className="mt-1 text-sm whitespace-pre-wrap">{msg.body}</div>
                {(msg.attachments || []).map((att) => (
                  att.web_view_link || att.url || att.file_id ? (
                    <button
                      key={att.id || att.filename}
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-[#0B3A8F]"
                      onClick={() => openGcBidFile(att).catch(() => toast.error("Could not open that file."))}
                    >
                      <ImageIcon size={12} /> {att.filename}
                    </button>
                  ) : null
                ))}
              </div>
            ))}
          </div>
          {answerTo ? <div className="text-xs text-[#8A7018]">Replying to an open question</div> : null}
          <div className="flex gap-2">
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Answer, send a measurement, or ask them to upload video" />
            <Button type="button" className="h-10 bg-[#0B3A8F] hover:bg-[#082C73] gap-1" disabled={!message.trim() || postMessage.isPending} onClick={() => postMessage.mutate()}>
              <Send size={14} /> Send
            </Button>
          </div>
          <input
            ref={msgFileRef}
            type="file"
            accept="image/*,video/*,.pdf"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const body = new FormData();
              body.append("file", file);
              body.append("note", message || "");
              if (answerTo) body.append("answer_to", answerTo);
              try {
                await api.post(`/bid-packages/${id}/message-file`, body, { timeout: 120000 });
                setMessage("");
                setAnswerTo("");
                qc.invalidateQueries({ queryKey: ["bid-package", id] });
                toast.success("File sent.");
              } catch (err) {
                toast.error(await formatApiError(err, "Could not attach that file."));
              }
            }}
          />
          <Button type="button" variant="outline" className="gap-1" onClick={() => msgFileRef.current?.click()}>
            <Upload size={14} /> Attach photo, video, or file
          </Button>
        </section>
      ) : null}

      {tab === "activity" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Activity</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data.activity || []).map((row) => (
              <li key={row.id} className="flex gap-2">
                <span className="text-[#C9A227] font-medium shrink-0">{row.kind}</span>
                <span className="text-[#4B6370]">{row.text}</span>
                <span className="ml-auto text-[11px] text-[#8AA0AB] whitespace-nowrap">{row.created_at ? new Date(row.created_at).toLocaleString() : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
