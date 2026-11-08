import type { NextConfig } from "next";
import path from "node:path";

// モノレポルート (backend/src をフロントからimportするため)
const repoRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  turbopack: { root: repoRoot },
  // スタンドアロン (k3s統合コンテナ) は backend/src を追跡対象に含めるためルートをmonorepoルートにする。
  // WorkersビルドはOpenNextがアプリ相対のレイアウトを前提とするためアプリ配下に固定する。
  ...(process.env.BUILD_STANDALONE === "true"
    ? { output: "standalone" as const, outputFileTracingRoot: repoRoot }
    : { outputFileTracingRoot: process.cwd() }),
  reactStrictMode: true,
  // Workersビルド (webpack) ではBun専用モジュールをスタブへ外部化する。
  // Nextのサーバーexternalsがエイリアスより先に解決するため、externalsを差し替える。
  // 該当ルート (/api) はWorkers上では実行されない (rewritesで転送される) ため、
  // ダミーへ向けても動作に影響はない。
  webpack(config) {
    const stub = `commonjs ${path.resolve(process.cwd(), "stubs/bun-sqlite.cjs")}`;
    const prevExternals = config.externals;
    const bunInterceptor = (
      context: unknown,
      request: string,
      callback: (error?: Error | null, result?: string) => void,
    ) => {
      if (typeof request === "string" && request.startsWith("bun:")) {
        callback(null, stub);
        return;
      }
      if (typeof prevExternals === "function") {
        prevExternals(context, request, callback);
        return;
      }
      callback();
    };
    config.externals = Array.isArray(prevExternals)
      ? [bunInterceptor, ...prevExternals]
      : [bunInterceptor, ...(prevExternals ? [prevExternals] : [])];
    return config;
  },
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
    // 同一オリジン運用では /api/* はNextにマウントしたHonoルートが処理するためrewrites不要
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
