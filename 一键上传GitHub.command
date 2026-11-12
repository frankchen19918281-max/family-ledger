#!/bin/zsh
# ==============================================================================
# 🏡 家庭共同记账 (family-ledger) — 一键上传 GitHub & 更新线上网站脚本
# 用法：
#   方式 1：在访达 (Finder) 中直接双击【一键上传GitHub.command】即可全自动上传
#   方式 2：在终端执行 ./一键上传GitHub.command "可选的更新备注"
# ==============================================================================

set -u

# 切换到脚本所在的项目根目录
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1

DRY_RUN=0
CUSTOM_MSG=""
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=1
  elif [[ -z "$CUSTOM_MSG" ]]; then
    CUSTOM_MSG="$arg"
  fi
done

pause_if_finder() {
  # 如果是从 Finder 双击打开的交互式终端窗口，停住方便查看结果
  if [[ -t 0 && $DRY_RUN -eq 0 && "${TERM_PROGRAM:-}" == "Apple_Terminal" ]]; then
    echo ""
    read -k 1 "?按任意键关闭窗口..."
    echo ""
  fi
}

echo "========================================================"
echo "🚀 家庭共同记账 — 一键上传 GitHub 自动发布工具"
echo "📂 项目目录: $PROJECT_DIR"
echo "========================================================"

# 1. 确保小程序与网页端共用同一份最新计算引擎
if [[ -f "shared/engine.js" && -d "miniprogram/utils" ]]; then
  if ! cmp -s "shared/engine.js" "miniprogram/utils/engine.js"; then
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "🔍 [预检] 检测到 shared/engine.js 更新，正式上传时将自动同步至 miniprogram/utils/engine.js"
    else
      cp "shared/engine.js" "miniprogram/utils/engine.js"
      echo "🔄 已自动同步核心引擎 -> miniprogram/utils/engine.js"
    fi
  fi
fi

# 2. 检查是否有文件改动
CHANGES="$(git --no-optional-locks status --porcelain)" || exit 1
if [[ -z "$CHANGES" ]]; then
  echo ""
  echo "✅ 当前本地没有新的改动需要提交，检查是否有未推送的提交..."
  BRANCH="$(git branch --show-current)"
  UNPUSHED="$(git log "origin/${BRANCH}..HEAD" --oneline 2>/dev/null || true)"
  if [[ -z "$UNPUSHED" ]]; then
    echo "🎉 线上 GitHub 已经是最新代码，无需重复上传！"
    echo "🌐 网站地址: https://frankchen19918281-max.github.io/family-ledger/web/index.html"
    pause_if_finder
    exit 0
  fi
else
  # 若网页端或共享引擎有改动，自动刷新 index.html 的防缓存版本号 (?v=YYYYMMDD.HHMM)
  if echo "$CHANGES" | grep -Eq '(web/|shared/)'; then
    VER_TAG="$(date '+%Y%m%d.%H%M')"
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "🔍 [预检] 检测到网页资源变更，正式上传时将自动刷新缓存版本号为 ?v=${VER_TAG}"
    elif [[ -f "web/index.html" ]]; then
      VER_TAG="$VER_TAG" python3 -c '
import os, pathlib, re
p = pathlib.Path("web/index.html")
txt = p.read_text(encoding="utf-8")
ver = os.environ["VER_TAG"]
new_txt = re.sub(r"\?v=[0-9A-Za-z._-]+", f"?v={ver}", txt)
if new_txt != txt:
    p.write_text(new_txt, encoding="utf-8")
'
      echo "✨ 已自动刷新手机浏览器防缓存版本号: ?v=${VER_TAG}"
    fi
  fi
fi

echo ""
echo "📋 本次待上传的文件变更："
git status -s
echo ""

if [[ $DRY_RUN -eq 1 ]]; then
  echo "✅ [预检通过] 脚本语法、目录定位与变更检测一切正常（未执行实际 git commit / push）。"
  exit 0
fi

# 3. 自动暂存并提交
BRANCH="$(git branch --show-current)"
if [[ -z "$BRANCH" ]]; then
  BRANCH="main"
fi

NOW_STR="$(date '+%Y-%m-%d %H:%M:%S')"
COMMIT_MSG="${CUSTOM_MSG:-🚀 一键更新家庭共同记账 (${NOW_STR})}"

git add -A

if ! git diff --cached --quiet; then
  echo "📦 正在打包提交: $COMMIT_MSG"
  git commit -m "$COMMIT_MSG"
fi

# 4. 推送至 GitHub 远端仓库
echo "☁️  正在上传至 GitHub (${BRANCH} 分支)..."
if git push origin "$BRANCH"; then
  echo ""
  echo "========================================================"
  echo "🎉 一键上传 GitHub 成功！"
  echo "🌐 线上网站（约 30~60 秒自动生效）："
  echo "   https://frankchen19918281-max.github.io/family-ledger/web/index.html"
  echo "📦 GitHub 仓库："
  echo "   https://github.com/frankchen19918281-max/family-ledger"
  echo "========================================================"
else
  echo ""
  echo "========================================================"
  echo "❌ 上传失败：无法连接到 GitHub，请检查网络（或代理/VPN）后重试。"
  echo "💡 你的本地代码修改已安全保存并完成提交，网络恢复后再双击一次即可！"
  echo "========================================================"
  pause_if_finder
  exit 1
fi

pause_if_finder
