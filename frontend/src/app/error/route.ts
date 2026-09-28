import { render } from "cloudflare-error-page";

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

  const html = render({
    title: safeMessage,
    error_code: Number.parseInt(code, 10) || 502,
    html_title: `${safeCode}: ${safeMessage}`,
    browser_status: { status: "ok", name: "Browser", location: "You" },
    cloudflare_status: { status: isNetworkIssue ? "error" : "ok", name: "Network", location: url.host || "Gateway" },
    host_status: { status: isNetworkIssue ? "ok" : "error", name: "API", location: "Backend Server" },
    error_source: isNetworkIssue ? "cloudflare" : "host",
    what_happened: `<p style="margin-bottom:16px;line-height:1.6">APIサーバーへの接続に失敗しました。<br/>サーバーが混み合っているか、アクセス制限がかかっている可能性があります。</p><div style="font-size:.85em;opacity:.8;padding:16px;background:rgba(0,0,0,.03);border:1px solid rgba(0,0,0,.05);border-radius:6px;font-family:monospace;line-height:1.6;word-break:break-all"><strong>Debug Information</strong><br/><b>Error Code:</b> ${safeCode}${safeEndpoint ? `<br/><b>Endpoint:</b> ${safeEndpoint}` : ""}<br/><b>Message:</b> ${safeMessage}<br/><b>Origin:</b> ${escapeHtml(url.origin)}</div>`,
    what_can_i_do: '<p style="margin-bottom:24px;line-height:1.6">しばらくしても復旧しない場合は、Discordサーバーのチケット・要望、または y_xyz のDMからご連絡ください。<br/><br/>復旧後は再読み込みではなく、一度トップページへ戻ってからお試しください。</p><a href="/" style="display:inline-block;padding:12px 24px;background:#0051c3;color:#fff;border-radius:4px;text-decoration:none;font-weight:bold">トップページに戻る</a>',
    perf_sec_by: { text: "ymkw-top", link: "/" },
    more_information: { hidden: true },
  });

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
