#!/bin/bash

# 测试脚本：验证登录和 Token 功能
#
# admin 密码是首次启动时随机生成的（见 server/database.ts 的 seedDefaults），
# 只在服务启动日志中打印一次，因此这里必须通过参数/环境变量传入，不能写死。
# 首次登录会因 mustChangePassword=true 被拒绝（403 PASSWORD_EXPIRED），
# 必须先调用 /api/auth/password/change-expired 改密后才能正常登录拿 token。
#
# 用法：
#   ./test-login.sh <admin密码> [新密码]
#   ADMIN_PASSWORD=xxxx ./test-login.sh

ADMIN_PASSWORD="${1:-$ADMIN_PASSWORD}"
NEW_PASSWORD="${2:-NewAdmin@2024Pass!}"

if [ -z "$ADMIN_PASSWORD" ]; then
  echo "❌ 缺少 admin 密码。用法：./test-login.sh <admin密码> [新密码]"
  echo "   密码来源：首次运行 pnpm dev 时终端打印的 FIRST-RUN CREDENTIALS。"
  exit 1
fi

echo "🧪 测试 IdP Center 登录和 Token 功能"
echo "========================================"

# 测试登录
echo ""
echo "1️⃣ 测试登录 API..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:5986/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}")

echo "登录响应："
echo "$LOGIN_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$LOGIN_RESPONSE"

# 首次登录会要求改密，先走改密流程再重新登录
if echo "$LOGIN_RESPONSE" | grep -q "must_change_password"; then
  echo ""
  echo "🔐 检测到需要首次改密，调用 /api/auth/password/change-expired ..."
  CHANGE_RESPONSE=$(curl -s -X POST http://localhost:5986/api/auth/password/change-expired \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"admin\",\"current_password\":\"$ADMIN_PASSWORD\",\"new_password\":\"$NEW_PASSWORD\"}")
  echo "改密响应："
  echo "$CHANGE_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$CHANGE_RESPONSE"

  echo ""
  echo "🔁 使用新密码重新登录..."
  LOGIN_RESPONSE=$(curl -s -X POST http://localhost:5986/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"admin\",\"password\":\"$NEW_PASSWORD\"}")
  echo "登录响应："
  echo "$LOGIN_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$LOGIN_RESPONSE"
fi

# 提取 tokens
ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"refresh_token":"[^"]*' | cut -d'"' -f4)
SESSION_ID=$(echo "$LOGIN_RESPONSE" | grep -o '"session_id":"[^"]*' | cut -d'"' -f4)

echo ""
echo "✅ 提取的数据："
echo "  Access Token: ${ACCESS_TOKEN:0:50}..."
echo "  Refresh Token: ${REFRESH_TOKEN:0:50}..."
echo "  Session ID: $SESSION_ID"

# 测试获取用户信息
echo ""
echo "2️⃣ 测试获取用户信息..."
USER_INFO=$(curl -s http://localhost:5986/api/auth/me \
  -H "Authorization: Bearer $ACCESS_TOKEN")

echo "用户信息："
echo "$USER_INFO" | python3 -m json.tool 2>/dev/null || echo "$USER_INFO"

# 测试刷新 token
echo ""
echo "3️⃣ 测试刷新 Token..."
REFRESH_RESPONSE=$(curl -s -X POST http://localhost:5986/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH_TOKEN\"}")

echo "刷新响应："
echo "$REFRESH_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$REFRESH_RESPONSE"

# 提取新的 tokens
NEW_ACCESS_TOKEN=$(echo "$REFRESH_RESPONSE" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
NEW_REFRESH_TOKEN=$(echo "$REFRESH_RESPONSE" | grep -o '"refresh_token":"[^"]*' | cut -d'"' -f4)

echo ""
echo "✅ 新的 Tokens："
echo "  Access Token: ${NEW_ACCESS_TOKEN:0:50}..."
echo "  Refresh Token: ${NEW_REFRESH_TOKEN:0:50}..."

# 测试获取会话
echo ""
echo "4️⃣ 测试获取会话列表..."
SESSIONS=$(curl -s http://localhost:5986/api/user/sessions \
  -H "Authorization: Bearer $NEW_ACCESS_TOKEN" \
  -H "X-Session-Id: $SESSION_ID")

echo "会话列表："
echo "$SESSIONS" | python3 -m json.tool 2>/dev/null || echo "$SESSIONS"

echo ""
echo "✅ 所有测试完成！"
