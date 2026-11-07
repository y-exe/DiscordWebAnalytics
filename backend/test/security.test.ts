import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Pool } from "pg";

process.env.DB_DSN = "postgresql://user:password@127.0.0.1:5432/test";
process.env.API_SECRET = "a".repeat(32);
process.env.ADMIN_SESSION_SECRET = "b".repeat(32);
process.env.ADMIN_PASSWORD_HASH =
  "pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
process.env.ENABLE_API_DOCS = "false";

const config = await import("../src/config");
const { SafeDiskCache } = await import("../src/safeCache");
const adminAuth = await import("../src/adminAuth");
const db = await import("../src/db");
const { createApp, PUBLIC_PATHS } = await import("../src/api");

type AppDeps = Parameters<typeof createApp>[0];

interface TestApp {
  app: ReturnType<typeof createApp>;
  verifyCalls: () => number;
  cleanup: () => Promise<void>;
}

async function cleanupDirectory(directory: string, ...stores: { close(): void }[]): Promise<void> {
  for (const store of stores) {
    try {
      store.close();
    } catch {}
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function tempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ymkw-api-test-"));
}

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<TestApp> {
  const directory = tempDirectory();
  const cache = new SafeDiskCache(directory, 1024 * 1024);
  const cfg = await config.loadConfig();
  let verifyCalls = 0;

  const deps: AppDeps = {
    config: cfg,
    cache,
    getPool: () => ({}) as unknown as Pool,
    consumeLoginLimits: async (_pool, clientKey, perClient, total, window) =>
      cache.consumeLimit(`client:${clientKey}`, perClient, window) &&
      cache.consumeLimit("global", total, window),
    verifyAdminPassword: async () => {
      verifyCalls++;
      return false;
    },
    ...overrides,
  };

  return {
    app: createApp(deps),
    verifyCalls: () => verifyCalls,
    cleanup: () => cleanupDirectory(directory, cache),
  };
}

function loginRequest(body?: string): RequestInit {
  return {
    method: "POST",
    headers: { origin: "https://ymkw.top" },
    body: body ?? JSON.stringify({ password: "wrong" }),
  };
}

function fakeGuildRow(guildId: string) {
  return {
    guild_id: guildId,
    name: "テストサーバー",
    king_role_id: "1503873180362739834",
    excluded_channel_ids: ["1406033558757314752"],
    display_config: {
      whitelistChannelIds: [],
      privateChatCategoryIds: [],
      bottomChannelCategoryIds: [],
    },
    domains: ["ymkw.top"],
  };
}

/** ギルド解決用のクエリに応答するテスト用Poolラッパ */
function withGuildLookup(pool: Pool, options: { domains?: Record<string, string> } = {}): Pool {
  const stub = pool as unknown as {
    query: (sql: unknown, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  };
  const original = stub.query.bind(stub);
  stub.query = async (sql: unknown, values?: unknown[]) => {
    const text = typeof sql === "string" ? sql : String((sql as { text?: string })?.text ?? "");
    const params = (values ?? []) as unknown[];
    if (text.includes("FROM guilds ")) {
      return { rows: [fakeGuildRow(String(params[0] ?? ""))] };
    }
    if (text.includes("FROM guild_domains")) {
      const mapped = options.domains?.[String(params[0] ?? "")];
      return { rows: mapped ? [{ guild_id: mapped }] : [] };
    }
    return original(sql, values);
  };
  return pool;
}

test("GUILD_ID未設定でも対象サーバーのDiscordプレビューを返し、明示設定も利用できる", async () => {
  const original = process.env.GUILD_ID;
  try {
    delete process.env.GUILD_ID;
    const cfg = await config.loadConfig();
    assert.equal(cfg.guildId, "1355073968532619376");
    let queriedGuild: unknown;
    const pool = withGuildLookup({
      query: async (query: { values: unknown[] }) => {
        queriedGuild = query.values[2];
        return { rows: [{ user_id: "123", count: 100, display_name: "テスト" }] };
      },
    } as unknown as Pool);
    const { app, cleanup } = await buildTestApp({ config: cfg, getPool: () => pool });
    try {
      const response = await app.request("/ranking/monthly/2025/10/discord-embed");
      assert.equal(response.status, 200);
      assert.equal(queriedGuild, "1355073968532619376");
      assert.equal(((await response.json()) as { component: { type: number } }).component.type, 17);
    } finally {
      await cleanup();
    }
    process.env.GUILD_ID = "987654321";
    assert.equal((await config.loadConfig()).guildId, "987654321");
  } finally {
    if (original === undefined) delete process.env.GUILD_ID;
    else process.env.GUILD_ID = original;
  }
});

test("DiscordプレビューはBotと同じJST範囲・除外チャンネルで集計し、公開JSONをキャッシュする", async () => {
  const cfg = await config.loadConfig();
  cfg.guildId = "123456789";
  const rows = Array.from({ length: 10 }, (_, index) => ({
    user_id: String(100 + index),
    count: 100 - index,
    display_name: `利用者${index}`,
  }));
  let calls = 0;
  const pool = withGuildLookup({
    query: async (query: { text: string; values: unknown[] }) => {
      calls++;
      assert.match(query.text, /m\.guild_id = \$3 AND m\.channel_id <> ALL\(\$4::bigint\[\]\)/);
      assert.match(
        query.text,
        /LEFT JOIN guild_members gm ON gm\.guild_id = m\.guild_id AND gm\.user_id = m\.user_id/,
      );
      assert.match(query.text, /LIMIT 10/);
      assert.deepEqual(query.values, [
        new Date("2025-09-30T15:00:00Z"),
        new Date("2025-10-31T15:00:00Z"),
        cfg.guildId,
        ["1406033558757314752"],
      ]);
      return { rows };
    },
  } as unknown as Pool);
  const { app, cleanup } = await buildTestApp({ config: cfg, getPool: () => pool });
  try {
    for (let index = 0; index < 2; index++) {
      const response = await app.request("/ranking/monthly/2025/10/discord-embed");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "public, max-age=600");
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      const body = await response.text();
      assert.ok(Buffer.byteLength(body, "utf8") <= 3000);
      const payload = JSON.parse(body);
      assert.deepEqual(Object.keys(payload), ["component"]);
      assert.equal(payload.component.type, 17);
      assert.match(body, /2025年10月の発言ランキング/);
      assert.match(body, /利用者9/);
      assert.match(body, /1503873180362739834/);
    }
    assert.equal(calls, 1);
  } finally {
    await cleanup();
  }
});

test("未公開月のプレビューは認証済みAPI利用者にも公開せず、DBへアクセスしない", async () => {
  const cfg = await config.loadConfig();
  cfg.guildId = "123456789";
  const { app, cleanup } = await buildTestApp({
    config: cfg,
    getPool: () => {
      throw new Error("Must not query");
    },
  });
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  try {
    for (const headers of [{}, { "x-api-key": cfg.apiSecret }] as Record<string, string>[]) {
      const response = await app.request(
        `/ranking/monthly/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}/discord-embed`,
        { headers },
      );
      assert.equal(response.status, 403);
    }
    for (const path of [
      "/ranking/monthly/2025/13/discord-embed",
      "/ranking/monthly/abc/1/discord-embed",
    ]) {
      assert.equal((await app.request(path)).status, 422);
    }
  } finally {
    await cleanup();
  }
});

test("巨大なプレビューや空のランキングは情報を削って偽のランキングとして返さない", async () => {
  const cfg = await config.loadConfig();
  cfg.guildId = "123456789";
  for (const rows of [
    [],
    [{ user_id: "123", count: 1, display_name: "非常に長い名前".repeat(500) }],
  ]) {
    const pool = withGuildLookup({ query: async () => ({ rows }) } as unknown as Pool);
    const { app, cleanup } = await buildTestApp({ config: cfg, getPool: () => pool });
    try {
      const response = await app.request("/ranking/monthly/2025/10/discord-embed");
      assert.equal(response.status, rows.length ? 413 : 404);
      assert.equal(((await response.json()) as { component?: unknown }).component, undefined);
    } finally {
      await cleanup();
    }
  }
});

test("全期間のプレビューはBotと同じ全期間集計で取得し、月間データやロール案内を含まない", async () => {
  const cfg = await config.loadConfig();
  let calls = 0;
  const pool = withGuildLookup({
    query: async (query: { text: string; values: unknown[] }) => {
      calls++;
      assert.doesNotMatch(query.text, /created_at/);
      assert.match(query.text, /m\.guild_id = \$1 AND m\.channel_id <> ALL\(\$2::bigint\[\]\)/);
      assert.match(query.text, /LIMIT 10/);
      assert.deepEqual(query.values, [cfg.guildId, ["1406033558757314752"]]);
      return { rows: [{ user_id: "123", count: 99999, display_name: "全期間1位" }] };
    },
  } as unknown as Pool);
  const { app, cleanup } = await buildTestApp({ config: cfg, getPool: () => pool });
  try {
    for (let index = 0; index < 2; index++) {
      const response = await app.request("/ranking/total/discord-embed");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "public, max-age=1800");
      const payload = await response.text();
      assert.ok(Buffer.byteLength(payload, "utf8") <= 3000);
      assert.match(payload, /🏆 全期間の発言ランキング/);
      assert.match(payload, /99999回/);
      assert.doesNotMatch(payload, /ロールが付与|年.*月の発言ランキング/);
      assert.equal(JSON.parse(payload).component.type, 17);
    }
    assert.equal(calls, 1);
  } finally {
    await cleanup();
  }
});

