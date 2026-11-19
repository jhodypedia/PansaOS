/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  experimental: { cpus: 1 },
  async rewrites() {
    const core = process.env.CORE_URL ?? "http://localhost:3001";
    return [
      { source: "/api/:path*", destination: `${core}/api/:path*` },
      { source: "/ws", destination: `${core}/ws` },
    ];
  },
};
export default config;
