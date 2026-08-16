import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { Bell } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export default function NotificationBell({ className }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: notes = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get("/notifications")).data,
    refetchInterval: 45000,
  });
  const unread = notes.filter((n) => !n.read).length;

  useEffect(() => {
    if (!unread || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const latest = notes.find((n) => !n.read);
    if (latest && sessionStorage.getItem("notif-" + latest.id)) return;
    if (latest) {
      sessionStorage.setItem("notif-" + latest.id, "1");
      try { new Notification(latest.title, { body: latest.body }); } catch { /* ignore */ }
    }
  }, [unread, notes]);

  const readAll = useMutation({
    mutationFn: async () => api.post("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn("relative p-2 rounded-full hover:bg-slate-100 text-[#0A4D68]", className)} data-testid="notif-bell">
          <Bell size={18} />
          {unread ? <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[#C45C26]" /> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 bg-white max-h-80 overflow-y-auto">
        {notes.length === 0 ? <div className="p-3 text-sm text-[#4B6370]">No alerts yet.</div> : null}
        {notes.slice(0, 12).map((n) => (
          <DropdownMenuItem
            key={n.id}
            className={`flex flex-col items-start gap-0.5 ${n.read ? "" : "bg-[#FBF6E8]"}`}
            onClick={() => { if (n.job_id) navigate(`/jobs/${n.job_id}/sheet`); }}
          >
            <span className="font-medium text-sm">{n.title}</span>
            <span className="text-xs text-[#4B6370] whitespace-normal">{n.body}</span>
          </DropdownMenuItem>
        ))}
        {unread ? (
          <DropdownMenuItem onClick={() => readAll.mutate()}>Mark all read</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
