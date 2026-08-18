# Claude Code 中有哪些权限配置方式

> 本文只讲"怎么配置"，不涉及源码实现。Claude Code 的权限可以归纳为 **6 大类配置方式**，从最常用到最进阶排序：
> **① settings.json 权限规则 → ② 权限模式 → ③ 命令行参数 → ④ 会话内交互授权 → ⑤ Hooks 钩子 → ⑥ 其他（/permissions、config 命令、企业托管）**

---

## 一、设置文件：settings.json（最核心、最常用）

### 1.1 文件位置与优先级

Claude Code 会从多个位置读取 settings.json，按优先级从低到高合并（后面的覆盖前面的）：

| 级别 | 路径 | 说明 |
|---|---|---|
| 用户级 | `~/.claude/settings.json` | 全局，对所有项目生效 |
| 项目级 | `<项目>/.claude/settings.json` | 进 git，团队共享 |
| 本地级 | `<项目>/.claude/settings.local.json` | 只对你生效，不进 git |
| 企业托管 | `managed-settings.json`（管理员下发） | 优先级最高，用户无法覆盖 |

### 1.2 permissions 配置项

```json
{
  "permissions": {
    "allow": ["Bash(git pull:*)", "Read", "mcp__server1__*"],
    "deny": ["Bash(rm:*)", "WebFetch"],
    "ask": ["Bash(npm publish:*)"],
    "defaultMode": "default",
    "disableBypassPermissionsMode": "disable",
    "additionalDirectories": ["/path/to/other/dir"]
  }
}
```

| 配置项 | 作用 |
|---|---|
| `allow` | 永远允许，不弹窗，直接放行 |
| `deny` | 永远拒绝，直接拦截 |
| `ask` | 永远弹窗询问，即使默认模式允许也要确认 |
| `defaultMode` | 会话默认的权限模式（见第三节） |
| `disableBypassPermissionsMode` | 设为 `"disable"` 时禁止 bypass，防止跳过权限 |
| `additionalDirectories` | 允许访问的额外目录（文件工具 / MCP 服务器需要） |

---

## 二、规则语法（allow / deny / ask 里怎么写）

### 2.0 三张表在 settings.json 里的完整示例

```json
{
  "permissions": {
    "allow": [
      "Bash(git:*)",
      "Bash(npm run build:*)",
      "Read",
      "Read(src/**)",
      "Edit(src/**)",
      "WebFetch(domain:example.com)",
      "mcp__server1__tool1"
    ],
    "deny": [
      "Bash(rm:*)",
      "Bash(ssh:*)",
      "Write(~/.zshrc)",
      "WebFetch",
      "mcp__server1"
    ],
    "ask": [
      "Bash(npm publish:*)",
      "Bash(git push:*)",
      "Write",
      "Edit(.env)",
      "Agent(Explore)"
    ]
  }
}
```

要点：
- **allow** = 永远放行；**deny** = 永远拒绝；**ask** = 永远弹窗确认。
- 优先级：**deny > ask > allow**（同一工具出现在多张表时，deny 赢；allow+ask 时 ask 赢）。
- 常用写法速查：

| 工具类型 | 写法 | 示例 |
|---|---|---|
| 整工具 | 直接写工具名 | `"Bash"`、`"Read"` |
| Bash | 前缀 `:*` 或通配 `*` | `"Bash(git:*)"`、`"Bash(npm run *)"` |
| 文件类（Read/Write/Edit/Glob/NotebookEdit） | glob 模式，不能用 `:*` | `"Read(src/**)"`、`"Glob(.env)"` |
| WebFetch | 必须 `domain:` 前缀 | `"WebFetch(domain:example.com)"` |
| WebSearch | 不支持通配符 | `"WebSearch(claude ai)"` |
| MCP | `mcp__服务器__工具`，不能带括号 | `"mcp__server1__tool1"`、`"mcp__server1__*"` |
| Agent | `Agent(类型)` | `"Agent(Explore)"` |

常见错误：空括号 `Bash()`、括号不匹配、`:*` 不在末尾、WebFetch 写 URL、MCP 带括号、工具名小写。

### 2.1 整体工具规则

