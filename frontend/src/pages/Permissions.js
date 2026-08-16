import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const ROLE_ORDER = ["admin", "manager", "field"];

export default function Permissions() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["perm-matrix"],
    queryFn: async () => (await api.get("/permissions/matrix")).data,
  });
  const [roles, setRoles] = useState(null);
  const [rate, setRate] = useState(0.7);

  useEffect(() => {
    if (!data) return;
    setRoles(data.roles);
    setRate(data.mileage_rate);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => (await api.put("/permissions/matrix", { roles, mileage_rate: Number(rate) })).data,
    onSuccess: (res) => {
      setRoles(res.roles);
      qc.invalidateQueries({ queryKey: ["field-me"] });
      toast.success("Permissions saved");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save permissions.")),
  });

  if (!roles || !data) return <div className="text-[#4B6370]">Loading permissions…</div>;

  const groups = ["Office", "Field"];
  return (
    <div className="space-y-6" data-testid="permissions-page">
      <div>
        <h1 className="text-3xl font-['Outfit'] font-semibold">Roles & permissions</h1>
        <p className="text-[#4B6370] mt-1">Owner always has everything. Turn features on or off for managers and the crew.</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="bg-[#0A4D68] text-white">
              <th className="p-3 text-left font-medium">Feature</th>
              {ROLE_ORDER.map((role) => (
                <th key={role} className="p-3 text-center font-medium">{data.role_labels[role]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group}>
                <tr className="bg-[#F4F7F8]"><td colSpan={4} className="px-3 py-2 text-xs font-semibold uppercase text-[#0A4D68]">{group}</td></tr>
                {data.features.filter((f) => f.group === group).map((feature) => (
                  <tr key={feature.id} className="border-t border-slate-100">
                    <td className="p-3">{feature.name}</td>
                    {ROLE_ORDER.map((role) => (
                      <td key={role} className="p-3 text-center">
                        <input
                          type="checkbox"
                          disabled={role === "admin"}
                          checked={Boolean(roles[role]?.[feature.id])}
                          onChange={(e) => setRoles({
                            ...roles,
                            [role]: { ...roles[role], [feature.id]: e.target.checked },
                          })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 max-w-sm">
        <div className="text-xs font-semibold uppercase text-[#0A4D68]">Mileage rate (tax)</div>
        <Input className="mt-2 h-11" type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
        <p className="text-xs text-[#8AA0AB] mt-1">Used on the year-end mileage report. Confirm with your tax pro.</p>
      </div>
      <Button type="button" className="h-11 bg-[#0A4D68]" disabled={save.isPending} onClick={() => save.mutate()} data-testid="save-permissions">
        {save.isPending ? "Saving…" : "Save permissions"}
      </Button>
    </div>
  );
}
