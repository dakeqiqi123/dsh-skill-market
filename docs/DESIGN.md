# DSH 技能选择插件：设计与实现方案

> **这是立项时的设计笔记，保留原始内容以便追溯。**
> 其中记录的扩展点取证（slot 名、provider 契约、rank 档位、client API）仍是理解本插件的最好入口；
> 但实现已经超出本文的规划——自绘的集市/管理面板（本文列为 P3）已经完成并发布，见 [`../README.md`](../README.md)。
> 文中的 `<APP>`、`<APP-DATA>`、`%APPDATA%`、`$DSH_HOME`、`%USERPROFILE%`、`<WORKSPACE>` 等占位符，
> 含义与 [`DEVNOTES.md`](./DEVNOTES.md) 一致。

> 目标：做一个类似 WorkBuddy 截图里那种「直接选择我想要的技能」的 DSH 插件。
> 技能来源要覆盖三种：**我自己的本地技能文件夹**、**GitHub 仓库**、**精选清单 / 集市（含搜索与一键安装）**。
> UI 位置：**输入框左侧那个菜单**（和「模式 / 专家 / 连接器」同级）。

本文里所有 API 签名、slot 名、目录约定，都是从**你这台机器上正在运行的 DSH 0.2.0-rc.2 产物**里读出来的，不是从文档抄的。标注了「待现场核实」的地方是唯一需要装上去以后用 `cordis_inspect_query` 确认的点。

---

## 0. 一句话结论

**DSH 已经有「技能选择器」的机制了**（输入 `/` 触发、带搜索、能调起、能预览 SKILL.md），缺的只是**技能来源**和**一个常驻的入口按钮**。

所以这个插件不该重写菜单，而应该做两件事：

1. **Host 半边**：把「本地文件夹 + GitHub 仓库 + 精选清单」变成一个新的 `ctx.skills` provider —— 注册进去以后，DSH 自己那套 `/` 技能菜单、技能卡片、`skill` 工具、system prompt 里的技能目录**全部自动生效**，一行 UI 代码都不用写。
2. **Client 半边**：在 `conversation.input.left`（输入框左下角工具栏）加一个按钮，点一下就用 DSH 自己的菜单打开"只有我这组技能"的选择器。搜索结果、键盘上下键、Enter 选中、Escape 关闭，全部复用宿主实现 —— 外观和交互天然一致。

集市（浏览 / 安装 / 卸载）是 Host 服务 + 一个薄 UI；它跟上面的 provider 是同一份数据的两个视图。

---

## 1. 三条路线对比

| | 做法 | 工作量 | 能得到什么 | 风险 |
|---|---|---|---|---|
| **路线 1** | **只做 Host provider**：`ctx.skills.registerProvider()` | 小 | 技能出现在**现有** `/` 菜单里，可搜、可选、可预览、模型也能调用 | 极低 |
| **路线 2（推荐）** | 路线 1 + **Client 入口按钮**（复用宿主菜单） | 中 | 上面全部 + 输入框左侧一个常驻"技能"按钮，一键打开技能选择器 | 低（slot 是否存在于本版本已核实） |
| **路线 3** | 路线 2 + **自绘集市面板**（浏览/安装/卸载/本地添加） | 大 | 完整对标截图里那套：搜索框、技能卡片、从本地添加、管理技能 | 中（自绘 UI 要自己维护主题与交互，且不能 import DSH 的 UI 包） |

建议：**先做路线 2 落地并验证，再增量加路线 3 的面板**。路线 2 已经能满足"能直接选择我想要的技能"这个核心诉求。

---

## 2. 架构总览

