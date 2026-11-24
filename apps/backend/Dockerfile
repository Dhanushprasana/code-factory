FROM node:22-bookworm-slim AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm ci

COPY apps/backend apps/backend
RUN npm --prefix apps/backend run build

FROM node:22-bookworm-slim

WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g rimraf
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build /workspace/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /workspace/apps/backend/dist ./apps/backend/dist
EXPOSE 4000
CMD ["node", "apps/backend/dist/main.js"]
