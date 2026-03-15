#!/bin/bash
# 一键部署到 GitHub（会自动触发 Vercel 部署）
# 首次使用：先在 GitHub 创建空仓库，然后执行：
#   git remote add origin https://github.com/你的用户名/仓库名.git

set -e
cd "$(dirname "$0")/.."

# 检查是否已配置 remote
if ! git remote get-url origin 2>/dev/null; then
  echo "❌ 尚未配置 GitHub 远程仓库"
  echo ""
  echo "请先执行（替换成你的仓库地址）："
  echo "  git remote add origin https://github.com/你的用户名/仓库名.git"
  echo ""
  echo "或在 GitHub 创建仓库后，复制其 URL 填入上方命令"
  exit 1
fi

# 提交信息，支持传入参数
MSG="${1:-$(date '+%Y-%m-%d %H:%M 更新')}"

git add .
if git diff --staged --quiet 2>/dev/null; then
  echo "✅ 没有新的修改，无需提交"
  exit 0
fi

git commit -m "$MSG"
git push -u origin main

echo ""
echo "✅ 已推送到 GitHub，Vercel 将自动部署"