```
                     ┌──────────────────────────── Host (Node) ────────────────────────────┐
                     │                                                                     │
  本地文件夹 ────────┤  MySkillProvider                                                    │
  $DSH_HOME/skills ──┤    list() → candidate[]      ┌─ ctx.skills (SkillRegistry) ─┐        │
  GitHub 仓库 ───────┤    get()  → definition       │  合并所有 provider，按 rank   │        │
  精选清单 ──────────┤                              │  裁决重名、缓存、失效          │        │
                     │  MarketplaceService          └───────────────┬──────────────┘        │
                     │    search() / install() / remove()           │                       │
                     └──────────────────────────────────────────────┼───────────────────────┘
                                                                    │
                                        skills/list (Remote)        │  skill 工具 / 用户 /skill
                                                                    ▼
                     ┌──────────────────────── Client (Browser) ───────────────────────────┐
                     │  conversation.input.left  ──► [技能] 按钮                            │
                     │        │ click                                                      │
                     │        └─► inputTriggers.sessionOf(actx).toggleSource('market-skill')│
                     │                        │                                            │
                     │                        ▼                                            │
                     │  宿主已有的 slash 菜单（搜索 / 键盘 / Escape / 面包屑）—— 复用        │
                     └─────────────────────────────────────────────────────────────────────┘
```

关键点：**选择器不归插件所有**。插件只贡献「一个 source」和「一个按钮」，渲染、搜索、键盘、无障碍全部是宿主的 `dsh-client-ui-input-trigger` 在做。

---

## 3. 已核实的扩展点（就你这台机器）

### 3.1 Host 半边

| 能力 | 位置 | 签名 / 契约 |
|---|---|---|
| 技能注册表服务 | `ctx.skills`（`@deepseek-ai/dsh-skill`） | `Service`，key 为 `skills` |
| 注册 provider | `ctx.skills.registerProvider(create)` | `create(control) → provider`；`control = { signal, invalidate() }`；返回 disposer |
| 注册内存技能 | `ctx.skills.register(skill)` | 同名先到先得；默认 `invocation = { modelInvocable: true, userInvocable: true }`，`provider = 'runtime'` |
| 列目录 | `ctx.skills.list({ cwd?, scope?, signal? })` | `→ SkillSummary[]`，按名排序 |
| 取正文 | `ctx.skills.get(name, { cwd?, signal? })` | `→ SkillDefinition \| undefined`；名字非法直接返回 `undefined` 不抛 |
| 变更事件 | `ctx.on('skills/change', ...)` | 无过滤条件；provider 调 `invalidate()` 或运行时注册/释放时发出 |

**Provider 对象**（`dsh-skill-filesystem` 就是这么实现的）：

```js
{
  name: 'my-skills',                 // 保留名 'runtime' 不可用；同层重名抛错
  async list(options) { /* → candidate[] | { candidates, complete:false } */ },
  async get(candidate, options) { /* → definition | undefined */ },
}
```

**candidate**（`list()` 返回，会被逐字段校验）：

```js
{
  name,            // 必须匹配 /^[a-z0-9]+(?:-[a-z0-9]+)*$/，即 kebab-case
  description,     // 非空字符串，必填
  whenToUse,       // 可选字符串
  invocation: { modelInvocable: boolean, userInvocable: boolean },  // 两个都必须是布尔
  source,          // 字符串，例如 'custom' / 'github' / 'market'
  provider,        // 必须 === provider.name，否则抛错
  rank,            // 有限数字，越小越优先
  locator,         // 不透明对象，原样回传给 get()
  path,            // 可选，SKILL.md 路径（UI 预览用）
  metadata,        // 可选
}
```

**definition**（`get()` 返回）：

```js
{
  name, description, whenToUse?, invocation, source, provider,
  resourceBase: { kind: 'directory', path } | { kind: 'url', url } | { kind: 'opaque', description },
  path?, metadata?,
  content,         // SKILL.md 正文（去掉 frontmatter）
}
```

`resourceBase` 会渲染进模型的 `<skill_resources>` 提示里：目录型告诉模型「相对路径按这个目录解析」，URL 型告诉它按 base URL 解析。**GitHub 来源建议给 `url`**，让模型知道去哪找技能附带的脚本/模板。

