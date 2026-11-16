# The map lab as a public weather map: anyone can view it, your API key stays on the server, and
# early warnings are off (MAP_MODE=public; see apps/map-lab/README.md, "Deploy"). From the repository root:
#
#   docker build -f apps/map-lab/Dockerfile -t 4shadow-map .
#   docker run --rm -p 3000:3000 -e FORESHADOW_API_KEY=your-key 4shadow-map
#
# Nothing secret is baked into the image: settings are read when the server starts.
FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/map-lab/package.json apps/map-lab/
RUN npm ci --no-audit --no-fund
COPY packages/sdk packages/sdk
COPY apps/map-lab apps/map-lab
RUN npm run build -w packages/sdk \
 && npm run build -w apps/map-lab \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:26-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MAP_MODE=public
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/sdk/package.json packages/sdk/
COPY --from=build /app/packages/sdk/dist packages/sdk/dist
COPY --from=build /app/apps/map-lab/package.json apps/map-lab/
COPY --from=build /app/apps/map-lab/build apps/map-lab/build
WORKDIR /app/apps/map-lab
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "build"]
