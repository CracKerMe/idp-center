# 构建阶段
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# 安装 better-sqlite3 编译所需工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    binutils \
    && rm -rf /var/lib/apt/lists/*

# 启用 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制依赖文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 安装依赖（包括 devDependencies 用于构建）
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建并裁剪为生产依赖
RUN pnpm run build && \
    pnpm prune --prod && \
    find node_modules -type f -name "*.node" -exec strip --strip-unneeded {} + 2>/dev/null || true && \
    find node_modules -type f -name "*.md" -delete && \
    find node_modules -type f -name "*.ts" -delete && \
    find node_modules -type f \( -name "*.map" -o -name "*.tsx" \) -delete && \
    find node_modules -type f \( -name "*.c" -o -name "*.cc" -o -name "*.cpp" -o -name "*.h" -o -name "*.gyp" \) -delete && \
    find node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" \) -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d \( -name "example" -o -name "examples" -o -name "docs" \) -exec rm -rf {} + 2>/dev/null || true && \
    rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src && \
    find node_modules/better-sqlite3/build -mindepth 1 -maxdepth 1 ! -name "Release" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules/better-sqlite3/build/Release -mindepth 1 -maxdepth 1 ! -name "better_sqlite3.node" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type f -name "LICENSE*" -delete && \
    find node_modules -type f -name "*.tgz" -delete && \
    pnpm store prune

# 最终阶段
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS production

WORKDIR /app

# 复制运行时文件
COPY --chown=nonroot:nonroot package.json ./
COPY --chown=nonroot:nonroot --from=builder /app/node_modules ./node_modules
COPY --chown=nonroot:nonroot --from=builder /app/dist ./dist
COPY --chown=nonroot:nonroot --from=builder /app/build ./build

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=5986

# 暴露端口
EXPOSE 5986

# 健康检查（使用 node 代替 wget 减少依赖）
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD ["/nodejs/bin/node", "-e", "require('http').get('http://127.0.0.1:5986/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]

# 启动应用
CMD ["build/server.js"]
