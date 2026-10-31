FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json backend/bun.lock ./
RUN bun install --frozen-lockfile --production
RUN groupadd --gid 10001 appuser && useradd --uid 10001 --gid appuser --create-home appuser
COPY --chown=appuser:appuser backend/ .
COPY --chown=appuser:appuser shared/ /shared/
USER appuser
EXPOSE 8070
CMD ["bun", "src/main.ts"]
