---
name: demo-all-fields
description: 演示 SKILL.md 全部 frontmatter 字段的测试技能，配合源码调试 skill 加载链路。
argument-hint: "[目标文件] [检查模式]"
when_to_use: 调试 skill 加载、frontmatter 解析、skill_listing 注入链路时使用；用户说"测试 demo skill"或"验证 skill 字段"时触发。
version: 1.0.0
user-invocable: true
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git branch:*)
arguments: target, mode
shell: bash
context: fork
model: sonnet
hooks:
  PostToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: echo "[demo-all-fields] PostToolUse(Bash) fired"
          timeout: 5000
---

# 字段全演示

本技能的唯一目的：把 `parseSkillFrontmatterFields` 支持的每个 frontmatter 字段都用一遍，供调试观察。没有任何实际功能。

## 参数替换（substituteArguments 的现场）

- 第一个参数（target）：$1
- 第二个参数（mode）：$2
- 原始参数串：$ARGUMENTS

## 内置变量（createSkillCommand 里 replace 的现场）

- 本技能目录：${CLAUDE_SKILL_DIR}
- 当前会话 ID：${CLAUDE_SESSION_ID}

## shell 注入（调用时执行，结果嵌进正文）

- 当前 git 分支：!`git branch --show-current`

## 参考文件

技能自带脚本：${CLAUDE_SKILL_DIR}/scripts/check.sh（可在正文里被 Read 或执行）