**rank 与重名裁决**（同一个 layer 内）：

| rank | 来源 |
|---|---|
| 100 | 项目 `.dsh/skills` |
| 200 | 项目 `.agents/skills` |
| 300 | `customSkillDirs` |
| 400 | `$DSH_HOME/skills` |
| 500 | `~/.agents/skills` |
| 600 | bundled（DSH 自带技能） |
| 250 | runtime（`ctx.skills.register()` 的默认 rank） |

数字越小越优先。**你装的插件给的 rank 建议取 320~380**：比项目自带技能低（项目应该能覆盖插件），比用户全局目录高（插件是显式装的东西）。

> 注意：这是**同 layer 内**的裁决。host 行/repository 插件落在全局 layer，agent preset 挂载的插件落在该 preset 的 layer —— 近的 layer 直接赢，不看 rank。

### 3.2 Client 半边

| 能力 | 位置 | 说明 |
|---|---|---|
| 左下工具栏槽 | `conversation.input.left` | **kind = list，scope = session**，目前**没有任何内置插件占用**，实测空闲 |
| 面板/浮层槽 | `conversation.composer.dock` (list) / `conversation.input.overlay` (list) / `shell.overlay` (list) | 需要自绘面板时用 |
| 输入触发服务 | `ctx.inputTriggers` | `Service`，`inject = ['sessions']` |
| 注册 source | `ctx.inputTriggers.registerSource(src)` | `(trigger, name)` 唯一，重名抛错；返回 disposer |
| 取会话控制器 | `ctx.inputTriggers.sessionOf(actx)` | 需传**会话 scope 的 ctx**，否则抛 |
| 编程式打开菜单 | `controller.toggleSource(sourceName, hit)` | 再调一次同一个 source 即关闭 |
| 会话 scope | `ctx.sessions.scope(sessionId)` | 可能返回 `undefined`，必须处理 |
| 菜单开关状态 | slot inject 里的 `hooks.menuLauncher`（snapshot store） | `useMenuLauncher(sel)` 可判断当前是不是自己 |

**source 对象契约**（`dsh-client-ui-skill` 的 `/` 技能源就是这份）：

```js
{
  trigger: '/',                 // 触发字符
  name: 'market-skill',         // 唯一名，会被 toggleSource 用
  order: 5,                     // 菜单内分组顺序
  async candidates(session, { query, signal }) { /* → { name, description, label? }[] */ },
  warm(session) {},             // 预热目录（可选）
  lexicon(session) { /* → string[] */ },              // 草稿里的词表（可选）
  subscribeLexicon(session, listener) { /* → dispose */ }, // 词表变化通知（可选）
  openReference(session, { ref }) { /* → boolean */ },     // 点击引用预览（可选）
  onPick({ candidate }) { return { text: '/name ' }; },     // 选中后往草稿里写什么
}
```

**打开菜单用的 synthetic hit**（照抄宿主对 `toggleCommandMenu` 的用法）：

```js
{
  trigger: '/',
  query: '',
  quoted: false,
  position: 'leading',       // 草稿光标前是空白 → 'leading'，否则 'inline'
  span: { start, end, draftRev },
}
```

> **风险点（唯一需要现场核实的）**：`toggleSource` 是否允许在没有编辑器选区的情况下调用。
> 宿主的 `toggleCommandMenu` 是从真实键盘选区（`keyboard.caretSpan()`）进来的，而 `toggleSource` 恰好**没有**给 `this.hit` 赋值（`track()` 才会）——但 `pick()` 里有一条 `this.hit === null` 的早退，`settle()` 又要读 `hit.position` / `hit.span`。
> 所以最坏的表现是：按钮点开菜单、能搜能上下移动，但**选中行不生效**。
> 兜底顺序：
> 1. 直接用 `/` 菜单（功能完全一致，只是不点按钮）；
> 2. 改成在 `conversation.composer.dock` 里自绘面板，自己定位到输入框上方，交互完全自控；
> 3. 核实并把宿主这个不一致当 bug 上报（`toggleSource` 与 `pick` 对 `this.hit` 的假设不同）。
> 核实方式：装上插件后用 `cordis_inspect_query` 查 `Slots` 子树的 `conversation.input.left`，确认注册生效，再实际点一次看控制台有没有报错。

