/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // instrumentation.js: warms the slow Resend / PostHog reads when the server starts.
  experimental: { instrumentationHook: true },
  // The admin portal (admin.casa-libre.com) must never appear in search results.
  // X-Robots-Tag covers every response — pages, API routes, the /api/media image
  // proxy — not just HTML that also carries the <meta name="robots"> tag (layout).
  // Deliberately NO robots.txt Disallow: Google can only honour noindex on pages it
  // is allowed to fetch; blocking crawling would leave already-indexed URLs listed.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' }],
      },
    ];
  },
};

module.exports = nextConfig;
