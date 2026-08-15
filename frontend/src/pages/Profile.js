import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserCog, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

function fmtErr(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || "").filter(Boolean).join(" ");
  return "Could not update your profile.";
}

export default function Profile() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ name: user?.name || "", email: user?.email || "", current_password: "", new_password: "", confirm: "" });
  const [submitting, setSubmitting] = useState(false);
  const set = (k, v) => setForm({ ...form, [k]: v });

  const submit = async (e) => {
    e.preventDefault();
    if (form.new_password && form.new_password !== form.confirm) return toast.error("New passwords do not match");
    if (form.new_password && form.new_password.length < 6) return toast.error("New password must be at least 6 characters");
    setSubmitting(true);
    try {
      const payload = { name: form.name, email: form.email };
      if (form.new_password) { payload.new_password = form.new_password; payload.current_password = form.current_password; }
      const { data } = await api.post("/auth/update-profile", payload);
      if (data.session_token) localStorage.setItem("session_token", data.session_token);
      setUser(data);
      setForm({ name: data.name, email: data.email, current_password: "", new_password: "", confirm: "" });
      toast.success("Profile updated");
    } catch (err) {
      toast.error(fmtErr(err.response?.data?.detail));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="profile-page">
      <div>
        <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">My Profile</h1>
        <p className="text-[#4B6370] mt-1">Update your name, login email, and password.</p>
      </div>

      <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 bg-[#0A4D68]">
          <UserCog size={18} className="text-[#C9A227]" />
          <h2 className="text-white font-['Outfit'] font-semibold">Account</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <Label className="text-xs text-[#4B6370]">Name</Label>
            <Input className="mt-1" data-testid="profile-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-[#4B6370]">Login email</Label>
            <Input className="mt-1" type="email" data-testid="profile-email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>

          <div className="pt-2 border-t border-slate-100">
            <div className="text-sm font-medium text-[#061A23] mt-3 mb-1">Change password <span className="text-[#4B6370] font-normal">(optional)</span></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs text-[#4B6370]">Current password</Label>
                <Input className="mt-1" type="password" data-testid="profile-current" value={form.current_password} onChange={(e) => set("current_password", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-[#4B6370]">New password</Label>
                <Input className="mt-1" type="password" data-testid="profile-new" value={form.new_password} onChange={(e) => set("new_password", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-[#4B6370]">Confirm</Label>
                <Input className="mt-1" type="password" data-testid="profile-confirm" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} />
              </div>
            </div>
          </div>

          <div className="pt-2">
            <Button type="submit" data-testid="save-profile-btn" disabled={submitting} className="gap-1.5 bg-[#0A4D68] hover:bg-[#083D53]">
              {submitting ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              {submitting ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
