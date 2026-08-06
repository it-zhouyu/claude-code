#!/usr/bin/env bash
# 交互式 TUI 调试入口：启动带 inspector 的源码 CLI（鉴权 env 由 preload 自动加载）
# 用法: ./devkit/debug-tui.sh        （然后在 VSCode 里 F5 选「附加到 Bun」）
cd "$(dirname "$0")/.."
exec bun --inspect-wait=ws://localhost:6499/ --preload ./devkit/debug-preload.ts src/entrypoints/cli.tsx "$@"
