import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "PansaOS · Asisten pribadi",
  description:
    "Asisten pribadi serbaguna dengan memori, kanal, dan alat terintegrasi.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#090a10" },
    { media: "(prefers-color-scheme: light)", color: "#f5f6fb" },
  ],
};
const themeScript = `(function(){try{var t=localStorage.getItem("pansa-theme");if(!t)t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}catch(e){}})();`;
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