直接写工具名，对该工具的**所有调用**生效：

```json
["Bash", "Read", "WebFetch", "mcp__server1"]
```

### 2.2 带内容的规则（只匹配特定内容）

格式：`工具名(内容)`。内容支持通配符 `*`，Bash 里 `:*` 表示"命令前缀匹配"：

```json
[
  "Bash(git pull:*)",
  "Bash(npm run build:*)",
  "Read(~/.zshrc)",
  "WebFetch(example.com)",
  "Glob(.env)",
  "Grep(api_key)"
]
```

支持内容匹配的常见工具：**Bash、FileRead、FileWrite、FileEdit、Glob、Grep、WebFetch、PowerShell、Skill** 等，以及 MCP 工具和 Agent。

### 2.3 MCP 工具规则

MCP 工具的规则名是 `mcp__服务器名__工具名`：

| 写法 | 作用 |
|---|---|
| `"mcp__server1"` | 匹配该服务器下**所有**工具 |
| `"mcp__server1__tool1"` | 匹配单个工具 |
| `"mcp__server1__*"` | 通配该服务器的所有工具 |


### 2.4 Agent 子代理规则

```json
["Agent(Explore)"]
```

可以针对特定子代理类型做 allow / deny / ask。

### 2.5 特殊 Bash 规则（进阶）

- `Bash(prompt:...)`：基于 AI 分类器的**语义规则**（当前属于内部能力，普通用户一般用不到）。

### 2.6 注意事项

- 内容里如果包含括号，需要转义：`\(` 和 `\)`，反斜杠写成 `\\`；
- 有没有括号决定了规则是"整工具"还是"带内容"，例如 `Bash` 和 `Bash(git pull:*)` 是两种规则；
- 规则写在 `allow` / `deny` / `ask` 里，语义分别是放行 / 拒绝 / 询问。

---

## 三、权限模式（Permission Mode）

### 3.1 有哪些模式

| 模式 | 行为 |
|---|---|
| `default` | 默认。未命中规则的操作用弹窗询问 |
| `acceptEdits` | 文件编辑自动接受（改文件不弹窗），其他仍询问 |
| `plan` | 计划模式，只读不修改 |
| `bypassPermissions` | 跳过所有权限检查 |
| `dontAsk` | 不弹窗，需要确认的一律拒绝 |

**acceptEdits 具体放行哪些工具？**

- 核心是"写文件三件套"：**Edit、Write、NotebookEdit**。条件是目标路径必须在允许的工作目录内（cwd + `permissions.additionalDirectories`），满足即自动放行；**工作目录外仍会询问**。
- **PowerShell**：仅自动放行文件系统修改类 cmdlet（`Set-Content`、`Add-Content`、`Remove-Item`、`Clear-Content`，含 `rm` 等别名），且带防注入校验；`New-Item`、`Copy-Item` 等复杂命令仍询问。
- **Bash 不在放行范围**：即使 `echo xxx > file` 这种写文件命令，acceptEdits 也不会自动放行，照常走权限流程。
- Read / Glob / Grep 等读工具在工作目录内本来就默认允许，与 acceptEdits 无关；MCP 工具不受 acceptEdits 影响。

### 3.2 怎么切换

1. **启动参数**：`claude --permission-mode acceptEdits`
2. **配置文件**：`permissions.defaultMode`（见 1.2）
3. **会话内**：`/permissions` 命令切换
4. **全局跳过**：`claude --dangerously-skip-permissions`（等价 bypass，只建议在隔离沙箱里使用）

---

## 四、命令行参数（本次会话一次性配置）

| 参数 | 作用 |
|---|---|
| `claude --permission-mode <mode>` | 本次会话的权限模式 |
| `claude --dangerously-skip-permissions` | 本次会话跳过所有权限检查 |
| `claude --allow-dangerously-skip-permissions` | 允许 bypass 作为可选项（不默认开启） |
| `claude --allowedTools "Bash(git:*) Edit"` | 追加允许的工具（支持规则语法） |
| `claude --disallowedTools "Bash(rm:*) WebFetch"` | 追加禁止的工具 |
| `claude --tools "Bash,Edit,Read"` | 指定本次会话的可用工具集 |
| `claude -p` | print 模式（管道/脚本），无法弹窗，需要权限的操作会被拒绝 |

