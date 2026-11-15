import type { MetadataRoute } from "next";

/** Installed on a phone's home screen: the ODLAR icon on its dark tile. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ODLAR — fire record and risk",
    short_name: "ODLAR",
    description: "One consistent 25-year fire record from NASA's MODIS and VIIRS, fire calendars and risk forecasts.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0807",
    theme_color: "#111213",
    icons: [
      { src: "/brand/odlar-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/odlar-icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/odlar-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