### 3.3 加进任何包都不需要动的东西

- React 从浏览器模块表来：client 里 `require('react')` 即可，**不要**装第二份 React。
- **禁止** `require('@deepseek-ai/dsh-client-ui-primitives')` 或任何其他 DSH client 包 —— 官方 practices 明确禁止；`dsh.client.inject` 里的包名只是激活顺序声明，不是 import 许可。
- 样式只用主题 token（`--dsw-alias-*` / `--dsw-specific-*`），不要写死颜色。
- 所有注册 `ctx.effect` / `ctx.on` 包起来并返回清理函数，否则 HMR 和卸载会漏。

### 3.4 Host 半边不要 import 任何 `@deepseek-ai/*`（实测结论）

这一点文档里没说清，但会直接决定插件能不能启动：

- profile 目录的 `node_modules` 里**只有插件自己**。`@deepseek-ai/*` 装在 dsh 安装目录，由 DSH 的加载器负责解析，普通 Node 解析规则够不着。
- 你 profile 里已经装了几个第三方插件（`dshmarket`、`dsh-whale-widget`、`dsh-skill-picker`，在 `%APPDATA%\<APP-DATA>\harness\profiles\desktop\node_modules\`），它们的 host 入口 **一个裸 import 都没有**，能力全走 `export const inject = [...]` + `ctx.xxx`。这是最可靠的形态证据。
- 所以：host 代码只 import **Node 内置模块 + 相对路径文件**。确实需要真 import 的包走**容错动态 import**：

```js
// 失败只降级，不能让插件整个起不来
void import('@deepseek-ai/dsh-tools')
  .then(({ defineTool }) => toolCtx.tools.register(defineTool({ /* ... */ })))
  .catch((error) => ctx.logger.warn(`tool not registered: ${error.message}`))
```

- **`export const Config` 不要导出 schemastery schema**（`z` 是裸 import）。所有配置键在代码里给默认值即可；`config` 本来就会原样传给你，schema 只影响校验和 `Config.listConfigs` 的文档。真想要 schema，就得接受那个 import 可能解析失败——先实测再决定。
- 命名空间用途的 `import type {}` 是类型擦除，不影响运行时；但纯 JS 插件没这一步。

`import type {}` 之外，**服务要用 `ctx.inject([...], cb)` 或 `ctx.get()` 拿，不要 import**。

`/` 菜单用的是「字面文本 = 引用」的模型：菜单 pick 和手输 `/name` 走同一个 token，所以不需要任何引用 codec。

---

## 4. 三种来源怎么建模

| 来源 | 落点 | 生效方式 | 说明 |
|---|---|---|---|
| **我自己的本地技能文件夹** | 插件 Config 的 `localDirs: string[]` | 插件自己的 provider 直接扫这些目录 | 和内置 `customSkillDirs` 语义一致，但**不用改 profile 配置**，改插件自己的 config 就行 |
| **GitHub 仓库** | 安装到 `$DSH_HOME/skills/<name>/` | 内置的文件系统 provider 会自动发现 | 关键：`$DSH_HOME/skills` 本来就在内置扫描根里（rank 400），而且**带 chokidar 监听**，落盘即生效，不用重载 |
| **精选清单 / 集市** | 一份 JSON/YAML 清单 + 同一套安装动作 | 同上 | 集市 = 清单 + 搜索 UI + 安装按钮；数据源和 GitHub 来源共用 |

**目录约定**（必须和内置 provider 对齐，否则扫不到）：

- 目录型技能：`<root>/<skill-name>/SKILL.md`
- 平铺型技能：`<root>/<skill-name>.md`
- frontmatter 必须含 `name` + `description`；可选 `whenToUse`、`disable-model-invocation`、`user-invocable`

```markdown
---
name: audit-report-review
description: 复核审计报告（财务报表 + 附注），发现勾稽异常
whenToUse: 当你拿到一份审计报告需要做一致性核对时
disable-model-invocation: false
user-invocable: true
---

