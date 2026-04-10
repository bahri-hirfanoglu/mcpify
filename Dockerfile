# syntax=docker/dockerfile:1.6

# ── Build stage ────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first so Docker can cache this layer
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy sources and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies for the runtime copy
RUN npm prune --omit=dev


# ── Runtime stage ──────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy only what the CLI needs at runtime
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# HTTP transport default port
EXPOSE 3100

ENTRYPOINT ["node", "/app/dist/cli.js"]
