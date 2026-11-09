# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint/package.json packages/eslint/
COPY packages/database/package.json packages/database/
COPY applications/server/package.json applications/server/
COPY applications/web/package.json applications/web/

RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./
RUN npm prune --omit=dev && mkdir -p /data/uploads

EXPOSE 3000
CMD ["sh", "-c", "node packages/database/dist/migrate.js latest && node applications/server/dist/index.js"]