正文……
```

> frontmatter 的字段名是**连字符**形式（`disable-model-invocation`），不是驼峰。`disableModelInvocation` 这种旧写法会被显式拒绝并告警。

**为什么落在 `$DSH_HOME/skills` 而不是插件自己的目录**：一来自动被发现 + 自动监听；二来用户卸载插件后技能还在，不会数据丢失；三来用户能用文本编辑器/资源管理器直接管理。插件只是"帮你把东西放对地方"。

---

## 5. 包结构

```
dsh-skill-market/                  ← 插件包根（一个包，两半）
├── package.json                   ← dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml               ← bundle 层：插入插件行
├── index.js                       ← Host 半边：provider + 集市服务 + 工具
├── lib/
│   ├── skill-file.js              ← frontmatter 解析（与内置 provider 对齐）
│   ├── provider.js                ← MySkillProvider（list/get/rank/invalidate）
│   ├── github.js                  ← GitHub tree/raw 拉取（含 token、pin ref）
│   └── marketplace.js             ← 清单搜索、安装、卸载、校验
├── client.js                      ← Client 半边：入口按钮
├── client.css.js                  ← 样式（可选，自绘面板才需要）
├── locale/{zh,en}.json            ← 插件卡片的标题/描述
├── icon.svg
└── README.md
```

`package.json` 要点：

```jsonc
{
  "name": "dsh-skill-market",
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
    }
  },
  "meta": { "title": "技能市场", "description": "本地/GitHub/精选清单技能来源与选择器" }
}
```

- `dsh.bundle.patch` 没有 → 装了只是普通依赖，不会进 profile 层。
- `dsh.client.platform` 必须是 `"web"`，且 `exports["./client"]` 必须真实存在。
- 不要开 `dsh.client.immediately`（那是启动关键路径才用的）。

`cordis.patch.yml`（**必须是顶层数组**）：

```yaml
- insert:
    - id: skill-market
      name: dsh-skill-market
      config:
        localDirs: []
        installRoot: ''      # 留空 = $DSH_HOME/skills
        rank: 350
```

生效顺序：profile bundles → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → 命令行 `--patch`。**后层按 `id` 覆盖前层，且 `config` 是整段替换不是深合并** —— 覆盖时要重述所有需要的键。

---

## 6. 关键实现

### 6.1 Host：provider（本包自带的最小实现）

见 `dsh-skill-market/index.js` 与 `lib/provider.js`。核心只有三件事：

1. `list()` 扫 `localDirs` + `installRoot`，解析每个 `SKILL.md` 的 frontmatter，产出 candidate；
2. `get()` 按 locator 重新读文件并校验 `name` 没变（变了要 `invalidate()`，注册表会重新发现）；
3. 文件变化时调 `control.invalidate()` 清缓存。

`list()` 失败要**隔离**：单个坏文件只是 warn + 跳过，整个 `list()` 不能抛 —— 抛了注册表会把这个 provider 整体跳过并标记观测不完整。

### 6.2 Host：GitHub 集市

```
GET https://api.github.com/repos/{owner}/{repo}/git/trees/{ref}?recursive=1
    → tree[].path 过滤出 **/SKILL.md        （只读元数据，不下载正文）
GET https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
    → 正文，落盘到 <installRoot>/<name>/SKILL.md
