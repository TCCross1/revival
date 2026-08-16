const KEY = "revival-field-queue";

function readQueue() {
  try {
    const raw = localStorage.getItem(KEY);
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeQueue(rows) {
  localStorage.setItem(KEY, JSON.stringify(rows));
}

export function queueLength() {
  return readQueue().length;
}

export function enqueueOffline(item) {
  const rows = readQueue();
  rows.push({ ...item, queued_at: new Date().toISOString() });
  writeQueue(rows);
  return rows.length;
}

export async function flushOfflineQueue(api) {
  const rows = readQueue();
  if (!rows.length) return 0;
  const kept = [];
  let sent = 0;
  for (const row of rows) {
    try {
      if (row.type === "note" && row.job_id && row.text) {
        await api.post(`/jobs/${row.job_id}/logs`, { text: row.text });
        sent += 1;
      } else if (row.type === "clock-in") {
        await api.post("/field/time/clock-in", {
          job_id: row.job_id,
          lat: row.lat,
          lng: row.lng,
          notes: row.notes || "",
          source: "offline",
        });
        sent += 1;
      } else if (row.type === "clock-out") {
        await api.post("/field/time/clock-out", {
          lat: row.lat,
          lng: row.lng,
          notes: row.notes || "",
        });
        sent += 1;
      } else {
        kept.push(row);
      }
    } catch {
      kept.push(row);
    }
  }
  writeQueue(kept);
  return sent;
}
