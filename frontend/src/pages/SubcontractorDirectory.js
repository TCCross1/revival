import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { HardHat, Plus, Pencil, Trash2, Star } from "lucide-react";

const emptyForm = () => ({
  company_name: "",
  contact_name: "",
  email: "",
  phone: "",
  categories: [],
  license_number: "",
  insurance_expires: "",
  insurance_status: "unknown",
  notes: "",
  rating: "",
  review_count: "",
  city: "Lexington, KY",
  website: "",
});

export default function SubcontractorDirectory() {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm());
  const [editing, setEditing] = useState("");
  const [filter, setFilter] = useState("");
  const [tradeFilter, setTradeFilter] = useState("");

  const { data: meta } = useQuery({
    queryKey: ["sub-meta"],
    queryFn: async () => (await api.get("/subcontractor-meta")).data,
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["subcontractors"],
    queryFn: async () => (await api.get("/subcontractors")).data,
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        categories: form.categories,
        rating: Number(form.rating || 0),
        review_count: Number(form.review_count || 0),
      };
      if (editing) return (await api.put(`/subcontractors/${editing}`, payload)).data;
      return (await api.post("/subcontractors", payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      setForm(emptyForm());
      setEditing("");
      toast.success(editing ? "Subcontractor updated" : "Added to the directory");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save that subcontractor.")),
  });

  const remove = useMutation({
    mutationFn: async (id) => (await api.delete(`/subcontractors/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      toast.success("Removed from the directory");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not remove that company.")),
  });

  const categories = meta?.categories || [];
  const visible = rows.filter((row) => {
    if (tradeFilter && !(row.categories || []).includes(tradeFilter)) return false;
    if (!filter) return true;
    const hay = `${row.company_name} ${row.contact_name} ${(row.categories || []).join(" ")} ${row.city || ""}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
  });

  const toggleCat = (id) => {
    setForm((prev) => ({
      ...prev,
      categories: prev.categories.includes(id) ? prev.categories.filter((c) => c !== id) : [...prev.categories, id],
    }));
  };

  return (
    <div className="space-y-6" data-testid="subcontractor-directory">
      <div>
        <h1 className="text-3xl sm:text-4xl font-['Outfit'] font-semibold text-[#061A23]">Subcontractor directory</h1>
        <p className="mt-1 text-[#4B6370]">
          Central Kentucky trades ranked by public review volume, then star rating. Foundations is included. Verify license/insurance before award.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-[#0B3A8F] font-['Outfit'] font-semibold">
          <Plus size={18} /> {editing ? "Edit company" : "Add a trade"}
        </div>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <div><Label>Company</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} data-testid="sub-company" /></div>
          <div><Label>Contact</Label><Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="sub-email" /></div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><Label>License #</Label><Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} /></div>
          <div>
            <Label>Insurance expires</Label>
            <Input type="date" value={form.insurance_expires} onChange={(e) => setForm({ ...form, insurance_expires: e.target.value })} />
          </div>
          <div>
            <Label>Stars (0–5)</Label>
            <Input type="number" step="0.1" min="0" max="5" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} />
          </div>
          <div>
            <Label>Review count</Label>
            <Input type="number" min="0" value={form.review_count} onChange={(e) => setForm({ ...form, review_count: e.target.value })} />
          </div>
        </div>
        <div className="mt-3">
          <Label>Trades</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCat(cat)}
                className={`rounded-full px-3 py-1 text-xs font-medium border ${form.categories.includes(cat) ? "bg-[#0B3A8F] text-white border-[#0B3A8F]" : "bg-white text-[#4B6370] border-slate-200"}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Past work, rates, preferences" /></div>
        <div className="mt-4 flex gap-2">
          <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" disabled={save.isPending || !form.company_name.trim()} onClick={() => save.mutate()} data-testid="sub-save">
            {editing ? "Save changes" : "Add to directory"}
          </Button>
          {editing ? <Button type="button" variant="outline" onClick={() => { setEditing(""); setForm(emptyForm()); }}>Cancel</Button> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 bg-[#0B3A8F] flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <h2 className="text-white font-['Outfit'] font-semibold">Directory · ranked</h2>
            <Input className="h-9 sm:ml-auto sm:max-w-xs bg-white" placeholder="Filter by name or trade" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setTradeFilter("")}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${!tradeFilter ? "bg-[#C9A227] text-[#061A23]" : "bg-white/15 text-white"}`}
            >
              All trades
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setTradeFilter(cat)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tradeFilter === cat ? "bg-[#C9A227] text-[#061A23]" : "bg-white/15 text-white"}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        {isLoading ? (
          <div className="p-6 text-[#4B6370]">Loading the directory…</div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center">
            <HardHat className="mx-auto text-[#C9A227]" size={32} />
            <p className="mt-2 text-[#4B6370]">No trades match. Add a company or clear the filter.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visible.map((row, idx) => (
              <div key={row.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2" data-testid={`sub-row-${row.id}`}>
                <div className="text-xs font-semibold text-[#8AA0AB] w-8">#{idx + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-['Outfit'] font-semibold text-[#061A23] flex flex-wrap items-center gap-2">
                    {row.company_name}
                    {Number(row.rating) > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#8a6f17]">
                        <Star size={12} className="fill-[#C9A227] text-[#C9A227]" />
                        {Number(row.rating).toFixed(1)} · {Number(row.review_count || 0).toLocaleString()} reviews
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-[#4B6370]">
                    {row.city || "Lexington, KY"}
                    {row.contact_name ? ` · ${row.contact_name}` : ""}
                    {row.email ? ` · ${row.email}` : ""}
                    {row.phone ? ` · ${row.phone}` : ""}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(row.categories || []).map((cat) => (
                      <span key={cat} className="rounded-full bg-[#F4F7F8] px-2 py-0.5 text-[11px] text-[#0B3A8F]">{cat}</span>
                    ))}
                    {row.seeded ? <span className="text-[11px] text-[#8AA0AB]">Directory seed</span> : null}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => {
                      setEditing(row.id);
                      setForm({
                        ...emptyForm(),
                        ...row,
                        categories: row.categories || [],
                        rating: row.rating ?? "",
                        review_count: row.review_count ?? "",
                      });
                    }}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-9 text-red-600" onClick={() => remove.mutate(row.id)}><Trash2 size={14} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
