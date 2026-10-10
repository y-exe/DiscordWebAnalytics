FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
RUN groupadd --gid 10001 appuser && useradd --uid 10001 --gid appuser --create-home appuser
COPY --chown=appuser:appuser . .
USER appuser
EXPOSE 8070
CMD ["bun", "src/main.ts"]
