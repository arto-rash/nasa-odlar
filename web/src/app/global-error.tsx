"use client";

import { useEffect } from "react";
import { isStaleBuildError, reloadOnce } from "@/lib/stale-build";

/** Last-resort screen when the page shell itself fails (no translations or
 *  theme here). A page from an older build reloads itself straight away. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (isStaleBuildError(error)) reloadOnce();
  }, [error]);
  const az = typeof document !== "undefined" && /^\/az(\/|$)/.test(window.location.pathname);
  const s = az
    ? { title: "Səhifə yüklənmədi", lead: "Səhifəni yeniləyin və ya geri qayıdın.", reload: "Yenilə", back: "Geri" }
    : { title: "This page couldn’t load", lead: "Reload to try again, or go back.", reload: "Reload", back: "Back" };
  return (
    <html lang={az ? "az" : "en"}>
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#111213", color: "#ededeb", fontFamily: "system-ui, -apple-system, sans-serif", padding: 20 }}>
        <main style={{ maxWidth: 440 }}>
          <h1 style={{ fontSize: 28, fontWeight: 500, margin: 0 }}>{s.title}</h1>
          <p style={{ color: "#b3b3ae", marginTop: 10 }}>{s.lead}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 28 }}>
            <button onClick={() => window.location.reload()} style={{ background: "#ededeb", color: "#111213", border: 0, borderRadius: 6, padding: "10px 16px", fontSize: 14, cursor: "pointer" }}>
              {s.reload}
            </button>
            <button onClick={() => window.history.back()} style={{ background: "transparent", color: "#ededeb", border: "1px solid #383b3f", borderRadius: 6, padding: "10px 16px", fontSize: 14, cursor: "pointer" }}>
              {s.back}
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
