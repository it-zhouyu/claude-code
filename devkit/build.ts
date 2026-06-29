// 把泄露的 Claude Code 源码 bundle 成一个可由 Bun 运行的 CLI。
//   1. features: []  → 所有 bun:bundle feature() = false（= 公开构建，内部功能 DCE 掉）
//   2. define: MACRO.* / USER_TYPE → build-time 内联宏与内部身份判定（DCE 掉 ant 分支）
//   3. 预扫描 src 所有 import → 为每个缺失包生成 node_modules/<pkg>/index.js（ESM，
//      显式 export 被引用的具名为深度 Proxy）。Bun 对 CJS 的 ESM named import 会做
//      cjs-module-lexer 静态分析，Proxy 通不过，必须 ESM 显式具名导出。
//   4. plugin：已安装包(含生成的 stub) → external；缺失相对路径/.d.ts → inline CJS Proxy
//   5. src/ 仍 bundle + minify + DCE
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { rm } from 'node:fs/promises'

const ROOT = process.cwd()

const PROXY_BODY = `const _ = new Proxy(function () {}, {
  get: (t, p) => {
    if (typeof p === 'symbol') {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === Symbol.iterator) return function* () {};
      return undefined;
    }
    if (p === 'then' || p === 'toJSON') return undefined;
    if (p === 'valueOf' || p === 'toString') return () => '';
    return _;
  },
  apply: () => _,
  construct: () => _,
  has: () => true,
});`

function tryResolve(base: string): boolean {
  for (const e of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
    if (existsSync(base + e)) return true
    for (const idx of ['index.ts', 'index.tsx', 'index.js']) {
      if (existsSync(path.join(base + e, idx))) return true
    }
  }
  return false
}
function pkgRoot(spec: string): string {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}
// Node 内建模块（bare 名，无 node: 前缀）—— 绝不能 stub，否则覆盖真内建
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram',
  'diagnostics_channel', 'dns', 'events', 'fs', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
])
// 是否「真实」安装 —— 排除我们自己生成的 stub（带 __devkit_stub 标记）
function isInstalled(spec: string): boolean {
  const root = pkgRoot(spec)
  const pj = path.join(ROOT, 'node_modules', root, 'package.json')
  if (!existsSync(pj)) return false
  try { if (JSON.parse(readFileSync(pj, 'utf8')).__devkit_stub) return false } catch {}
  return true
}

// ---- 预扫描：收集每个缺失包被引用的具名 ----
const namedByPkg = new Map<string, Set<string>>()
const glob = new Bun.Glob('src/**/*.{ts,tsx,js,jsx}')
for await (const file of glob.scan()) {
  let src: string
  try { src = await Bun.file(file).text() } catch { continue }
  for (const m of src.matchAll(/import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    const namedRaw = m[1]!, spec = m[2]!
    if (spec.startsWith('.') || isInstalled(spec) || NODE_BUILTINS.has(spec)) continue
    const names = namedByPkg.get(spec) ?? new Set<string>()
    for (let part of namedRaw.split(',')) {
      part = part.trim()
      if (!part || part.startsWith('type ') || part === 'type') continue
      const asM = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+[A-Za-z_$][\w$]*$/) // X as Y → 收集原始名 X（ESM export 的是原始名）
      names.add(asM ? asM[1]! : part.replace(/^type\s+/, ''))
    }
    namedByPkg.set(spec, names)
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[2]!
    if (spec.startsWith('.') || isInstalled(spec) || NODE_BUILTINS.has(spec)) continue
    const names = namedByPkg.get(spec) ?? new Set<string>()
    names.add('__default__'); namedByPkg.set(spec, names)
  }
}

