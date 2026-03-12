#!/bin/bash

# 测试脚本：验证登录和 Token 功能

echo "🧪 测试 IdP Center 登录和 Token 功能"
echo "========================================"

# 测试登录
echo ""
echo "1️⃣ 测试登录 API..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:5986/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')

echo "登录响应："
echo "$LOGIN_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$LOGIN_RESPONSE"

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
