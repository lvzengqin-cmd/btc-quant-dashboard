#!/bin/bash
# ============================================================
#  BTC 量化系统 - Ngrok 启动脚本
#  使用方式: bash start-with-ngrok.sh <ngrok-token>
#
#  1. 先去 https://ngrok.com 免费注册，获取 Authtoken
#  2. 安装 ngrok: npm i -g ngrok 或 brew install ngrok
#  3. 运行: bash start-with-ngrok.sh YOUR_NGROK_TOKEN
# ============================================================

NGROK_TOKEN="${1:-}"
if [ -z "$NGROK_TOKEN" ]; then
  echo "❌ 请提供 Ngrok Token:"
  echo "   bash start-with-ngrok.sh YOUR_NGROK_TOKEN"
  echo ""
  echo "   去这里免费获取: https://dashboard.ngrok.com/get-started/your-authtoken"
  exit 1
fi

# 配置 ngrok
ngrok config add-authtoken "$NGROK_TOKEN"

# 安装依赖
echo "📦 安装依赖..."
npm install

# 构建前端
echo "🎨 构建前端..."
npm run build

# 启动 ngrok 隧道（暴露本地 3456 端口）
echo "🌐 启动 Ngrok 隧道..."
ngrok http 3456 --log stdout &
NGROK_PID=$!

sleep 8

# 获取 ngrok 公网地址
echo ""
echo "⏳ 等待 ngrok 启动..."
NGROK_URL=""
for i in $(seq 1 15); do
  sleep 2
  NGROK_URL=$(curl -s localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$NGROK_URL" ]; then break; fi
  echo "   等待中... ($i/15)"
done

if [ -z "$NGROK_URL" ]; then
  echo "❌ Ngrok 启动失败，请检查 Token 是否正确"
  exit 1
fi

echo ""
echo "============================================"
echo "🚀 BTC 量化系统已启动！"
echo ""
echo "📱 前端地址: $NGROK_URL"
echo "🔌 API 地址: ${NGROK_URL}/api"
echo ""
echo "⚠️  前端需要修改 API 地址为上述 URL"
echo "============================================"
echo ""
echo "📋 下一步："
echo "   1. 用浏览器打开: $NGROK_URL"
echo "   2. 设置页面填入:"
echo "      - 做多 Webhook: 你的做多策略通知地址"
echo "      - 做空 Webhook: 你的做空策略通知地址"
echo ""
echo "🛑 按 Ctrl+C 停止服务"
echo ""

# 启动后端
node server/index.js
