FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /src
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/server/package.json packages/server/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile
COPY packages/server packages/server
COPY packages/ui packages/ui
RUN pnpm --filter @tahweel/ui build && pnpm --filter @tahweel/server build
RUN pnpm --filter @tahweel/server deploy --legacy --prod /out/server && cp -r packages/ui/dist /out/server/public

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/server /app
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
