# 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制依赖文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 安装依赖（包括 devDependencies 用于构建）
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建前端
RUN pnpm run build

# 安装生产依赖并清理
RUN pnpm install --prod --frozen-lockfile && \
    pnpm store prune

# 生产阶段 - 准备最终文件
FROM node:20-alpine AS deps

WORKDIR /app

# 安装编译工具和运行时依赖
RUN apk add --no-cache python3 make g++ sqlite-libs

# 复制依赖文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 使用 corepack 启用 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 从构建阶段复制已优化的 node_modules
COPY --from=builder /app/node_modules ./node_modules

# 重新编译 native 模块
RUN cd node_modules/better-sqlite3 && \
    npm run build-release || true

# 最终阶段 - 最小化镜像
FROM node:20-alpine AS production

WORKDIR /app

# 只安装运行时必需的库
RUN apk add --no-cache sqlite-libs

# 复制依赖文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 从 deps 阶段复制 node_modules
COPY --from=deps /app/node_modules ./node_modules

# 从构建阶段复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./

# 复制数据库文件
COPY auth.db ./auth.db

# 清理 node_modules 中不必要的文件
RUN find node_modules -type f -name "*.md" -delete && \
    find node_modules -type f -name "*.ts" -delete && \
    find node_modules -type f \( -name "*.map" -o -name "*.tsx" \) -delete && \
    find node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" \) -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d \( -name "example" -o -name "examples" -o -name "docs" \) -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type f -name "LICENSE*" -delete && \
    find node_modules -type f -name "*.tgz" -delete && \
    rm -rf /tmp/* /var/cache/apk/* /root/.npm /root/.pnpm-store

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 暴露端口
EXPOSE 3000

# 健康检查（使用 node 代替 wget 减少依赖）
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# 启动应用
CMD ["node", "server.ts"]