test("全期間プレビューも空データとサイズ超過では通常プレビューへ戻す", async () => {
  for (const rows of [[], [{ user_id: "123", count: 1, display_name: "長い名前".repeat(1000) }]]) {
    const pool = withGuildLookup({ query: async () => ({ rows }) } as unknown as Pool);
    const { app, cleanup } = await buildTestApp({ getPool: () => pool });
    try {
      const response = await app.request("/ranking/total/discord-embed");
      assert.equal(response.status, rows.length ? 413 : 404);
      assert.equal(((await response.json()) as { component?: unknown }).component, undefined);
    } finally {
      await cleanup();
    }
  }
});

test("x-forwarded-hostでギルドを解決し、未登録ホストのデータAPIは404になる", async () => {
  const queriedGuilds: unknown[] = [];
  const pool = withGuildLookup(
    {
      query: async (...args: unknown[]) => {
        const first = args[0] as { values?: unknown[] } | string;
        const values =
          typeof first === "string" ? ((args[1] ?? []) as unknown[]) : (first.values ?? []);
        queriedGuilds.push(values[0]);
        return { rows: [] };
      },
    } as unknown as Pool,
    { domains: { "guild2.example": "999888777" } },
  );
  const { app, cleanup } = await buildTestApp({ getPool: () => pool });
  try {
    const unknownHost = await app.request("/ranking/total", {
      headers: { host: "unknown.example" },
    });
    assert.equal(unknownHost.status, 404);

    const forwarded = await app.request("/ranking/total", {
      headers: { "x-forwarded-host": "guild2.example" },
    });
    assert.equal(forwarded.status, 200);
    assert.ok(queriedGuilds.includes("999888777"));
  } finally {
    await cleanup();
  }
});

