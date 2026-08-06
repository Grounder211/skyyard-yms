import { get, set, del, keys } from "idb-keyval";

export async function queueWalkin(data: any) {
  const id = `walkin-${Date.now()}`;
  await set(id, { ...data, queued_at: new Date().toISOString(), status: "pending" });
  return id;
}

export async function syncPendingWalkins() {
  const allKeys = await keys();
  const walkinKeys = (allKeys as string[]).filter(k => String(k).startsWith("walkin-"));
  let syncedCount = 0;

  for (const key of walkinKeys) {
    const data = await get(key);
    try {
      const res = await fetch("/api/walkin/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        await del(key);
        syncedCount++;
      }
    } catch (e) {
      console.error("Sync failed for", key, e);
      break; // Stop on first network error
    }
  }
  return syncedCount;
}
