export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "502";
  const message = url.searchParams.get("msg") || "Bad Gateway";
  const endpoint = url.searchParams.get("url") || "";
  const isNetworkIssue = code === "unknown" || code === "0";
  const safeCode = escapeHtml(code);
  const safeMessage = escapeHtml(message);
  const safeEndpoint = escapeHtml(endpoint);

  // cloudflare-error-page は EJS を実行時にコンパイルするため、eval を許可しない
  // Cloudflare Workers では 500 になる。見た目・情報設計は同パッケージに合わせ、
  // Workers で実行できる静的なテンプレートとしてここで返す。
  const errorLocation = isNetworkIssue ? escapeHtml(url.host || "Gateway") : "Backend Server";
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${safeCode}: ${safeMessage}</title><style>*,*:before,*:after{box-sizing:border-box}body{margin:0;color:#404040;background:#fff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:960px;margin:auto;padding:40px 32px}.title{font-size:48px;font-weight:300;line-height:1.25;margin:0 0 30px}.code{display:inline-block;vertical-align:middle;padding:4px 9px;border-radius:20px;background:#d9d9d9;color:#313131;font-size:12px;font-weight:600}.statuses{display:flex;margin:0 -32px 36px;padding:0 32px;background:linear-gradient(#dedede,#ebebeb 3%,#ebebeb 97%,#dedede)}.status{width:33.333%;padding:54px 12px;text-align:center}.icon{width:48px;height:48px;line-height:42px;margin:0 auto 16px;border:4px solid #9bca3e;border-radius:50%;color:#9bca3e;font-size:31px;font-weight:bold}.status.error .icon{border-color:#bd2426;color:#bd2426}.location{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.name{margin:8px 0 0;color:#777;font-size:23px;font-weight:300}.result{font-size:23px}.ok{color:#9bca3e}.bad{color:#bd2426}.columns{display:flex;gap:48px;line-height:1.65}.columns>section{flex:1}h2{font-size:28px;font-weight:400;margin:0 0 14px}.debug{padding:14px;border:1px solid #ddd;border-radius:6px;background:#fafafa;font:13px ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.button{display:inline-block;margin-top:12px;padding:12px 24px;border-radius:4px;background:#0051c3;color:#fff;text-decoration:none;font-weight:700}.footer{margin-top:36px;padding-top:28px;border-top:1px solid #ddd;text-align:center;color:#666;font-size:13px}@media(max-width:720px){.wrap{padding:30px 24px}.title{font-size:34px}.statuses{margin:0 -24px 28px;padding:0 24px;display:block}.status{width:100%;padding:22px 0;text-align:left;border-bottom:1px solid #ddd}.icon{float:right;margin:0}.name,.result{display:inline;font-size:20px}.name:after{content:" · "}.columns{display:block}.columns>section+section{margin-top:30px}}</style></head><body><main class="wrap"><h1 class="title">${safeMessage} <span class="code">Error code ${safeCode}</span></h1><div class="statuses"><div class="status"><div class="icon">✓</div><span class="location">You</span><div class="name">Browser</div><span class="result ok">Working</span></div><div class="status ${isNetworkIssue ? "error" : ""}"><div class="icon">${isNetworkIssue ? "×" : "✓"}</div><span class="location">${escapeHtml(url.host || "Gateway")}</span><div class="name">Network</div><span class="result ${isNetworkIssue ? "bad" : "ok"}">${isNetworkIssue ? "Error" : "Working"}</span></div><div class="status ${isNetworkIssue ? "" : "error"}"><div class="icon">${isNetworkIssue ? "✓" : "×"}</div><span class="location">${errorLocation}</span><div class="name">API</div><span class="result ${isNetworkIssue ? "ok" : "bad"}">${isNetworkIssue ? "Working" : "Error"}</span></div></div><div class="columns"><section><h2>What happened?</h2><p>APIサーバーへの接続に失敗しました。サーバーが混み合っているか、アクセス制限がかかっている可能性があります。</p><div class="debug"><strong>Debug Information</strong><br>Error Code: ${safeCode}${safeEndpoint ? `<br>Endpoint: ${safeEndpoint}` : ""}<br>Message: ${safeMessage}<br>Origin: ${escapeHtml(url.origin)}</div></section><section><h2>What can I do?</h2><p>しばらくしても復旧しない場合は、Discordサーバーのチケット・要望、または y_xyz のDMからご連絡ください。</p><p>復旧後は再読み込みではなく、一度トップページへ戻ってからお試しください。</p><a class="button" href="/">トップページに戻る</a></section></div><footer class="footer">Performance &amp; security by ymkw-top</footer></main></body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