test("APIドキュメントはデフォルトで無効", async () => {
  const cfg = await config.loadConfig();
  assert.equal(cfg.enableApiDocs, false);
  const { app, cleanup } = await buildTestApp();
  try {
    assert.equal((await app.request("/docs")).status, 404);
    assert.equal((await app.request("/openapi.json")).status, 404);
  } finally {
    await cleanup();
  }
});

test("レートリミットは複数キャッシュインスタンス間でアトミック", async () => {
  const directory = tempDirectory();
  const stores = [
    new SafeDiskCache(directory, 1024 * 1024),
    new SafeDiskCache(directory, 1024 * 1024),
  ];
  const allowed: boolean[] = [];
  for (let index = 0; index < 40; index++) {
    allowed.push(stores[index % 2].consumeLimit("login", 5, 600));
  }
  assert.equal(allowed.filter(Boolean).length, 5);
  await cleanupDirectory(directory, ...stores);
});

test("キャッシュ追い出しはセキュリティカウンタを消さない", async () => {
  const directory = tempDirectory();
  const store = new SafeDiskCache(directory, 1024 * 1024);
  assert.equal(store.consumeLimit("login", 1, 600), true);
  store.set("large-cache-value", "x".repeat(2 * 1024 * 1024));
  assert.equal(store.consumeLimit("login", 1, 600), false);
  await cleanupDirectory(directory, store);
});

