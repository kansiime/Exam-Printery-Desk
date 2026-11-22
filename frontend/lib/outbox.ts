// Offline outbox for school visits. A visit saved without network waits here
// (in the phone's IndexedDB, photo included) and is sent when the signal returns.
// Each visit carries a client_id made on the phone, so a retry never duplicates.
import { ApiError, OfflineError, api, toForm } from "./api";

type Pending = { client_id: string; values: Record<string, unknown>; photo: Blob; savedAt: string; error?: string };

const DB = "printery-outbox";
const STORE = "visits";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "client_id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const listPending = () => tx<Pending[]>("readonly", (s) => s.getAll() as IDBRequest<Pending[]>);
const put = (p: Pending) => tx("readwrite", (s) => s.put(p));
const remove = (id: string) => tx("readwrite", (s) => s.delete(id));

async function send(p: Pending): Promise<number | undefined> {
  const saved = await api<{ id?: number }>("visits", { form: toForm({ ...p.values, client_id: p.client_id, note_photo: p.photo }) });
  return saved?.id;
}

/** Try to send now; if there is no network, keep it for later. Returns "sent" or "queued". */
export async function submitVisit(values: Record<string, unknown>, photo: Blob): Promise<{ how: "sent" | "queued"; id?: number }> {
  const p: Pending = { client_id: crypto.randomUUID(), values, photo, savedAt: new Date().toISOString() };
  try {
    return { how: "sent", id: await send(p) };
  } catch (e) {
    if (e instanceof OfflineError) {
      await put(p);
      return { how: "queued" };
    }
    throw e;
  }
}

let running: Promise<{ sent: number; failed: number }> | null = null;

/** Send everything waiting. Visits the server refuses stay listed with the reason.
 *  Only one send runs at a time, even if the network comes back twice quickly. */
export function flush(): Promise<{ sent: number; failed: number }> {
  running ??= doFlush().finally(() => { running = null; });
  return running;
}

async function doFlush(): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  for (const p of await listPending()) {
    try {
      await send(p);
      await remove(p.client_id);
      sent++;
    } catch (e) {
      if (e instanceof OfflineError) break;
      failed++;
      await put({ ...p, error: e instanceof ApiError ? e.message : "Could not send" });
    }
  }
  return { sent, failed };
}

export const discard = remove;