// ---- 为缺失包生成 ESM stub（先清旧目录，强制重写）----
let stubbedPkgs = 0
for (const [spec, names] of namedByPkg) {
  const root = pkgRoot(spec)
  const dir = path.join(ROOT, 'node_modules', root)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const realNames = [...names].filter(n => n !== '__default__')
  const lines = [PROXY_BODY, `export default _;`, ...realNames.map(n => `export { _ as ${n} };`)]
  writeFileSync(path.join(dir, 'index.js'), lines.join('\n') + '\n')
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: root, type: 'module', main: 'index.js', exports: { '.': './index.js', './*': './index.js' }, __devkit_stub: true }),
  )
  stubbedPkgs++
}

// ---- bundle ----
await rm('dist', { recursive: true, force: true })
const stubbedRel = new Set<string>()
const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir: 'dist',
  target: 'bun',
  format: 'esm',
  naming: '[dir]/[name].js',
  minify: true,
  sourcemap: 'none',
  features: ['BUDDY'], // 开启 buddy（自包含，不依赖私有包）
  define: {
    'process.env.USER_TYPE': JSON.stringify('external'),
    'MACRO.VERSION': JSON.stringify('2.1.195-leak'),
    'MACRO.PACKAGE_URL': JSON.stringify('https://www.npmjs.com/package/@anthropic-ai/claude-code'),
    'MACRO.NATIVE_PACKAGE_URL': JSON.stringify(''),
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify(''),
    'MACRO.BUILD_TIME': JSON.stringify(''),
    'MACRO.VERSION_CHANGELOG': JSON.stringify(''),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify(''),
  },
  plugins: [{
    name: 'auto-stub',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        const p = args.path
        if (p.startsWith('bun:') || p.startsWith('node:')) return
        if (p.startsWith('./') || p.startsWith('../') || p.endsWith('.d.ts')) {
          const base = path.resolve(path.dirname(args.importer), p).replace(/\.(js|jsx|mjs|cjs|d\.ts|ts|tsx)$/, '')
          if (!tryResolve(base)) { stubbedRel.add(p); return { path: p, namespace: 'stub' } }
          return
        }
        if (p.startsWith('src/')) {
          const base = path.resolve(ROOT, p).replace(/\.(js|jsx|mjs|cjs|d\.ts|ts|tsx)$/, '')
          if (!tryResolve(base)) { stubbedRel.add(p); return { path: p, namespace: 'stub' } }
          return
        }
        if (NODE_BUILTINS.has(p)) return
        return { path: p, external: true }
      })
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `var stub; stub = new Proxy(function () {}, { get: (t, p) => { if (typeof p === 'symbol') { if (p === Symbol.toPrimitive) return () => ''; if (p === Symbol.iterator) return function* () {}; return undefined; } if (p === 'then' || p === 'toJSON') return undefined; if (p === 'valueOf' || p === 'toString') return () => ''; return stub; }, apply: () => stub, construct: () => stub, has: () => true }); module.exports = stub;`, loader: 'js' }))
    },
  }],
})

if (!result.success) {
  console.error('❌ BUILD FAILED:')
  for (const log of result.logs) console.error(' -', log)
  process.exit(1)
}
console.log('✅ BUILD OK:')
for (const o of result.outputs) console.log(`   ${o.path}  (${(o.size / 1024).toFixed(0)} KB)`)

// 后处理：commander 15 不接受多字符短 flag，源码的 '-d2e, --debug-to-stderr' 会让
// Commander 构造 option 时抛错。去掉短 flag（长 flag --debug-to-stderr 仍可用）。
const cliPath = path.join(ROOT, 'dist/cli.js')
const before = readFileSync(cliPath, 'utf8')
const after = before
  .replaceAll("'-d2e, --debug-to-stderr'", "'--debug-to-stderr'")
  .replaceAll('"-d2e, --debug-to-stderr"', '"--debug-to-stderr"')
if (before !== after) { writeFileSync(cliPath, after); console.log('🔧 patched -d2e → --debug-to-stderr') }

console.log(`📦 generated ${stubbedPkgs} ESM package stubs, 🩹 inlined ${stubbedRel.size} relative modules`)
