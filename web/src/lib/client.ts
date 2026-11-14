"use client";

import { useAuth } from "./store";

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

/** Browser-side call to the same-origin proxy (/api/v1/…). */
export async function http<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const token = useAuth.getState().token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api/v1${path}`, { ...init, headers, body });
  if (res.status === 401 && token) useAuth.getState().clear();
  if (!res.ok) {
    let data: unknown;
    let message = res.statusText;
    try {
      data = await res.json();
      const d = data as { message?: string; detail?: string };
      message = d.message ?? d.detail ?? message;
    } catch {}
    throw new HttpError(res.status, message, data);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
