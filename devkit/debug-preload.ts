import { plugin } from 'bun'
// 调试 preload：让 Bun 直接从 src/ 运行源码（配合 VSCode Bun 调试）。
// - 注入构建期由 Bun.build define 内联的 MACRO 宏与 USER_TYPE
// - 被裁剪的模块由 devkit/debug-stubs.ts 生成的磁盘 stub 兜底（先跑一次）
// 用法: bun --preload ./devkit/debug-preload.ts src/entrypoints/cli.tsx
;(globalThis as any).MACRO = {
  VERSION: '2.1.195-leak-debug',
  PACKAGE_URL: 'https://www.npmjs.com/package/@anthropic-ai/claude-code',
  NATIVE_PACKAGE_URL: '',
  FEEDBACK_CHANNEL: '',
  BUILD_TIME: '',
  VERSION_CHANGELOG: '',
  ISSUES_EXPLAINER: '',
}
process.env.USER_TYPE ??= 'external'

// ---- 应用 ~/.claude/settings.json 的 env 块 ----
// 官方 Claude Code 会把 settings.json 里 env 块的变量注入进程；但源码调试时
// 该文件常因 schema 校验失败被整体跳过，这条机制失效。这里手动补上，
// 使 launch/attach 两个调试流程都免登录（如智谱的 ANTHROPIC_BASE_URL 等）。
// 优先级：settings.json 的值覆盖已有环境变量（与官方行为一致）。
try {
  const { readFileSync } = require('node:fs')
  const { join } = require('node:path')
  const settingsPath = join(
    process.env.CLAUDE_CONFIG_DIR ?? join((globalThis as any).Bun?.homedir?.() ?? require('node:os').homedir(), '.claude'),
    'settings.json',
  )
  const envBlock = JSON.parse(readFileSync(settingsPath, 'utf8')).env
  if (envBlock && typeof envBlock === 'object') {
    for (const [k, v] of Object.entries(envBlock)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        process.env[k] = String(v)
      }
    }
  }
} catch {
  // settings.json 不存在/解析失败时静默跳过
}

// commander 15 不接受多字符短 flag（'-d2e, --debug-to-stderr'），与 devkit/build.ts
// 的 dist 后处理一致：在源码模式下载入 src/main.tsx 时做同样替换。
plugin({
  name: 'debug-commander-flag-patch',
  setup(build) {
    build.onLoad({ filter: /src\/main\.tsx$/ }, async args => {
      const orig = await Bun.file(args.path).text()
      return {
        contents: orig
          .replaceAll("'-d2e, --debug-to-stderr'", "'--debug-to-stderr'")
          .replaceAll('"-d2e, --debug-to-stderr"', '"--debug-to-stderr"'),
        loader: 'tsx',
      }
    })
  },
})

// ---- 绕过反调试守卫 ----
// src/main.tsx 顶层 isBeingDebugged() 检测到 --inspect/NODE_OPTIONS/inspector.url()
// 时，external 构建会直接 process.exit(1)，导致无法用 VSCode 调试。
// 在这里中和它的检测途径（preload 先于 main.tsx 执行）：
// 1) execArgv 里的 inspect 参数（--inspect-wait=... 会被 /--inspect(-brk)?/ 匹配到）
process.execArgv = process.execArgv.filter(a => !/--inspect|--debug/.test(a))
// 2) 接管 global.require('inspector')：Bun 默认没有 global.require，
//    守卫会走 catch 分支；这里显式提供，保证任何环境下 inspector.url() 都是空
const __origRequire = (globalThis as any).require
;(globalThis as any).require = (name: string) => {
  if (name === 'inspector' || name === 'node:inspector') return { url: () => undefined }
  if (__origRequire) return __origRequire(name)
  throw new Error(`require('${name}') is not available`)
}
