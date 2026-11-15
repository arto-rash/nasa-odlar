import Link from "next/link";

export default function RootNotFound() {
  return (
    <html lang="en">
      <body style={{ background: "#0b0907", color: "#f5eee6", fontFamily: "system-ui", display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <Link href="/" style={{ color: "#ff7f2a" }}>ODLAR →</Link>
      </body>
    </html>
  );
}
