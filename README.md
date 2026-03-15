<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

## Run Locally

**Prerequisites:**  Node.js and pnpm

1. Install dependencies:
   `pnpm install`
2. Copy `.env.example` to `.env` and fill in the values:
   `cp .env.example .env`
3. Run the app:
   `pnpm run dev`

## GitHub OAuth 配置

### 1. 创建 GitHub OAuth App

1. 打开 GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**
2. 填写以下信息：
   - **Application name**：随意，如 `IdP Center`
   - **Homepage URL**：`http://localhost:5986`（生产环境改为实际域名）
   - **Authorization callback URL**：`http://localhost:5986/api/auth/github/callback`
3. 点击 **Register application**
4. 复制 **Client ID**，点击 **Generate a new client secret** 并复制

### 2. 配置环境变量

在项目根目录创建 `.env` 文件（参考 `.env.example`）：

```env
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here

# 可选，默认值为 http://localhost:5986/api/auth/github/callback
# GITHUB_CALLBACK_URL=https://yourdomain.com/api/auth/github/callback
```

### 3. 生产环境部署

1. 将 `GITHUB_CALLBACK_URL` 改为实际域名：
   ```env
   GITHUB_CALLBACK_URL=https://yourdomain.com/api/auth/github/callback
   ```
2. 同步更新 GitHub OAuth App 设置中的 **Authorization callback URL**

> 未配置 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 时，登录页不会显示 GitHub 登录按钮，功能自动禁用。


## Deploy with Docker
### 构建镜像

```bash
docker build -t idp-center .
```

### 多架构构建（适用于 Apple Silicon 和 x86_64）

```bash
docker buildx build  --platform linux/amd64,linux/arm64 -t idp-center:latest --push .
```

### 运行容器
docker run -d --name idp-center -p 5986:5986 -v $(pwd)/auth.db:/app/auth.db idp-center
