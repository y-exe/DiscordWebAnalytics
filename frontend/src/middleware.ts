import { NextResponse, type NextRequest } from "next/server";

// 同一オリジン運用 (k3s) ではAPIパスを内部バックエンドへ転送し、
// 元リクエストのホストを x-forwarded-host で伝えてギルド解決させる。
// 未設定 (Cloudflare Workers移行期) のときは next.config.ts のrewritesが従来どおり働く。
const API_PROXY_TARGET = process.env.API_PROXY_URL;

const API_PREFIXES = ["/channels", "/users", "/ranking", "/stats"];

function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function middleware(request: NextRequest) {
  if (!API_PROXY_TARGET) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (!isApiPath(pathname)) return NextResponse.next();

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", host);
  headers.set("x-forwarded-proto", request.headers.get("x-forwarded-proto") ?? "https");
  headers.delete("host");
  return NextResponse.rewrite(new URL(`${pathname}${search}`, API_PROXY_TARGET), {
    request: { headers },
  });
}

export const config = {
  matcher: ["/channels/:path*", "/users/:path*", "/ranking/:path*", "/stats/:path*"],
};
