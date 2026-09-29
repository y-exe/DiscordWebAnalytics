import { renderCloudflareTemplate } from "./cloudflare-template";

export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function rayId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "502";
  const message = url.searchParams.get("msg") || "Bad Gateway";
  const endpoint = url.searchParams.get("url") || "";
  const isNetworkIssue = code === "unknown" || code === "0";
  const safeCode = escapeHtml(code);
  const safeMessage = escapeHtml(message);
  const safeEndpoint = escapeHtml(endpoint);
  const time = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";

  const html = await renderCloudflareTemplate({
    TITLE: safeMessage,
    CODE: safeCode,
    NETWORK_STATUS: isNetworkIssue ? "error" : "ok",
    NETWORK_LOCATION: escapeHtml(url.host || "Gateway"),
    API_STATUS: isNetworkIssue ? "ok" : "error",
    API_LOCATION: "Backend Server",
    ERROR_SOURCE: isNetworkIssue ? "cloudflare" : "host",
    ENDPOINT: safeEndpoint,
    ORIGIN: escapeHtml(url.origin),
    TIME: time,
    RAY_ID: rayId(),
  });

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
