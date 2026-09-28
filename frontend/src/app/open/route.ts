import { NextResponse } from "next/server";

export function GET(request: Request) {
  const source = new URL(request.url);
  return NextResponse.redirect(new URL(`/all${source.search}`, source), 301);
}