```

- **必须 pin `ref`**（commit sha 或 tag）。用 `main` 会随时间漂移，今天能用明天就变了。
- 私有仓库/限流：`Authorization: Bearer <token>`，token 从环境变量或 credentials 服务取，**不要写进配置文件**。
- 安装前校验：frontmatter 有 `name`+`description`，`name` 匹配 kebab-case 正则，目标目录不存在（**no-clobber**：已存在就报错，不覆盖用户的东西）。
- 卸载：只删自己装的，删之前校验目录里有 `SKILL.md` 且 name 对得上。

### 6.3 Client：入口按钮

见 `dsh-skill-market/client.js`。逻辑非常薄：

```js
const injected = (sessionId) => {
  const actx = sessions.scope(sessionId);
  if (actx === undefined) return { open: null, open$: null };
  const controller = inputTriggers.sessionOf(actx);
  return {
    open: () => controller.toggleSource('market-skill', {
      trigger: '/', query: '', quoted: false,
      position: 'leading',
      span: { start: 0, end: 0, draftRev: 0 },
    }),
    menu: controller.launcher,   // snapshot store：可用来做按钮的 aria-expanded
  };
};

ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
  name: 'conversation.input.left',
  id: 'skill-market',
  order: 10,
  locale: 'skillMarket',
  inject: injected,
}, SkillMarketButton));
```

按钮本身用 `role="button"` + `aria-haspopup="menu"` + `aria-expanded`，`focus-visible` 有描边，样式只用 token —— 抄宿主同类按钮的写法（可以参考 `dsh-client-ui-conversation` 里 WorkspaceChip 的 markup）。

### 6.4 选中之后发生什么

`onPick` 返回 `{ text: '/<name> ' }` → 草稿里出现字面量 `/name` → 用户按发送 → 宿主 pre-step 边界识别这个字面 token，把技能正文以 `<skill_content>` 注入该轮上下文。

**这是确定性的**：不依赖模型主动调 `skill` 工具。代价是这一轮无条件付技能正文的 token。

如果你希望点了就直接调起（而不是塞进草稿），那是另一条路（`ctx.remote.commands.execute()` 执行一个会话命令），属于 v2。

---

## 7. 本地开发与安装

```powershell
# 1. 起 watcher（client 半边改动才会自动重载）
#    官方方式是在源码 checkout 里跑 client 构建 watcher；纯手写 client.js 不需要构建
# 2. 装进当前 profile（当前 profile 名 = desktop，目标应用 = 你的桌面端发行版）
#    正式形态是「应用自有副本 + file:」，副本路径：
#      <Harness home>\plugins\dsh-skill-market
& '<APP>\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add `
  'file:$DSH_HOME/plugins/dsh-skill-market'
