// home/ 静的ホームページの生成スクリプト。
// ダッシュボードアプリのルートHTMLをスナップショット化し、Next.jsの配信物に依存しない形に変換する。
// 使い方: 前提として home/index.html.raw にルートHTMLのスナップショットを保存してから実行。
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const homeDir = path.join(root, "home");
const rawPath = path.join(homeDir, "index.html.raw");

const DASHBOARD_BASE = "https://analytics.ymkw.top";
const SITE_URL = "https://ymkw.top";

let html = fs.readFileSync(rawPath, "utf8");

// Next.jsの配信物 (chunks) への参照をすべて除去
html = html.replaceAll(/<script\b[^>]*src="\/_next\/[^"]*"[^>]*><\/script>/g, "");
html = html.replaceAll(/<link rel="preload" as="script"[^>]*href="\/_next\/[^"]*"[^>]*\/>/g, "");
html = html.replaceAll(/<script>self\.__next_f[^<]*<\/script>/g, "");
html = html.replaceAll(/<script>\(self\.__next_f[^<]*<\/script>/g, "");

// スタイルシートはインライン化して静的配信物から_nextを排除する
html = html.replaceAll(
  /<link rel="stylesheet" href="\/_next\/static\/[^"]*" data-precedence="next"\/>/g,
  (match) => {
    const href = /href="([^"]*)"/.exec(match)?.[1];
    if (!href) return match;
    const cssPath = path.join(
      root,
      "frontend",
      ".next",
      "static",
      href.replace("/_next/static/", ""),
    );
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
    if (!css) throw new Error(`Stylesheet not found: ${href} (${cssPath})`);
    return `<style>${css}</style>`;
  },
);

// スナップショット時のホスト (127.0.0.1:4322) を本番URLへ置換
html = html.replaceAll("https://127.0.0.1:4322", SITE_URL);

// ダッシュボードへのリンクは analytics.ymkw.top へ
html = html.replaceAll(`href="/month/latest"`, `href="${DASHBOARD_BASE}/month/latest"`);
html = html.replaceAll(`href="/all"`, `href="${DASHBOARD_BASE}/all"`);

// 3Dシーンとローダー制御を静的ページ用に組み込む (Reactのhydrationなしで動く)
const bootstrap = `
<script type="importmap">
{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}
</script>
<script type="module" src="/home-scene/scene.js"></script>
<script>
(function () {
  var startedAt = performance.now();
  var complete = function () {
    var remaining = Math.max(0, 700 - (performance.now() - startedAt));
    window.setTimeout(function () {
      var loader = document.querySelector(".site-loader");
      if (!loader) return;
      loader.classList.add("is-closing");
      window.setTimeout(function () { loader.remove(); }, 900);
    }, remaining);
  };
  window.addEventListener("ymkw:scene-ready", complete, { once: true });
  window.setTimeout(complete, 8000);
})();
</script>
</body>`;
html = html.replaceAll("</body>", bootstrap);

fs.writeFileSync(path.join(homeDir, "index.html"), html);
fs.rmSync(rawPath);
console.log(`home/index.html generated (${html.length} bytes)`);
