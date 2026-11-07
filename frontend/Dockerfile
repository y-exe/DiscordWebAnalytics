# k3s向けNext.js SSRコンテナ (standalone出力)
FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 同一オリジン運用: クライアントは相対パスで同一ホストのAPIを呼ぶ
ENV NEXT_PUBLIC_SAME_ORIGIN=true \
    BUILD_STANDALONE=true \
    NEXT_TELEMETRY_DISABLED=1
RUN bun --bun next build

FROM oven/bun:1.3 AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=4321
# SSRからバックエンドへはクラスタ内Service DNSで到達する (compose/k3sの環境変数で上書き可)
ENV API_URL=http://ymkw-backend:8070 \
    API_PROXY_URL=http://ymkw-backend:8070
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 4321
CMD ["bun", "server.js"]
