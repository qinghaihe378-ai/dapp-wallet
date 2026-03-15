#!/bin/bash
# 首次配置：将项目连接到 GitHub 仓库
# 用法：bash scripts/setup-github.sh https://github.com/你的用户名/仓库名.git

set -e
cd "$(dirname "$0")/.."

REPO_URL="$1"
if [ -z "$REPO_URL" ]; then
  echo "用法：bash scripts/setup-github.sh <GitHub仓库地址>"
  echo ""
  echo "示例："
  echo "  bash scripts/setup-github.sh https://github.com/username/dapp-wallet.git"
  echo ""
  echo "请先在 GitHub 创建空仓库，然后复制其 URL"
  exit 1
fi

# 添加远程仓库（若已存在则更新）
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"

# 首次提交
git add .
git commit -m "Initial commit" 2>/dev/null || echo "（无新文件需提交）"

echo ""
echo "✅ 配置完成！"
echo ""
echo "接下来执行："
echo "  npm run deploy"
echo ""
echo "或手动推送："
echo "  git push -u origin main"
echo ""
echo "推送后，在 Vercel 导入此仓库即可自动部署"
