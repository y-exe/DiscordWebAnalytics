# k3s向け 統合コンテナ (Next.js SSR + Hono API マウント)
# リポジトリルートをコンテキストにしてビルドする: docker build -f frontend/Dockerfile .
FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY frontend/package.json frontend/bun.lock frontend/
RUN cd frontend && bun install --frozen-lockfile

FROM oven/bun:1.3 AS builder
WORKDIR /app
COPY --from=deps /app/frontend/node_modules frontend/node_modules
COPY backend/package.json backend/tsconfig.json backend/
COPY backend/src backend/src
COPY shared shared
COPY frontend/package.json frontend/tsconfig.json frontend/next.config.ts frontend/postcss.config.cjs frontend/
COPY frontend/src frontend/src
COPY frontend/public frontend/public
WORKDIR /app/frontend
# 同一オリジン運用: クライアントは /api/* でAPIを呼ぶ (同一プロセスのHonoが処理する)
ENV NEXT_PUBLIC_SAME_ORIGIN=true \
    BUILD_STANDALONE=true \
    NEXT_TELEMETRY_DISABLED=1
RUN bun --bun next build

FROM oven/bun:1.3 AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=4321 \
    API_URL=http://127.0.0.1:4321/api
# DB_DSN / API_SECRET / ADMIN_SESSION_SECRET / ADMIN_PASSWORD_HASH は配備環境 (k8s Secret等) で与える
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder /app/frontend/public ./frontend/public
EXPOSE 4321
CMD ["bun", "./frontend/server.js"]
