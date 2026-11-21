// Talks to the Django API on the same site. Django's session cookie keeps people
// signed in; every change sends the CSRF token Django gave us.

export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;
  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export class OfflineError extends Error {}

function cookie(name: string) {
  return document.cookie.split("; ").find((c) => c.startsWith(name + "="))?.split("=")[1] ?? "";
}

function messageFrom(data: unknown): [string, Record<string, string>] {
  if (!data || typeof data !== "object") return ["Something went wrong. Try again.", {}];
  const fields: Record<string, string> = {};
  let first = "";
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    const text = Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : "";
    if (!text) continue;
    fields[k] = text;
    if (!first) first = text;
  }
  return [first || "Something went wrong. Try again.", fields];
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const method = opts.method ?? (opts.body || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    if (!cookie("csrftoken")) await fetch("/api/auth/csrf/", { credentials: "same-origin" }).catch(() => undefined);
    headers["X-CSRFToken"] = decodeURIComponent(cookie("csrftoken"));
  }
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch("/api/" + path.replace(/^\/+|\/+$/g, "") + "/", { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new OfflineError("No connection. Check your network and try again.");
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 403 && data?.detail?.includes("CSRF")) throw new ApiError(403, "Your session expired. Reload the page.");
    let [msg, fields] = messageFrom(data);
    // Not a normal answer from the backend: show the code so the cause can be found.
    if (!data || typeof data !== "object") msg = `The app could not reach the server (error ${res.status}). Try again in a minute; if it keeps happening, tell the owner.`;
    throw new ApiError(res.status, res.status === 401 || res.status === 403 && !data ? "Please sign in again." : msg, fields);
  }
  return data as T;
}

export function toForm(values: Record<string, unknown>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === "") continue;
    // Photos need a file name with an extension or Django refuses them.
    if (v instanceof Blob) f.append(k, v, v instanceof File && v.name ? v.name : `${k}.jpg`);
    else f.append(k, String(v));
  }
  return f;
}