示例：

```bash
claude --permission-mode acceptEdits
claude --allowedTools "Bash(git pull:*) Read" --disallowedTools "Bash(rm:*)"
```

---

## 五、会话内交互授权（弹窗"记住"）

执行需要权限的操作时，Claude Code 会弹窗让你选择。这是**最直观的配置方式**——选完就被写进 settings：

| 弹窗选项 | 效果 |
|---|---|
| 允许（本次） | 仅本次放行 |
| 允许并记住 | 写入 `permissions.allow`，以后不再问 |
| 拒绝（本次） | 仅本次拒绝 |
| 拒绝并记住 | 写入 `permissions.deny` |
| 编辑命令后允许 | 改一下参数/路径再执行 |
| 建议规则 | 系统给出可添加的规则，一键加入 allow/deny |

适用场景：临时放行某个命令、微调命令后执行、把高频操作快速加入 allow。

---

## 六、Hooks（钩子）配置权限（进阶 / 自动化）

在 settings.json 的 `hooks` 字段配置，适合团队统一管控和自动化流程。

### 6.1 PreToolUse（工具执行前）

脚本可以返回 JSON 决定权限：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node ./scripts/check-command.mjs" }]
      }
    ]
  }
}
```

钩子返回的 `permissionDecision` 支持：

| 字段 | 作用 |
|---|---|
| `permissionDecision: "allow" / "deny" / "ask"` | 放行 / 拒绝 / 转人工询问 |
| `updatedInput` | 修改后的工具入参（例如改写命令） |
| `updatedPermissions` | 追加权限规则 |
| `suggestions` | 给用户展示的建议规则 |

> 注意：钩子的 `allow` 不能绕过 settings 里的 deny / ask 规则，用户的显式配置优先级更高。

### 6.2 PermissionRequest

在无法弹窗的场景（headless / 后台 agent）先询问 hook，hook 可以替用户放行或拒绝。

### 6.3 PermissionDenied

auto 模式下被分类器拒绝后，hook 可以返回 `retry: true`，让模型获得"可以重试"的许可。

---

## 七、其他常用配置手段

### 7.1 `/permissions` 命令（会话内管理界面）

- 查看 / 搜索 allow / ask / deny 规则；
- 添加、删除规则；
- 切换权限模式；
- 重试被拒绝的命令。

### 7.2 `claude config` 命令

```bash
# 设置全局（-g = ~/.claude/settings.json）允许规则
claude config set -g permissions.allow '["Bash(git pull:*)"]'
# 查看当前权限配置
claude config get permissions
```

不加 `-g` 则写入项目级 `.claude/settings.json`。

### 7.3 企业托管（Managed Settings）

管理员通过 `managed-settings.json` 统一下发权限，配合 `"disableBypassPermissionsMode": "disable"` 可以锁死 bypass，用户无法绕过企业安全策略。

---

## 八、总结对照表

| 配置方式 | 作用范围 | 特点 |
|---|---|---|
| `permissions.allow / deny / ask` | 用户 / 项目 / 本地 | 最常用，规则匹配 |
| `permissions.defaultMode` | 用户 / 项目 / 本地 | 默认权限模式 |
| `--permission-mode` | 本次会话 | 覆盖 defaultMode |
| `--dangerously-skip-permissions` | 本次会话 | 跳过所有检查 |
| `--allowedTools / --disallowedTools` | 本次会话 | 追加允许 / 禁止 |
| 交互式弹窗"记住" | 会话内 | 自动写回 settings |
| PreToolUse / PermissionRequest hooks | 用户 / 项目 | 自动化决策 |
| `/permissions` | 会话内 | 规则管理界面 |
| `claude config set` | 用户 / 项目 | 命令行写配置 |
| managed-settings.json | 企业 | 最高优先级，可锁死 bypass |

**一句话路线图**：日常用 **settings.json 的 allow/deny/ask + 权限模式** 就够；临时用 **CLI 参数**；要自动化/团队管控再上 **Hooks** 和 **Managed Settings**。
