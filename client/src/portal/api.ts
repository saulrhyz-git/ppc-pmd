// Portal API client. Separate from the staff client: different base path and the anti-forgery header.
export class PortalError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Called when the server says the session is gone, so the app can show the sign-in screen. */
let onSignedOut: () => void = () => undefined;
export const setSignedOutHandler = (f: () => void) => { onSignedOut = f; };

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const headers: Record<string, string> = { "X-PPC-Portal": "1" };
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch("/api/portal" + url, {
    method, credentials: "same-origin", cache: "no-store", headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data: { error?: string } | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (res.status === 401 && !url.startsWith("/auth/")) onSignedOut();
  if (!res.ok) throw new PortalError(res.status, data?.error || "Something went wrong. Please try again.");
  return data as T;
}

export const papi = {
  get: <T,>(u: string) => req<T>("GET", u),
  post: <T,>(u: string, b: unknown = {}) => req<T>("POST", u, b),
  patch: <T,>(u: string, b: unknown) => req<T>("PATCH", u, b),
};

export const fileUrl = (id: string) => `/api/portal/attachments/${encodeURIComponent(id)}`;