# 3. 确认层进去了：profile\package.json 两处登记 + node_modules 下是真实目录（22 个文件）
#    再确认 host 半边活着：模型能直接调 skill_market 工具（action: "local"）
```

- **权限**：profile 目录在 Harness home（AppData）下、在工作区之外，workspace-write 沙箱会直接报
  `EPERM ... package.json.lock`，安装要提权到 danger-full-access。
- **安装形态**：`add` 一个目录得到 `link:` 依赖（junction）；`file:` 则把文件硬链进 profile，
  成为真实目录、不再依赖被指向的目录。2026-10-09 起两处安装都用 `file:` + `<Harness home>\plugins\` 副本。
- **⚠️ 不要就地换形态**：在 `link:` 依赖存在时直接 `add file:`，pnpm 移除旧安装时会**沿 junction
  删掉链接目标的文件**（本机把工作区的 22 个源文件清空过一次）。先 `remove`，确认链接消失，再 `add`；
  删失效链接用非递归 `rmdir`。
- **⚠️ 客户端条目未激活 = 应用起不来**：桌面端发行版 0.3.2 把"客户端插件条目没激活"当致命错误
  （`web boot: 1 entry did not activate`）。2026-10-09 触发它的根因是 `client.js` 里
  `return function createManagePanel(...)` 这个多余的 `return` ——factory 返回了面板组件而不是插件对象，
  启动器把组件当插件 `new` 调用 → `cannot get property "t" without inject` → 整个应用拒绝启动。
  已修正并验证；`apply` 另加 try/catch 兜底，UI 注册失败只记日志、不再阻断启动。
  详见 [`docs/DEVNOTES.md`](./DEVNOTES.md) 的「客户端半边已修好」一节。
- **Host 代码改动**：HMR 会监测文件变化 → 但 **package.json / exports / 插件集合变化需要重启**；
  副本式安装另外还要先 robocopy 同步副本，并回读 profile 的 `package.json`
  （实测 `plugin add` 可能把 `dsh-skill-market` 从 `dsh.profile.bundles` 里重排掉）。
- **Client 代码（client.js）改动**：只有在 client 构建 watcher 运行时才自动重载；否则**刷新页面**。注意当前 Web shell 依赖 host 注入的 `window.__DSH_BOOT__`，不能起独立 Vite server 替代。
- 官方路径是 `plugin_manager` 的 `action: install_bundle`（GUI 的「插件」页面走同一个服务）。**不要手写 profile 文件、不要在 profile 目录手工跑 pnpm**。
  > 本会话没有暴露 `plugin_manager` 工具，用上面的 CLI 等价完成 —— 2026-10-09 在两套桌面端发行版上都已装成功
  > （旧版 Harness 的 home 是 `%USERPROFILE%\.dsh`），host 半边当场生效（无需重启）。
  > 注意 CLI 认 `DSH_HOME`：给旧版应用装必须显式指定它自己的 home。

---

## 8. 验证清单

装之前：

- [ ] `node --check index.js client.js lib/*.js` 全过
- [ ] `package.json` 能被 JSON 解析；`exports` 里每个路径都**真实存在**
- [ ] `cordis.patch.yml` 是顶层数组，`id` 唯一

装之后（**不要只看"装上了"，要看能不能用**）：

- [ ] `--dump-config` 里出现该行，且没有被更高层覆盖（`overridden` ≠ 生效）
- [ ] `ctx.skills.list()` 里能看到你放进去的技能（用 `cordis_inspect_query` 查 `skills` 服务）
- [ ] 在内置 `/` 菜单里能搜到并选中该技能 → 草稿出现 `/name`
- [ ] 点左下角「技能」按钮 → 菜单打开且只有本插件的分组 → Escape 关闭
- [ ] 往 `localDirs` 里丢一个新目录 → **不用重启**就能在菜单里搜到（验证 invalidate 生效）
- [ ] 从 GitHub 装一个技能 → `$DSH_HOME/skills/<name>/SKILL.md` 存在 → 菜单可见
- [ ] 重名场景：本地技能和 bundled 同名 → 确认赢的是你预期的那个（看 rank）
- [ ] 卸载插件 → 注册的 slot / source / provider 全部消失，无残留（HMR 安全）
- [ ] 明暗两种主题下按钮可读（只用 token 就不该出问题）

无法验证时的诚实表述：**安装成功 ≠ 用户能看到**。slot 注册本身不构成视觉验证。

---

## 9. GitHub 上的权威参考（按取证优先级）

1. **官方仓库**（公开、MIT）：
   [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
   先读根 `AGENTS.md`，再用 `packages/README.md` 的 group 表定位包。只读取证，别改。
   ```sh
   git clone --filter=blob:none https://github.com/deepseek-ai/deepseek-harness.git dsh-official
   ```
   注意：**GitHub 有 tag ≠ npm 已发布 ≠ 你这个版本有这个 API**。务必按你的实际版本（0.2.0-rc.2）核对。

2. **官方文档站**：[deepseek-harness.github.io](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/)

3. **社区插件开发 Skill**（写得比官方文档还细，覆盖 host/client 形态判断、bundle/profile 契约、slot 四步、构建、HMR、GitHub 安装、验证矩阵）：
   [zimodzh/dsh-plugin-dev-skills](https://github.com/zimodzh/dsh-plugin-dev-skills)
   以及 [NanmiCoder/dsh-agent-teams · dsh-plugin-development](https://github.com/NanmiCoder/dsh-agent-teams)

4. **⚠️ 第一方技能，就在你机器上**：DSH 自带 `cordis-plugin-development` 技能，含官方模板与 6 篇 reference：
   - `templates/decoration/{package.json, cordis.patch.yml, index.js, client.js}` ← 起步骨架
   - `references/host-plugin.md` ← bundle 清单、导出形态、Config、安装语义
   - `references/ui-plugin.md` ← client 清单、模块加载器、slot 注册
   - `references/practices.md` ← 扩展点选择、性能、UI 规则、**禁止 import DSH client 包**
   - `references/user-actions.md` ← 一个操作两个调用方（UI + 工具）
   - `references/verification.md` ← 没有浏览器控制时的验证边界
   - `references/mcp-bundle.md`
   它位于 `app.asar` 内，shell/glob/grep 都读不了（本方案里的文件是我用 asar 解包读出来的）。正经用法是让 agent 通过 `skill` 工具加载它。

5. 相关既有实现（读源码最快）：
   - `@deepseek-ai/dsh-skill` — 注册表与 provider 契约
   - `@deepseek-ai/dsh-skill-filesystem` — 本地 provider 的完整真实实现
   - `@deepseek-ai/dsh-client-ui-skill` — `/` 技能源的完整真实实现
   - `@deepseek-ai/dsh-client-ui-input-trigger` — 触发菜单流水线
   - `@deepseek-ai/dsh-plugin-manager` — 安装/卸载/启停的 Host 服务

---

## 10. 分阶段落地建议

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0** | 包骨架 + provider（只扫 `localDirs`） | `/` 菜单里能看到自己文件夹里的技能 |
| **P1** | Client 按钮（`conversation.input.left` + `toggleSource`） | 点击打开技能选择器；Escape 关闭 |
| **P2** | GitHub 来源（tree API + pin ref + 安装到 `$DSH_HOME/skills`） | 贴一个 repo 就能装，装完菜单可见 |
| **P3** | 精选清单 + 自绘集市面板（搜索/安装/卸载/从本地添加） | 对标截图那套 UI |
| **P4** | 把操作也暴露成 agent 工具（`skill_market`），UI 与工具共用同一个 Host 服务方法 | 工具调用与 UI 点击结果一致 |

P4 的依据是官方 `references/user-actions.md`：**一个操作只实现一次**（Host 服务方法），UI 通过 Host 入口调它，工具也调同一个方法。不要 UI 一套逻辑、工具另一套。

---

## 附：本方案产出的起步骨架

同目录下的 [`dsh-skill-market/`](dsh-skill-market/README.md) 是可直接安装的骨架：

| 已实现 | 文件 |
|---|---|
| Bundle 清单 + patch 层 | `package.json`、`cordis.patch.yml` |
| Host：provider（本地目录 + 安装目录，零依赖 frontmatter 解析） | `index.js`、`lib/provider.js`、`lib/skill-file.js` |
| Host：GitHub tree/raw 拉取与安装（pin ref、no-clobber、卸载守卫） | `lib/github.js`、`lib/marketplace.js` |
| Host：`skill_market` 工具 + `skillMarket` 服务（容错动态加载） | `index.js`、`lib/marketplace.js` |
| Client：触发源 + 左下角按钮 | `client.js` |
| 不需要 DSH 就能跑的行为测试 | `test/smoke.js`（10 项，全绿） |

尚未实现（P3/P4）：自绘集市面板（搜索框 + 安装按钮 + 从本地添加）、设置页「技能管理」页。

```sh
node dsh-skill-market/test/smoke.js      # 行为验证，不需要 DSH
```
