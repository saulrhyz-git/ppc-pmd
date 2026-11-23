import type { Dashboard, SessionUser, Thresholds } from "@pmd/shared";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch("/api" + url, {
    method,
    credentials: "same-origin",
    headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText);
  return data as T;
}

export const api = {
  get: <T,>(u: string) => req<T>("GET", u),
  post: <T,>(u: string, b?: unknown) => req<T>("POST", u, b ?? {}),
  put: <T,>(u: string, b: unknown) => req<T>("PUT", u, b),
  del: <T,>(u: string) => req<T>("DELETE", u),
};

export type DashboardResponse = Dashboard & { thresholds: Thresholds };

export interface Meta {
  properties: { id: string; name: string; section: string | null; scoreRed: number; scoreAmber: number }[];
  sections: string[];
  asOf: string;
  thresholds: Thresholds;
  roles: string[];
  tabs: [string, string][];
}

export type AdminUser = SessionUser & { active: boolean; lastLoginAt: string | null };

export interface DataRow {
  id: string;
  property: string;
  data: Record<string, string>;
  updatedAt: string;
}
