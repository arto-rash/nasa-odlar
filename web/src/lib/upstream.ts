import "server-only";

/**
 * Where the ODLAR API lives.
 *
 * Production: ODLAR_API_URL → Laravel gateway (…/api/v1), which owns auth,
 * subscriptions and alerts and proxies analytics to FastAPI.
 * Local / preview without Laravel: ODLAR_ML_URL → FastAPI directly, with the
 * gateway's paths translated to the analytics service's paths.
 */
const API_URL = process.env.ODLAR_API_URL?.replace(/\/$/, "");
const ML_URL = (process.env.ODLAR_ML_URL ?? "http://127.0.0.1:8001").replace(/\/$/, "");
const ML_TOKEN = process.env.ODLAR_INTERNAL_TOKEN;

export const gatewayMode = Boolean(API_URL);

export function mlPath(path: string): string | null {
  const p = path.replace(/^\/+/, "/");
  const m = p.match(/^\/regions\/([^/]+)\/(series\/weekly|series\/annual|calendar|risk)$/);
  if (m) {
    const [, slug, kind] = m;
    if (kind === "calendar") return `/calendar/${slug}`;
    if (kind === "risk") return `/risk/${slug}`;
    return `/series/${slug}/${kind.split("/")[1]}`;
  }
  if (/^\/(auth|subscriptions|alerts)(\/|$)/.test(p)) return null; // gateway-only resources
  if (p === "/status") return "/health";
  return p;
}

export function upstreamUrl(path: string, search = ""): string | null {
  if (API_URL) return `${API_URL}${path}${search}`;
  const mapped = mlPath(path);
  return mapped ? `${ML_URL}${mapped}${search}` : null;
}

export async function upstream(path: string, init: RequestInit & { search?: string } = {}): Promise<Response> {
  const url = upstreamUrl(path, init.search ?? "");
  if (!url) {
    return Response.json({ message: "This feature needs the ODLAR gateway (ODLAR_API_URL)." }, { status: 501 });
  }
  const headers = new Headers(init.headers);
  headers.set("Accept", headers.get("Accept") ?? "application/json");
  if (!API_URL && ML_TOKEN) headers.set("X-Internal-Token", ML_TOKEN);
  return fetch(url, { ...init, headers });
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Server-side JSON fetch, cached for 10 minutes like the pages that use it (the
 * data changes once a day). Answers over 2 MB are not cached by Next and are
 * simply fetched again; the page itself is still cached.
 */
export async function api<T>(path: string, opts: { search?: string } = {}): Promise<T> {
  const res = await upstream(path, {
    search: opts.search,
    next: { revalidate: 600 },
  } as RequestInit & { search?: string });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {}
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}