test("レート制限ウィンドウは期限切れでリセットされ、不正な上限は失敗扱い", async () => {
  const directory = tempDirectory();
  let fakeNow = 1000;
  const store = new SafeDiskCache(directory, 1024 * 1024, () => fakeNow);
  assert.equal(store.consumeLimit("login", 1, 600), true);
  assert.equal(store.consumeLimit("login", 1, 600), false);
  assert.equal(store.consumeLimit("invalid", 0, 600), false);
  fakeNow += 599_999;
  assert.equal(store.consumeLimit("login", 1, 600), false);
  fakeNow += 1;
  assert.equal(store.consumeLimit("login", 1, 600), true);
  await cleanupDirectory(directory, store);
});

test("累計キャッシュは指定した秒数だけ保持され、期限で失効する", async () => {
  const directory = tempDirectory();
  let fakeNow = 1_000_000;
  const store = new SafeDiskCache(directory, 1024 * 1024, () => fakeNow);
  try {
    const analysis = { total: 3217708 };
    store.set("analysis_total", analysis, 1800);
    fakeNow += 10_000;
    assert.deepEqual(store.get("analysis_total"), analysis);
    fakeNow += 1_789_999;
    assert.deepEqual(store.get("analysis_total"), analysis);
    fakeNow += 1;
    assert.equal(store.get("analysis_total"), undefined);
  } finally {
    await cleanupDirectory(directory, store);
  }
});

test("API制限は信頼プロキシ配下でも利用者ごとに分離し、未信頼のIPヘッダーは採用しない", async () => {
  const cfg = await config.loadConfig();
  cfg.maxRequests = 1;
  cfg.trustCloudflareProxy = true;
  cfg.cloudflareTrustedProxyCidrs = config.parseTrustedProxyCidrs("192.0.2.0/24");
  for (const peerIp of ["192.0.2.7", "203.0.113.7"]) {
    const { app, cleanup } = await buildTestApp({ config: cfg, getPeerIp: () => peerIp });
    try {
      const request = (ip: string) =>
        app.request("/health", { headers: { "CF-Connecting-IP": ip } });
      assert.equal((await request("198.51.100.1")).status, 200);
      assert.equal((await request("198.51.100.1")).status, 429);
      assert.equal((await request("198.51.100.2")).status, peerIp === "192.0.2.7" ? 200 : 429);
    } finally {
      await cleanup();
    }
  }
});

test("DSN書き換えは認証情報とクエリを保持する", async () => {
  const dsn =
    "postgresql://localhost-user:localhost-pass@localhost:5432/localhost-db?application_name=localhost";
  const local = await config.adjustDbDsn(dsn, { inContainer: false });
  assert.equal(local, dsn.replace("@localhost:", "@127.0.0.1:"));
  const container = await config.adjustDbDsn(dsn, {
    inContainer: true,
    canResolveHostDockerInternal: async () => true,
  });
  assert.equal(container, dsn.replace("@localhost:", "@host.docker.internal:"));
});

test("非ASCIIのAPIキーは例外なく拒否される", () => {
  assert.equal(adminAuth.isApiClient("\u00ff", "a".repeat(32)), false);
  assert.equal(adminAuth.isApiClient(undefined, "a".repeat(32)), false);
  assert.equal(adminAuth.isApiClient("a".repeat(32), "a".repeat(32)), true);
});

test("管理セッションの往復と改竄検出", () => {
  const secret = "b".repeat(32);
  const now = 1_800_000_000;
  const token = adminAuth.createAdminSession(secret, now);
  assert.equal(adminAuth.verifyAdminSession(token, secret, now), true);
  const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert.equal(adminAuth.verifyAdminSession(tampered, secret, now), false);
  assert.equal(adminAuth.verifyAdminSession(null, secret, now), false);
  assert.equal(adminAuth.verifyAdminSession(undefined, secret, now), false);
});

