#!/usr/bin/env bash
# demo-all-fields 的附带参考文件：证明 ${CLAUDE_SKILL_DIR} 指向本技能目录
echo "skill dir: $(cd "$(dirname "$0")/.." && pwd)"
echo "session skill check ok"
