import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// English lives at the bare address, so this rewrites "/explore" to the
// internal "/en/explore". Next keeps that rewrite internal only when its origin
// matches the server's own, and it spells loopback as "localhost" in the
// rewrite: so the standalone server must run with HOSTNAME=localhost, not
// 127.0.0.1, or every English page is proxied to itself and fails.
export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals and files with an extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
