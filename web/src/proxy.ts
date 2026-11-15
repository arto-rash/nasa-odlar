import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

/** English lives at the bare address, so next-intl rewrites "/explore" to the
 *  internal "/en/explore". Behind nginx the request says https (from
 *  X-Forwarded-Proto) while the app itself listens on plain http, so the
 *  rewrite to https://localhost failed with a TLS error and every English page
 *  returned 500. Point local rewrites back at http. */
export default function proxy(req: NextRequest) {
  const res = intl(req);
  const rw = res.headers.get("x-middleware-rewrite");
  if (rw && /^https:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(rw)) {
    res.headers.set("x-middleware-rewrite", rw.replace(/^https:/, "http:"));
  }
  return res;
}

export const config = {
  // Skip API routes, Next internals and files with an extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
