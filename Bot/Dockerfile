FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
RUN groupadd --gid 10001 appuser && useradd --uid 10001 --gid appuser --create-home appuser
COPY --chown=appuser:appuser . .
USER appuser
CMD ["node", "--import", "tsx", "src/main.ts"]
