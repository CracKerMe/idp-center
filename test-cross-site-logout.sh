#!/bin/bash

# 测试跨站点登出功能
# 需要在两个终端窗口运行：
# 1. 主站点：cd /Volumes/7400-1Tb/idp-center && npm run dev
# 2. 子站点：cd /Volumes/7400-1Tb/idp-center/example && npm run dev

echo "========================================="
echo "跨站点登出测试"
echo "========================================="
echo ""
echo "测试步骤："
echo ""
echo "1. 启动主站点（5986端口）："
echo "   cd /Volumes/7400-1Tb/idp-center"
echo "   npm run dev"
echo ""
echo "2. 启动子站点（3000端口）："
echo "   cd /Volumes/7400-1Tb/idp-center/example"
echo "   npm run dev"
echo ""
echo "3. 测试流程："
echo "   a) 访问 http://localhost:5986 并登录"
echo "   b) 访问 http://localhost:3000"
echo "   c) 点击子站点的'Login with IdP Center'"
echo "   d) 在子站点点击'Logout'"
echo "   e) 返回主站点 http://localhost:5986"
echo "   f) 刷新页面 - 应该自动跳转到登录页"
echo ""
echo "4. 验证："
echo "   - 子站点登出后，主站点的token应该失效"
echo "   - 主站点刷新页面时，应该检测到401错误"
echo "   - 主站点应该自动清除localStorage并跳转登录页"
echo ""
echo "========================================="