test("管理系Originは許可リストで検証される", async () => {
  const cfg = await config.loadConfig();
  assert.equal(adminAuth.adminOriginAllowed(undefined, cfg.allowedOrigins), false);
  assert.equal(adminAuth.adminOriginAllowed("https://attacker.example", cfg.allowedOrigins), false);
  assert.equal(adminAuth.adminOriginAllowed("https://ymkw.top", cfg.allowedOrigins), true);
});

test("CF-Connecting-IPは信頼済みプロキシからのみ採用される", () => {
  const trusted = config.parseTrustedProxyCidrs("192.0.2.0/24, 2001:db8::/32");
  const spoofed = ["198.51.100.7", "203.0.113.8"] as const;
  const proxied = ["192.0.2.7", "203.0.113.8"] as const;
  const malformed = ["192.0.2.7", "not-an-ip"] as const;
  assert.equal(config.getClientIp(spoofed[0], spoofed[1], true, trusted), spoofed[0]);
  assert.equal(config.getClientIp(proxied[0], proxied[1], true, trusted), proxied[1]);
  assert.equal(config.getClientIp(malformed[0], malformed[1], true, trusted), malformed[0]);
});

test("リモートDBはTLS必須・loopbackはTLSなしで接続する", () => {
  assert.deepEqual(
    db.resolveSslOptions("postgresql://user:password@postgres-db:5432/discord_logs"),
    {
      rejectUnauthorized: false,
    },
  );
  assert.equal(db.resolveSslOptions("postgresql://user:password@127.0.0.1:5433/test"), false);
});

test("6回目のログイン試行はパスワード検証前に拒否される", async () => {
  const { app, verifyCalls, cleanup } = await buildTestApp({
    getPeerIp: () => "203.0.113.10",
  });
  try {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await app.request("/admin/login", loginRequest());
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
    assert.equal(verifyCalls(), 5);
  } finally {
    await cleanup();
  }
});

test("IPを変えても全体上限に到達すれば拒否される", async () => {
  const previous = process.env.ADMIN_LOGIN_GLOBAL_LIMIT;
  process.env.ADMIN_LOGIN_GLOBAL_LIMIT = "3";
  try {
    let attempt = 0;
    const { app, verifyCalls, cleanup } = await buildTestApp({
      getPeerIp: () => `203.0.113.${++attempt}`,
    });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const response = await app.request("/admin/login", loginRequest());
        statuses.push(response.status);
      }
      assert.deepEqual(statuses, [401, 401, 401, 429]);
      assert.equal(verifyCalls(), 3);
    } finally {
      cleanup();
    }
  } finally {
    if (previous === undefined) delete process.env.ADMIN_LOGIN_GLOBAL_LIMIT;
    else process.env.ADMIN_LOGIN_GLOBAL_LIMIT = previous;
  }
});

test("過大なログインボディはパスワード検証前に拒否される", async () => {
  const { app, verifyCalls, cleanup } = await buildTestApp({
    getPeerIp: () => "203.0.113.10",
  });
  try {
    const response = await app.request("/admin/login", loginRequest("x".repeat(2049)));
    assert.equal(response.status, 413);
    assert.equal(verifyCalls(), 0);
  } finally {
    await cleanup();
  }
});

test("リミッタ障害時はログインを許可しない (fail-closed)", async () => {
  const { app, verifyCalls, cleanup } = await buildTestApp({
    getPeerIp: () => "203.0.113.10",
    consumeLoginLimits: async () => {
      throw new Error("database unavailable");
    },
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await app.request("/admin/login", loginRequest());
    assert.equal(response.status, 503);
    assert.equal(verifyCalls(), 0);
  } finally {
    console.error = originalError;
    await cleanup();
  }
});

test("パブリックパスと書き込みメソッドの保護", async () => {
  const { app, cleanup } = await buildTestApp();
  try {
    assert.equal((await app.request("/health")).status, 200);
    assert.equal((await app.request("/")).status, 200);
    const unauthenticated = await app.request("/ranking/total", { method: "POST" });
    assert.equal(unauthenticated.status, 401);
    assert.ok(PUBLIC_PATHS.has("/health"));
  } finally {
    await cleanup();
  }
});
