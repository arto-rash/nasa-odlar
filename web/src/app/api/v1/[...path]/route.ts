import type { NextRequest } from "next/server";
import { upstream } from "@/lib/upstream";

// Same-origin proxy for browser calls: no CORS, backend URL stays server-side.
const PASS_REQUEST = ["authorization", "content-type", "accept"];
const PASS_RESPONSE = ["content-type", "content-disposition", "cache-control", "etag"];

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const headers = new Headers();
  for (const h of PASS_REQUEST) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const hasBody = !["GET", "HEAD"].includes(req.method);
  let res: Response;
  try {
    res = await upstream(`/${path.join("/")}`, {
      method: req.method,
      headers,
      search: req.nextUrl.search,
      body: hasBody ? await req.text() : undefined,
      cache: "no-store",
    });
  } catch {
    return Response.json({ message: "ODLAR API is unreachable" }, { status: 503 });
  }
  const out = new Headers();
  for (const h of PASS_RESPONSE) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export { forward as GET, forward as POST, forward as PATCH, forward as PUT, forward as DELETE };
