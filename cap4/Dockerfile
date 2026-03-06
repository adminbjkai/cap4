# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /workspace

ENV CI=1
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm build

# Stage 2: Runtime
FROM node:20-alpine AS runtime

WORKDIR /workspace

ENV CI=1
ENV NODE_ENV=production

RUN apk add --no-cache ffmpeg
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Copy built artifacts from builder
COPY --from=builder /workspace/apps ./apps
COPY --from=builder /workspace/packages ./packages

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# The default command can be overridden in docker-compose.yml
CMD ["node", "apps/web-api/dist/index.js"]
