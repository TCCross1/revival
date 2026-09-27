import { useEffect, useRef, useState } from "react";
import api, { BACKEND_URL } from "@/lib/api";

export function createSyncOrigin() {
  try {
    const existing = sessionStorage.getItem("revival-plan-origin");
    if (existing) return existing;
    const next = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem("revival-plan-origin", next);
    return next;
  } catch {
    return `web-${Date.now().toString(36)}`;
  }
}

function wsUrl(planId, ticket) {
  const base = String(BACKEND_URL || "http://127.0.0.1:8001").replace(/^http/, "ws");
  return `${base}/api/ws/floor-plans/${planId}?ticket=${encodeURIComponent(ticket)}`;
}

export function shouldApplyRemote(localRevision, remoteRevision, localDirty) {
  const local = Number(localRevision || 0);
  const remote = Number(remoteRevision || 0);
  if (remote <= local) return false;
  if (localDirty) return false;
  return true;
}

export function usePlanSync({
  planId,
  origin,
  enabled = true,
  getRevision,
  isDirty,
  onRemote,
}) {
  const [status, setStatus] = useState("idle");
  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const onRemoteRef = useRef(onRemote);
  const getRevisionRef = useRef(getRevision);
  const isDirtyRef = useRef(isDirty);
  onRemoteRef.current = onRemote;
  getRevisionRef.current = getRevision;
  isDirtyRef.current = isDirty;

  useEffect(() => {
    if (origin) {
      api.defaults.headers.common["X-Revival-Sync-Origin"] = origin;
    }
    return () => {
      delete api.defaults.headers.common["X-Revival-Sync-Origin"];
    };
  }, [origin]);

  useEffect(() => {
    if (!enabled || !planId) {
      setStatus("idle");
      return undefined;
    }
    let cancelled = false;
    let socket;

    const applyMessage = (msg) => {
      if (!msg || (msg.type !== "plan" && msg.type !== "hello")) return;
      if (msg.origin && origin && msg.origin === origin) return;
      const remoteRev = Number(msg.revision || 0);
      const localRev = Number(getRevisionRef.current?.() || 0);
      if (!shouldApplyRemote(localRev, remoteRev, Boolean(isDirtyRef.current?.()))) return;
      onRemoteRef.current?.(msg);
    };

    const poll = async () => {
      try {
        const since = Number(getRevisionRef.current?.() || 0);
        const res = await api.get(`/floor-plans/${planId}/sync`, { params: { since } });
        if (cancelled) return;
        if (res.data?.changed) applyMessage({ ...res.data, type: "plan" });
        if (!socket || socket.readyState !== WebSocket.OPEN) setStatus("polling");
      } catch (err) {
        console.error("Plan sync poll failed", err);
        if (!cancelled) setStatus("offline");
      }
    };

    const connect = async () => {
      try {
        const issued = await api.post(`/floor-plans/${planId}/sync-ticket`);
        if (cancelled) return;
        const ticket = issued.data?.ticket;
        if (!ticket) {
          setStatus("polling");
          return;
        }
        socket = new WebSocket(wsUrl(planId, ticket));
        socketRef.current = socket;
        socket.onopen = () => {
          if (!cancelled) setStatus("live");
        };
        socket.onmessage = (event) => {
          try {
            applyMessage(JSON.parse(event.data));
          } catch (err) {
            console.error("Plan sync message could not be read", err);
          }
        };
        socket.onerror = () => {
          if (!cancelled) setStatus("polling");
        };
        socket.onclose = () => {
          if (!cancelled) setStatus("polling");
        };
      } catch (err) {
        console.error("Plan sync websocket unavailable, polling instead", err);
        if (!cancelled) setStatus("polling");
      }
    };

    connect();
    timerRef.current = setInterval(poll, 4000);
    poll();

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      try {
        socket?.close();
      } catch {
        /* already closed */
      }
      socketRef.current = null;
    };
  }, [enabled, planId, origin]);

  return status;
}
