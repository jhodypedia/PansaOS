import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "PansaOS · Agent OS untuk bounty hunter",
  description:
    "Kontrol agent, provider, dan bounty make.fun dalam satu pusat kendali.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
