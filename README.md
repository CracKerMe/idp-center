<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

## Run Locally

**Prerequisites:**  Node.js and pnpm

1. Install dependencies:
   `pnpm install`
2. Run the app:
   `pnpm run dev`


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
