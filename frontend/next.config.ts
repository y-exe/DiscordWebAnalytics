import type { NextConfig } from "next";
import path from "node:path";

// モノレポルート (backend/src をフロントからimportするため)
const repoRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  // モノレポルート (backend/src をフロントからimportするため)。
  // turbopack.root と outputFileTracingRoot は必ず同一値にする必要がある。
  // (不一致だとturbopack.rootがcwdに強制され、backend/ がルート外で解決できなくなる)
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // スタンドアロン (k3s統合コンテナ) は backend/src を追跡対象に含めるためルートをmonorepoルートにする。
  // WorkersビルドはOpenNextがアプリ相対のレイアウトを前提とするためoutput設定のみ切替。
  ...(process.env.BUILD_STANDALONE === "true" ? { output: "standalone" as const } : {}),
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...(process.env.NODE_ENV === "production"
            ? [
                { key: "Strict-Transport-Security", value: "max-age=31536000" },
                {
                  // 開発環境はHMR/評価実行の要件が異なるため本番のみ適用する。
                  // Next.jsのハイドレーション用インラインスクリプトとスタイルに
                  // 'unsafe-inline' が必要。フォントはGoogle Fonts、画像はDiscord CDN。
                  key: "Content-Security-Policy",
                  value: [
                    "default-src 'self'",
                    "script-src 'self' 'unsafe-inline'",
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                    "font-src 'self' https://fonts.gstatic.com data:",
                    "img-src 'self' data: https://cdn.discordapp.com",
                    "connect-src 'self'",
                    "worker-src 'self' blob:",
                    "frame-ancestors 'none'",
                    "object-src 'none'",
                    "base-uri 'self'",
                    "form-action 'self'",
                  ].join("; "),
                },
              ]
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
    // 同一オリジン運用では /api/* はNextにマウントしたHonoルートが処理するためrewrites不要
    if (process.env.NEXT_PUBLIC_SAME_ORIGIN === "true") return [];
    const legacySources = [
      "/channels",
      "/channels/:path*",
      "/users/:path*",
      "/ranking/:path*",
      "/stats/:path*",
      "/graph/:path*",
    ];
    // fallback (全ルート解決後) で適用する。afterFiles (配列形式) だと動的ルートより先に
    // マッチし、/channels/[channelId] 等のページがAPI転送に奪われてしまうため
    return {
      beforeFiles: [],
      // /api/* は動的ルート (/api/[[...route]]) より先に本番へ転送する必要があるため afterFiles
      afterFiles: [
        // 同一オリジン形式の /api/* も移行期のWorkersで動くようにする (プレフィックスは剥がす)
        {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "https://api.ymkw.top"}/:path*`,
      },
      ],
      fallback: legacySources.map((source) => ({
        source,
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "https://api.ymkw.top"}${source}`,
      })),
    };
  },
};

export default nextConfig;
