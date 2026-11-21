/** In development, Next.js forwards API, admin and media requests to Django so the
 *  browser sees one site and the login cookie works. In production nginx does this. */
// On Render the backend is reached over Render's private network (BACKEND_HOSTPORT = "name:port").
const backend = process.env.BACKEND_URL
  || (process.env.BACKEND_HOSTPORT ? `http://${process.env.BACKEND_HOSTPORT}` : "http://localhost:8000");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/:path*/", destination: `${backend}/api/:path*/` },
      { source: "/media/:path*", destination: `${backend}/media/:path*` },
      { source: "/admin/:path*", destination: `${backend}/admin/:path*` },
      { source: "/static/:path*", destination: `${backend}/static/:path*` },
    ];
  },
  skipTrailingSlashRedirect: true,
  // A sleeping free Render backend can take ~a minute to wake; wait instead of failing.
  experimental: { proxyTimeout: 120_000 },
};

export default nextConfig;
