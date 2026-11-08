import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  reactStrictMode: true,
  // k3s等のコンテナ配備では standalone ビルドを使用する (BUILD_STANDALONE=true)
  ...(process.env.BUILD_STANDALONE === "true" ? { output: "standalone" as const } : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
            : []),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  async rewrites() {
    // 同一オリジン運用ではエッジ (Caddy) が /api/* をバックエンドへ振り分けるためrewrites不要
    if (process.env.NEXT_PUBLIC_SAME_ORIGIN === "true") return [];
    const legacySources = ["/channels", "/users/:path*", "/ranking/:path*", "/stats/:path*"];
    return [
      ...legacySources.map((source) => ({
        source,
        destination: `https://api.ymkw.top${source}`,
      })),
      // 同一オリジン形式の /api/* も移行期のWorkersで動くようにする (プレフィックスは剥がす)
      { source: "/api/:path*", destination: "https://api.ymkw.top/:path*" },
    ];
  },
};

export default nextConfig;
