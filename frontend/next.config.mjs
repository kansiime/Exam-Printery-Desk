/** In development, Next.js forwards API, admin and media requests to Django so the
 *  browser sees one site and the login cookie works. In production nginx does this. */
// On Render the backend is reached over Render's private network (BACKEND_HOSTPORT = "name:port").
function backendAddress() {
  let url = process.env.BACKEND_URL?.trim();
  if (!url && process.env.BACKEND_HOSTPORT) url = `http://${process.env.BACKEND_HOSTPORT}`;
  if (!url) {
    if (process.env.RENDER) {
      throw new Error("BACKEND_URL is not set. In Render, add BACKEND_URL = https://<your-backend>.onrender.com to this service, then deploy again.");
    }
    url = "http://localhost:8000";
  }
  if (!/^https?:\/\//.test(url)) url = `https://${url}`; // "printery-app.onrender.com" -> "https://printery-app.onrender.com"
  return url.replace(/\/+$/, "");
}
const backend = backendAddress();
console.log(`Exam Printery Desk: API requests go to ${backend}`);

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
