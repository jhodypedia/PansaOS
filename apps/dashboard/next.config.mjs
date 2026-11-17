/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  poweredByHeader: false,
  experimental: { cpus: 1 },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.CORE_URL ?? "http://localhost:3001"}/api/:path*`,
      },
    ];
  },
};
export default config;
