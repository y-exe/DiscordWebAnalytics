import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Pool } from "pg";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_LOGIN_LIMIT,
  ADMIN_LOGIN_WINDOW,
  isApiClient,
  verifyAdminSession,
} from "./adminAuth";
import { getClientIp } from "./config";
import {
  PUBLIC_PATHS,
  WRITE_METHODS,
  isDbHeavyPath,
  jsonError,
  jsonResponse,
  plainTextResponse,
} from "./http";
import { normalizeHost, resolveGuildByHost, type GuildContext } from "./guilds";
import { TOTAL_CACHE_WARM_INTERVAL_MS } from "./http";
import { createRouteHelpers } from "./routes/context";
import { register as registerAdmin } from "./routes/admin";
import { register as registerChannels } from "./routes/channels";
import { register as registerGraph } from "./routes/graph";
import { register as registerMeta } from "./routes/meta";
import { register as registerRanking } from "./routes/ranking";
import { register as registerStats } from "./routes/stats";
import { register as registerUsers } from "./routes/users";
import type { AppDeps, AppEnv } from "./types";

export type { AppDeps, AppEnv };
export { PUBLIC_PATHS, TOTAL_CACHE_WARM_INTERVAL_MS } from "./http";
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const cfg = deps.config;
  const cache = deps.cache;
  const getPeerIp =
    deps.getPeerIp ??
    ((c: Context) => (c.env as { peerIp?: string } | undefined)?.peerIp ?? "unknown");
  const h = createRouteHelpers(deps);

  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: cfg.allowedOrigins,
      credentials: true,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Accept", "Content-Type"],
      exposeHeaders: ["X-Debug-Block"],
    }),
  );

  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }

    const isBot = isApiClient(c.req.header("x-api-key"), cfg.apiSecret);
    const path = c.req.path;
    const isPublicPath = PUBLIC_PATHS.has(path);

    if (
      WRITE_METHODS.has(c.req.method) &&
      !isBot &&
      !isPublicPath &&
      path !== "/admin/login" &&
      path !== "/admin/logout"
    ) {
      return jsonResponse({ detail: "API key required." }, 401, {
        "X-Debug-Block": "write-api-key-required",
      });
    }

    const clientIp = getClientIp(
      getPeerIp(c),
      c.req.header("CF-Connecting-IP"),
      cfg.trustCloudflareProxy,
      cfg.cloudflareTrustedProxyCidrs,
      Boolean(c.env?.trustedPeer),
    );

    const blockKey = `blocked:${clientIp}`;
    if (cache.get(blockKey)) {
      return jsonResponse({ detail: "Too Many Requests. Blocked for 10 minutes." }, 429, {
        "X-Debug-Block": "rate-limit-active",
      });
    }

    const requestLimit = isBot ? cfg.botMaxRequests : cfg.maxRequests;
    if (!cache.consumeLimit(`request:${clientIp}`, requestLimit, cfg.rateLimitWindow)) {
      cache.set(blockKey, true, cfg.blockDuration);
      return jsonResponse({ detail: "Too Many Requests. Blocked for 10 minutes." }, 429, {
        "X-Debug-Block": "rate-limit-exceeded",
      });
    }

    if (!isPublicPath && isDbHeavyPath(path)) {
      const dbLimit = isBot ? cfg.dbBotMaxRequests : cfg.dbMaxRequests;
      if (!cache.consumeLimit(`db:${clientIp}`, dbLimit, cfg.dbRateLimitWindow)) {
        cache.set(blockKey, true, cfg.blockDuration);
        return jsonResponse({ detail: "Too Many Requests. Blocked for 10 minutes." }, 429, {
          "X-Debug-Block": "db-rate-limit-exceeded",
        });
      }
    }

    try {
      await next();
      c.res.headers.set("X-Content-Type-Options", "nosniff");
      c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      c.res.headers.set("X-Frame-Options", "DENY");
      return;
    } catch (error) {
      console.error(`Unhandled exception during request: ${c.req.method} ${path}`, error);
      return jsonResponse(
        {
          detail: "Internal Server Error",
          error_type: error instanceof Error ? error.constructor.name : typeof error,
        },
        500,
        { "X-Debug-Block": "internal-error" },
      );
    }
  });

  app.notFound((c) => {
    return jsonResponse({ detail: "Not Found" }, 404);
  });

  app.onError((error, c) => {
    console.error(`Unhandled error: ${c.req.method} ${c.req.path}`, error);
    return jsonResponse({ detail: "Internal Server Error" }, 500);
  });

  app.get("/", (c) => plainTextResponse("API is running."));

  app.get("/health", (c) => plainTextResponse("ok"));

  if (cfg.enableApiDocs) {
    app.get("/docs", (c) =>
      plainTextResponse("API docs are enabled. See /openapi.json.", {
        "Content-Type": "text/html; charset=utf-8",
      }),
    );
    app.get("/redoc", (c) => plainTextResponse("API docs are enabled. See /openapi.json."));
    app.get("/openapi.json", (c) =>
      jsonResponse({
        openapi: "3.1.0",
        info: { title: "Discord Analytics API", version: "1.0.0" },
        paths: {},
      }),
    );
  }

  registerMeta(app, h);
  registerAdmin(app, h);
  registerChannels(app, h);
  registerUsers(app, h);
  registerRanking(app, h);
  registerStats(app, h);
  registerGraph(app, h);

  return app;
}

export function startWarmLoop(app: Hono<AppEnv>): () => void {
  const targets = [
    { name: "ranking_total", path: "/ranking/total" },
    { name: "history_total", path: "/stats/history/total" },
    { name: "heatmap_total", path: "/stats/heatmap/total" },
    { name: "channels_total", path: "/stats/channels_distribution/total" },
    { name: "analysis_total", path: "/stats/analysis/total" },
  ];

  let interval: NodeJS.Timeout | null = null;
  let stopped = false;

  const warmOnce = async (): Promise<void> => {
    for (const target of targets) {
      const started = performance.now();
      try {
        const response = await app.request(target.path);
        const elapsedMs = Math.round(performance.now() - started);
        if (response.ok) {
          console.log(
            `${new Date().toISOString()} [INFO] ymkw-api: Warmed cache: ${target.name} (${elapsedMs}ms)`,
          );
        } else {
          console.warn(
            `${new Date().toISOString()} [WARN] ymkw-api: Failed to warm cache: ${target.name} status=${response.status}`,
          );
        }
      } catch (error) {
        console.warn(
          `${new Date().toISOString()} [WARN] ymkw-api: Failed to warm cache: ${target.name}`,
          error,
        );
      }
    }
  };

  const schedule = setTimeout(() => {
    if (stopped) return;
    void warmOnce();
    interval = setInterval(() => {
      if (!stopped) void warmOnce();
    }, TOTAL_CACHE_WARM_INTERVAL_MS);
  }, 10_000);

  return () => {
    stopped = true;
    clearTimeout(schedule);
    if (interval) clearInterval(interval);
  };
}

