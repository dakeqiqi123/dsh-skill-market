# dsh-skill-market

> **本文档已脱敏。** 占位符含义：`<APP>` = 桌面端安装目录；`<OLDAPP>` = 另一套 Harness 部署；
> `<APP-DATA>` = 应用数据目录（`%APPDATA%` 下）；`%USERPROFILE%` = 你的用户目录；
> `<WORKSPACE>` = 本仓库所在的开发目录；`<REPO>` = 本仓库目录；`$DSH_HOME` = Harness 数据目录。

给 DeepSeek Harness 加一个「技能」入口：在输入框菜单里直接选技能，并在同一处完成**技能管理**——
浏览、搜索、安装（本地文件夹 / 压缩包 / 粘贴文档 / GitHub）、开关调用权限、卸载。

设计取舍与 API 取证见下文各节。

---

## 它做了什么

**Host 半边**（`index.js` + `lib/manage.js`）

- 向 `ctx.skills` 注册一个 skill provider，覆盖配置里的本地目录 + 安装目录。
  注册之后，DSH **自带**的 `/` 技能菜单、`skill` 工具、system prompt 里的技能目录**全部自动生效**。
- `lib/manage.js` 是管理能力的唯一实现：
  - `list()` 以技能注册表为准（合并内置 / 项目 / 用户 / 本插件全部来源），并补齐
    `source`、`installed`、`writable` 与两个调用开关；
  - `setInvocation()` 直接改写 `SKILL.md` 的 frontmatter（`disable-model-invocation` /
    `user-invocable`），和平台内置技能界面用同一套语义，不另搞一份隐藏列表；
  - `installDirectory()` / `installArchive()` / `installText()` 分别处理**本地文件夹**、
    **zip**（`node:zlib` 自解，不依赖外部工具也不需要 npm 依赖）和**粘贴的 SKILL.md**；
  - 改名、越界写入、覆盖已存在技能都会被拒绝，并给出原因。
- 面板通过**宿主 HTTP 路由**（`api/skill-market/*`）调用这些操作，所以 UI 与 agent 工具
  `skill_market` 永远调同一份逻辑。
  > 为什么不是会话命令：命令结果会被回显到对话里，而面板每 2 秒轮询一次 —— 那会把插件自己的
  > 内部流量灌进聊天记录（旧版本就是这样，截图里那些 `> skill-market · …` 就是它）。
  > 路由对会话不可见，也不要求先有活动会话。会话命令 `/skill-market …` 保留给手输和调试。

**Client 半边**（`client.js`）

- 输入框左下角一个「技能」按钮，点开**插件自绘的弹层**（`dshSkillPicker_*`），浮在输入框正上方：
  顶部搜索框，按技能**名称 / 描述 / 标签**（来源、「本插件安装」、「只读」、「菜单可见 / 不可见」等）实时过滤。
  （早期版本复用宿主触发菜单；自绘是为了让搜索覆盖标签、并给空结果一个像样的空状态，见下文 2026-10-10 一节。）
- **弹层空查询时只列 10 个技能**：按「最近使用」与「安装时间」取较新者排序，取前 10，避免技能多了以后菜单失控。
  每次从菜单选用都会记一次使用（状态文件在 Harness home 的 `skill-market/usage.json`），所以常用的会稳定留在前面。
  一旦在顶部搜索框里输入，就在**全部技能**里找，不会被这 10 个挡住。
- 弹层底部两行固定动作（与 WorkBuddy 一致）：
  - **从本地添加技能** —— 直接弹系统目录选择器，选中含 `SKILL.md` 的文件夹即装；
  - **管理技能** —— 打开管理面板（全部技能都在这里，**双击任意一行即可使用**：技能直接落进输入框，面板自动关闭）。
- 在输入框里打 `/` 仍走**宿主自带**的触发菜单（`inputTriggers.registerSource`），行为不变。
- 管理面板：搜索 + 分类筛选（全部 / 本插件安装 / 本地目录 / 其他来源 / 可修改）、
  每行显示来源徽标与两个开关（**菜单可见** = `user-invocable`，**模型可用** = `disable-model-invocation`）、
  可卸载本插件安装的技能；还有「改中文名」、四个安装入口（从文件夹 / 上传 zip / 粘贴内容 / 从 GitHub）。
  搜索覆盖名称、显示名、曾用名、描述与标签。打开期间每 2 秒自动重读一次列表，别处（或模型）装好的技能会自己出现。
  双击走的是宿主自己的输入通道（把 `/<name> ` 插到光标处）；万一没有可用输入框，会退化为复制该 token 并提示。
- 弹层与面板都用**不透明纯白底**（`#FFFFFF`）并锁定浅色文字，深色主题下同样清晰。
- 整个 `apply` 有兜底：UI 半边再出任何错只写一条 console 错误，**不会阻断应用启动**。

选中技能后写入草稿的字面文本是 `/<skill-name> `，和手输完全一样：提交时宿主的 pre-step 边界识别这个 token 并注入技能正文，**不依赖模型主动调工具**。

### 验证状态

| 能力 | 状态 |
|---|---|
| 目录安装（含技能自带脚本）/ zip 安装 / 粘贴安装 / 重复不覆盖 | 已用真实文件跑通 |
| 双档开关改写 frontmatter、再读回；越界与非法来源拦截 | 已跑通 |
| 菜单结构：技能行 + 底部「从本地添加技能」「管理技能」两行 | 已在隔离宿主的前端里点开确认 |
| 面板：搜索/分类筛选、行内来源徽标与只读标记、底部统计 | 已确认渲染正确 |
| 双档开关点一下就改写 SKILL.md frontmatter（`user-invocable: false`），列表自动跟随 | 已确认落盘 |
| 粘贴 SKILL.md 安装、上传 zip 安装（走文件输入 → base64 → 宿主路由 → 宿主解包） | 已确认装好并出现在列表 |
| 面板与菜单的内部流量不出现在对话里（打开面板、轮询、记录使用都不产生回显） | 已确认 |
| 卸载本插件安装的技能；无目录选择能力的环境下「从文件夹」报错但不崩 | 已确认 |
| 面板打开期间每 2 秒自动重读列表（别处安装会自己出现） | 已确认 |
| 菜单只列 10 个：17 个技能时菜单正好 10 行 + 底部两行；选用后该技能在下次打开时排到最前 | 已在隔离宿主里确认 |
| 面板双击一行：技能落进输入框、面板自动关闭、使用记录写入 | 已确认 |
| 重命名：物理移动目录 + 改写 frontmatter、旧名进 `aliases`、校验拒绝非法/重名 | `test/rename.js` 全绿 |
| 显示名：只写 frontmatter 不动文件；不发布成条目（中文名进注册表会被拒） | `test/rename.js` 全绿 |
| 别名条目：旧技术名仍可调用，rank 900 不抢占真实技能 | `test/rename.js` 全绿 |
| 客户端三处 UI（弹层 / 面板 / 表单）在 React 替身下各渲染一次不抛错 | `test/client-render.js` 全绿 |
| 弹层与面板视觉（纯白底、空状态、显示名 + `/技术名` + 原名徽标） | 已用无头 Edge 渲染四个界面确认 |
| 面板视觉与交互手感 | 需你在应用里过一眼 |

---

## 安装

### 已经装好了（本机现状，2026-10-09 更新）

两处安装都用**应用自有的独立副本 + `file:` 依赖**，插件不再依赖工作区目录，工作区可以随便搬：

| | 小兢会计（当前在用） | 旧版 DeepSeek Harness |
|---|---|---|
| 应用 | `<APP>\小兢会计.exe` | `<OLDAPP>\DeepSeek Harness.exe` |
| Harness home | `$DSH_HOME` | `%USERPROFILE%\.dsh` |
| 插件副本 | `<Harness home>\plugins\dsh-skill-market` | `<Harness home>\plugins\dsh-skill-market` |
| 依赖登记 | `"dsh-skill-market": "file:$DSH_HOME/plugins/dsh-skill-market"` | `"dsh-skill-market": "file:%USERPROFILE%/.dsh/plugins/dsh-skill-market"` |
| bundle 登记 | `dsh.profile.bundles` 里有 `dsh-skill-market` | 同左 |
| 安装结果 | `<profile>\node_modules\dsh-skill-market` 是**真实目录**（文件硬链接自副本） | 同左 |

工作区里这份 `dsh-skill-market\` 是**开发源**，应用侧读的是各自的副本。

**改代码到生效的完整动作**（副本式安装不会自动跟随工作区）：

```powershell
# 1) 把改好的源码同步进副本（两个应用各有一份，按需要同步）
robocopy '<REPO>' `
         "$env:APPDATA\<APP-DATA>\harness\plugins\dsh-skill-market" /E /NFL /NDL /NJH /NJS /NP
# 2) 让 profile 重新导入（幂等；spec 不变时只是重新链接文件）
& '<APP>\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add `
  'file:$DSH_HOME/plugins/dsh-skill-market'
```

只改 `client.js` 时刷新页面即可；改 host 侧 `index.js` / `lib/*.js` 后要重启应用。

> #### ⚠️ 改安装形态的坑（本机踩过一次，务必避开）
>
> **不要**在已经装了 `link:` 依赖的 profile 上直接 `add` 成 `file:`。
> pnpm 会先移除旧的 `link:` 安装，而那次移除**沿着 junction 把链接目标目录里的文件一起删掉了**
> ——工作区里的 22 个源文件就是这样被清空的（回收站里没有，属于直接删除）。
> 正确顺序：先 `plugin --profile <名字> remove dsh-skill-market` 摘掉依赖，
> 确认 `node_modules` 下那条链接消失（失效链接用 `rmdir` 删，**不要**用递归删除），再 `add` 新形态。
> 换句话说：**junction 指向的目录不是"只是被引用"**，删链接永远用非递归方式。

### 标准安装路径（推荐，本机已用这条装成功）

应用自带的 CLI 就是官方入口，**不要**手写 profile 文件、不要在 profile 目录手工跑 pnpm：

```powershell
& '<APP>\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add '<REPO>'
```

它做的事和高版本时代的 `plugin_manager` 工具一致：写 profile 依赖、跑随附 pnpm、
把新 bundle 选进 `dsh.profile.bundles`。两条注意：

- **要给足文件权限**：profile 目录在 Harness home（AppData）下、在工作区之外，
  沙箱是 workspace-write 时会直接报 `EPERM ... package.json.lock`，需要提权（danger-full-access）才跑得动。
- 路径按**绝对路径**给；`add` 一个目录会得到 `link:` 依赖（junction），语义见上一节。

另一种等价做法是在小兢会计的「插件」页面里安装/启停——它走 host 内部 RPC，效果相同。

> 历史备注：旧版 DeepSeek Harness（home 在 `%USERPROFILE%\.dsh`）里，Electron 的
> `ELECTRON_RUN_AS_NODE` 模式不把 `lib/cli.js` 当 ESM 入口执行，`--profile desktop` 被拒，
> 只能手工跑 pnpm。**小兢会计这版没有这个问题**，CLI 直接可用。

### 装完怎么核对（三步，全部读写真实文件）

```powershell
$p = "$env:DSH_PROFILE_DIR"      # <Harness home>\profiles\desktop

# 1) 依赖与 bundle 登记都在
Select-String -Path "$p\package.json" -Pattern 'skill-market'

# 2) 装进去的是真实目录（副本式），文件数与副本一致
Get-Item "$p\node_modules\dsh-skill-market" | Select-Object Name,LinkType
(Get-ChildItem -Recurse -File "$p\node_modules\dsh-skill-market" | Measure-Object).Count   # 22

# 3) host 半边活着：模型能直接调 skill_market 工具（action: "local"）
```

host 半边装完**立刻生效**（profile 里启用了 HMR，无需重启）：插件注册的 `skill_market`
工具当场出现在会话工具表里，`action: "local"` 能读回真实的技能目录清单。

client 半边（输入框左下角的「技能」按钮）如果没出现，**刷新一次应用窗口**即可；
`index.js` / `lib/*.js` 改过则要重启应用（host 模块被 Loader 缓存）。

### 独立副本（为什么现在是这样装的）

工作区位于「临时专区」，一旦被搬走或清理，`link:` 式安装会让 profile 加载失败。
所以两个应用各自持有一份副本（`<Harness home>\plugins\dsh-skill-market`），依赖登记成 `file:`，
安装结果在 profile 里是**真实目录**（文件由 pnpm 硬链接自副本）：工作区怎么动都不影响应用。

代价：**改代码不再自动生效**，每次改完要按上一节的 robocopy + `add` 同步一遍；
反过来也意味着——插件不会再被工作区的文件操作意外波及。

### 客户端半边已修好（2026-10-09）

小兢会计 0.3.2 的启动是一道**硬门槛**：任何一个客户端插件条目没激活，整个应用起不来，
界面报 `web boot: 1 entry did not activate` + `<包名>: failed`，
并在 `%APPDATA%\<APP-DATA>\logs\crash-*-web-boot.log` 留一条。

**真因不是版本差异，而是 `client.js` 自己的结构缺陷**：面板工厂那一行原来写成
`return function createManagePanel(...)`，于是 **factory 返回的是面板组件本身**；
启动器把这个函数当插件 `new` 调用，拿上下文去解构 `t` →
`cannot get property "t" without inject` → 条目失败 → 应用拒绝启动。
（同一处还修掉了面板样式表用错变量：`tag.textContent = css` → `panelCss`。）

修好后客户端半边已在隔离宿主里**验证激活成功**（控制台：
`[skill-market] client half active: trigger sources, composer button and manage panel registered`），
两处安装都已恢复 `dsh.client` 声明。

**兜底**：`apply` 整体包了 try/catch —— 以后 UI 注册再出任何错，只在控制台记一条
`[skill-market] client half failed to activate …`，**不会再阻断应用启动**。

- **同步代码**：直接整目录 robocopy 即可（`package.json` 现在也带 `dsh.client`，不用再排除）。
- **`plugin add` 会重排装载列表**：本机实测它可能把 `dsh-skill-market` 从 `dsh.profile.bundles`
  里去掉，装完记得回读一遍 profile 的 `package.json`。
- **救急按钮的代价**：崩溃弹窗里的「禁用第三方插件、备份 profile patch 并重启」会把
  `dsh.profile.bundles` 削到只剩 base + web-app，并**把 profile 的 patch 层清空**
  （清空前留一份 `cordis.patch.yml.bak-*`）。用它进来之后，记得把插件列表和 patch 设置按备份恢复，
  否则默认模型、欢迎提示、浏览器开关这些设置会一起被重置。

### 改用其它形态

- 想要"边改边生效"（开发态）：在**先 `remove` 摘掉旧依赖之后**，用 `add 'link:<包目录>'`。
- 想彻底不依赖任何外部目录：把副本留在 `<Harness home>\plugins\` 里就行——现在就是这样。

### 生效边界

| 改了什么 | 怎么生效 |
|---|---|
| `client.js` | 有 client 构建 watcher 时自动重载；否则**刷新页面** |
| `index.js` / `lib/*.js` | **重启 DSH**。host 模块加载后由 Loader 缓存，改文件不会自动换掉已加载的 fiber |
| `package.json` / `exports` / 插件集合 | **重启 DSH** |
| 往技能目录里丢文件 | 立刻（provider 有 5 秒 TTL 缓存，卸载/安装走 `invalidate()` 立即生效） |

> 实测：装好之后往 `$DSH_HOME/skills` 放一个 `SKILL.md`，**当前会话的技能目录立刻就变了**，
> 不需要重启也不需要刷新。

---

## 依赖策略（重要，且本机实测过）

本插件的 host 代码**只 import Node 内置模块和相对路径文件**。

原因：模块解析从插件目录往上找，而 profile 的 `node_modules` 里**没有** `@deepseek-ai/*`；
那些包装在 dsh 安装目录，只有 DSH 自己的 Loader 能解析。
本机 profile 里已有的第三方插件（`dshmarket`、`dsh-whale-widget`、`dsh-skill-picker`）的
host 入口同样一个裸 import 都没有——只用 `ctx.inject`。

本机实测结果（从已安装位置做 `require.resolve`）：

| specifier | 结果 |
|---|---|
| `@deepseek-ai/dsh-tools` | **解析不到** |
| `@deepseek-ai/cordis` | **解析不到** |
| `@deepseek-ai/schemastery` | **解析不到** |
| `yaml` | **解析不到** |

所以：

- 能力一律通过 `inject` / `ctx.get()` 拿。
- **`skill_market` 工具用注册表的原生 definition 结构手写**，不再 import
  `@deepseek-ai/dsh-tools`。代价见下。
- `skillMarket` 服务仍然需要 `@deepseek-ai/cordis` 的 `Service` 基类，走容错动态加载，
  解析不到时打一条 info 就跳过；provider 和工具都不依赖它。
- `Config` 故意不导出 schemastery schema，所有键在代码里有默认值。
- **不要**试图用 junction 把 asar 里的包接到插件目录下——Windows junction 无法指向
  asar **内部**路径，建出来的链接是坏的（已踩过一次）。
- `yaml` 解析不到时走内置解析器。它的规则是：

  | 结构 | 处理 |
  |---|---|
  | 顶层 `key: value` | 读；引号剥掉、`true`/`false` 转布尔、`#` 注释去掉（引号内不算） |
  | 缩进的**嵌套块**（如 `metadata:` 下的字段） | 跳过。本项目不读它们，而顶层键不可能是缩进的，所以跳过是安全的 |
  | 块标量 `\|` / `>`（可带 `-`/`+` 和显式缩进） | **真正解析**。多行 `description` 在真实技能里就是这种写法，当成"无值"会把技能菜单要显示的文字丢掉 |

  两条都用真实仓库的文件验证过：
  - `NanmiCoder/dsh-agent-teams` 的 `dsh-plugin-development/SKILL.md` 带嵌套 `metadata` → name/description 正确；
  - `nigo81/nigo-skills` 的 `tianchuan-perspective/SKILL.md` 用 `description: |` 写五行描述 →
    五段全部保留（见"验证"一节）。

---

## 配置

在 profile 的 `cordis.patch.yml` 里按 `id: skill-market` 覆盖（**`config` 是整段替换，不是深合并**，要重述所有需要的键）：

```yaml
- id: skill-market
  name: dsh-skill-market
  config:
    localDirs:
      - 'D:\我的技能库'
      - '\\nas\team\skills'
    installRoot: ''            # 留空 = $DSH_HOME/skills
    rank: 350
    sources:
      - 'NanmiCoder/dsh-agent-teams'
      - 'zimodzh/dsh-plugin-dev-skills#master'   # 不写 #ref 就自动解析默认分支
    token: ''                  # 建议留空，改用 DSH_SKILL_MARKET_TOKEN 环境变量
    registerTool: true
```

> **最省事的加技能方式**：直接往 `$DSH_HOME\skills\` 丢 `<技能名>\SKILL.md`。
> 那是内置 provider 已经在**监听**的目录，不用重启就能用——`skill-market-self-check` 就是这么进去的。
> `localDirs` 适合你的技能已经存在别处、不想搬动的情况。

| 键 | 默认 | 说明 |
|---|---|---|
| `localDirs` | `[]` | 你自己的技能目录。每个目录按 `<dir>/<技能名>/SKILL.md` 或 `<dir>/<技能名>.md` 扫描 |
| `installRoot` | 空 | GitHub / 清单安装的落点。空 = `$DSH_HOME/skills`，也就是内置 provider 已经在扫并且**在监听**的目录 |
| `rank` | `350` | 本 provider 内部的优先级，越小越优先。本地目录按配置顺序递增，安装目录排最后 |
| `sources` | `[]` | 精选清单的 `owner/repo[#ref]` 列表。**ref 请 pin 到 commit sha 或 tag** |
| `token` | 空 | GitHub token。留空时读 `DSH_SKILL_MARKET_TOKEN`。**不要提交 token** |
| `registerTool` | `true` | 是否注册 `skill_market` 工具 |

### rank 的数字怎么选

内置 provider 的档位（同一层内比较）：`100` 项目 `.dsh/skills`、`200` 项目 `.agents/skills`、`300` custom、`400` `$DSH_HOME/skills`、`500` `~/.agents/skills`、`600` bundled。

默认 `350` 的含义：**你的本地目录能盖过 DSH 自带技能，但盖不过项目自带的技能**。如果你希望插件技能优先于项目技能，把它调到 `50` 以下。

---

## 使用

1. 点输入框左下角的「技能」按钮 → 菜单打开，只列出本插件能看到的技能。
   也可以直接输 `/`，本插件的分组会出现在内置技能分组之后。
2. 输入关键字过滤（按名字和描述匹配）。
3. ↑/↓ 移动，Enter 或 Tab 选中，Escape 关闭。
4. 草稿里出现 `/<技能名> ` → 发送 → 技能正文注入该轮上下文。

技能也可以直接手输 `/<技能名>`，不经过菜单——两条路径完全等价。

---

## 技能目录格式

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

规则（和内置 provider 严格一致）：

- `name` 必须是 **kebab-case**：`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`
- `description` 必填且非空
- frontmatter 字段用**连字符**写法；`disableModelInvocation` / `modelInvocable` 这类驼峰旧写法会被显式拒绝
- 缺 frontmatter、YAML 写坏、名字非法 → 该文件被跳过并记一条 warn，**不影响其他技能**

> 本插件的 frontmatter 解析优先用 `yaml` 包；在 profile 里解析不到时退回一个内置的解析器。
> 它的规则是：顶层 `key: value` 读；**缩进的嵌套块跳过**（本项目不读它们，而顶层键不可能是缩进的）；
> **块标量 `|` / `>` 真正解析**（多行 `description` 在真实技能里就是这种写法）。
> 两条都用真实仓库的文件验证过。

---

## 管理面板

在输入框打 `/`，菜单最下面有一行 **「管理技能」**，点开就是面板。面板里能做：

| 操作 | 说明 |
|---|---|
| 搜索 | 按技能名和描述过滤 |
| 刷新 | 重新读取列表 |
| 隐藏 / 取消隐藏 | 把技能从菜单和模型目录里拿掉。**不是删除**，用 `show` 可以随时恢复 |
| 卸载 | 删除**本插件安装的**技能目录。其他来源的按钮是禁用的（hover 有说明） |
| 从 GitHub 安装 | 填 `owner/repo`，可选填技能目录。留空装整个仓库里的全部技能 |

「隐藏」的语义是**发现过滤，不是权限**：隐藏后技能不再出现在菜单、面板和模型目录里，
但手输 `/技能名` 仍然能加载它。面板把它叫「隐藏」而不是「禁用」就是为了不说谎。

隐藏列表持久化在插件自己的配置里（`hidden` 键），写入走 `ctx.configEditor`——
它自己校验整个候选值、锁 profile manifest、原子写入、并让 Loader 重新加载该行。
如果那个服务不在（某些组合里没有），**改动仍然立即生效，但重启后失效**，
面板会明确显示 `(this session only)`。

---

## agent 工具 `skill_market`

| action | 参数 | 作用 |
|---|---|---|
| `list` | — | 面板用的完整列表（含 `previousNames`、`writable`、`installed` 标注） |
| `local` | — | 列出本地目录里已发现的技能和已安装的技能 |
| `catalog` | — | 列出 `sources` 里每个仓库当前的技能 |
| `search` | `query`、`spec?` | 在清单和一个临时仓库里搜技能 |
| `install` | `repo`、`path`、`ref?` | 把**单个** `SKILL.md` 装进 `installRoot` |
| `install-dir` | `directory` | 整目录安装（含 scripts / references） |
| `install-text` | `text` | 把粘贴的 `SKILL.md` 落盘 |
| `policy` | `path`、`modelInvocable?`、`userInvocable?` | 改写 frontmatter 里的两个调用开关 |
| `rename` | `path`、`newName` | 改名：移动目录/文件 + 写 `name`，原名进 `aliases` 永久保留 |
| `remove` | `skillName` | 删除**本插件装的**技能 |

## 会话命令 `/skill-market`

面板早期通过它读写 host，现在面板走 HTTP 路由，命令留给手输与调试：

| 命令 | 作用 |
|---|---|
| `/skill-market list` | 面板用的完整列表 |
| `/skill-market install <owner/repo> [目录 ...]` | 整目录安装；不给目录就装仓库里全部 |
| `/skill-market add-dir <绝对路径>` | 从本地文件夹安装 |
| `/skill-market add-zip <base64> [名称]` | 从 zip 安装（base64 单行传输） |
| `/skill-market add-text <base64>` | 粘贴的 SKILL.md 落盘 |
| `/skill-market policy <base64 json>` | 改写两个调用开关，如 `{"path":"…","userInvocable":false}` |
| `/skill-market rename <base64 json>` | 改名，如 `{"path":"…","name":"new-name"}` |
| `/skill-market touch <name>` | 记一次使用（菜单"最近使用"排序） |
| `/skill-market remove <name>` | 卸载本插件装的技能 |

> 为什么是命令而不是 HTTP 路由或 RPC：客户端可调用的**结构化** API 在 DSH 里来自
> 代码生成的 Remote 命名空间（`@Remote` + typert 产物），纯 JS 插件产不出来；
> 而命令的结果在离开 host 前会被规范化成 `{ kind, text }`，所以 JSON 走 `text` 字段，
> 客户端解析它。这条路径不需要密钥，也不新增端口。

---

## 工具脚本：整目录安装

`skill_market install` 只下一个 `SKILL.md`。**目录型技能不能这么装**——它还会带
`references/`、`scripts/`、模板，而技能正文里的相对路径引用全靠这些文件；
只装入口文件的话，技能读起来没问题，一执行 `scripts/…` 就崩。

用这个脚本装完整目录：

```sh
node tools/install-skill-dir.js <owner/repo[#ref]> <技能目录> [<技能目录> ...]

# 例：
node tools/install-skill-dir.js nigo81/nigo-skills audit-report-checker tianchuan-perspective
node tools/install-skill-dir.js owner/repo some-skill --dry-run     # 先看会写什么
node tools/install-skill-dir.js owner/repo some-skill --root D:\skills
```

行为：

- 不写 `#ref` 时**自动解析仓库真实默认分支**；
- 入口文件接受 `SKILL.md` 或 `skill.md`（有些仓库用小写）。是小写就**改写为 `SKILL.md`**——
  内置 provider 只发现这个文件名；
- frontmatter 经同一套策略解析器重新输出，远端文件无法夹带本项目不认识的字段；
- **先把整个目录下载完再落盘**，中途失败不会留下半个技能目录；
- 目标已存在就拒绝覆盖；
- 落盘后**回读** `SKILL.md` 并用真解析器验证，解析不回去就报错。

### 限流时的备用路径：`install-skill-dir-git.js`

上面那个脚本用 `api.github.com` 逐个列目录。**未认证的 REST 配额是每小时 60 次/IP，
列 13 个目录就耗掉 13 次**，配额用完后每个目录都会 403，而文件本身其实还能正常下载。

同一个功能的 git 版本完全不走 REST API：

```sh
node tools/install-skill-dir-git.js <owner/repo[#ref]> <目录> [...] [--root <dir>] [--dry-run] [--keep]
node tools/install-skill-dir-git.js nigo81/nigo-skills --list        # 列出仓库里的技能目录
```

- 一次 `git clone --depth 1 --filter=blob:none --no-checkout` + `sparse-checkout` 拿全部路径；
- ref 用 `git ls-remote --symref` 解析，不消耗配额；
- 同样的入口改写、frontmatter 重写、拒绝覆盖、回读验证；
- `--keep` 保留临时 clone 以便排查。

> 两个脚本暂时和 `lib/marketplace.js` 分开：需要它们的时候 host 代码还没重启加载。
> 下次改工具时应该把整目录安装并成 `MarketOperation` 的一个 `installDirectory` 方法
> ——而且要用 git 那条路，否则配额一满工具就废。

---

## 菜单里看不到刚装的技能？

**先刷新页面。** 客户端的技能目录是**按会话缓存**的，而且整个客户端
**没有任何地方订阅 `skills/change`**（只有 host 发这个事件）——
所以页面加载时读到的技能列表会一直用下去。装完技能不刷新页面，
菜单里就是旧列表。这不是插件坏了。

客户端的 `client.js` 已经改成**每次打开都重取目录**，所以刷新一次之后
就不会再有这个问题。

### 自己确认客户端到底加载没有

按 `Ctrl+Shift+I` 打开 DevTools，看 Console。插件会打印两行 info：

```
[skill-market] client half active: trigger source and composer button registered
[skill-market] catalog refreshed: 18 skill(s)
```

- **两行都在** → 客户端正常，菜单里的行数应该等于那个数字；
- **只有第一行、没有第二行** → 目录读取失败，下面会跟一条红色
  `[skill-market] catalog load failed:`，把那条发出来；
- **两行都没有** → 客户端 bundle 没加载/没激活，看有没有
  `slot entry crashed` 或其他红色报错。

### 为什么刷新可能还不够

如果 **host 侧**的代码改过（`index.js` / `lib/*.js`），host 模块被 Loader 缓存，
刷新页面不生效，**必须重启 DSH**。只改 `client.js` 时刷新页面就够。

---

## 技能的外部依赖

**技能装上了不等于能跑。** 很多技能带 Python 脚本，需要第三方包，而 DSH 自带运行时
只预装了 `numpy / pandas / python-docx / python-pptx / openpyxl / Pillow / lxml / XlsxWriter`。

用这个工具做**静态**清单：

```sh
node tools/check-skill-deps.js            # 扫描 $DSH_HOME/skills 下全部技能
node tools/check-skill-deps.js <目录>     # 只扫一个
node tools/check-skill-deps.js --json
```

它按 import 名映射到 PyPI 发行名（`docx -> python-docx`、`fitz -> PyMuPDF`、
`yaml -> pyyaml`、`bs4 -> beautifulsoup4` …），排除标准库、排除**技能自己的模块**
（脚本里 `import apply_manifest` 是同级文件，不是包），也排除运行时已预装的，
然后打印可直接执行的 pip 命令，并区分"轻量"与"重型"两组。

> **这个工具不做"装了没装"的判断，这是刻意的。** 那个判断用四种方式实现过又全部放弃：
> 在这台机器的受限 Windows 沙箱里，从 Node 派生的 python 子进程**能**把结果写进文件
> （单独手跑和 Node 派生都验证过），但由本工具驱动时就是拿不回可用答案，而且子进程的
> stderr 也拿不到用于诊断。与其发一个**有时会给出错误结论**的检查，不如只报"需要什么"——
> 那部分从文件推导，永远是对的。
>
> 想知道**实际装了什么**，用 python 自己的答案：
>
> ```sh
> "<DSH python>" -m pip list --format=freeze
> ```
>
> `<DSH python>` 就是上面工具打印的那个解释器路径
> （`%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`）。

装依赖是**写 DSH 运行时目录**，需要提权，而且重型包（`torch`/`transformers` 约 3GB、
`playwright` 还要额外下浏览器）值得你先决定。`local-rag` 自己的 `requirements.txt`
就把 torch/transformers 标为可选的离线重排器。

### 编码：这台机器上 python 技能的必修项

DSH 运行时 python 的 stdout 是 **GBK（cp936）**，而这些技能的脚本会往控制台打
`⚠️` 之类的字符 —— 一打就 `UnicodeEncodeError` 直接崩，而且崩在打日志那一步，
看起来像技能坏了。

实测（`flowchart-generator`）：

```
{ "error": "UnicodeEncodeError: 'gbk' codec can't encode character '\\u26a0'" }
```

设 `PYTHONUTF8=1` 之后同一个调用：

```
{ "ok": true, "bytes": 7020, "wrote": "…\\flowchart-test.drawio" }
```

**给这台机器设一次即可：**

```powershell
[Environment]::SetEnvironmentVariable('PYTHONUTF8', '1', 'User')
```

（新开的进程生效；改完需要重启 DSH。）

### 实测结论（2026-10-02）

| 项 | 结果 |
|---|---|
| 轻量组 10 个发行名 | 全部 PyPI 存在并安装成功（连带 31 个包） |
| `import` 实测 14 项 | 全通：`fitz` `pdfplumber` `json_repair` `openai` `bs4` `markdownify` `requests` `yaml` `rapidfuzz` `xlrd` `openpyxl` `pandas` `numpy` `docx` |
| 11 个技能 48 个 `.py` 文件 | 全部 `compile()` 通过，无语法错误 |
| `flowchart-generator` 真跑 | 设 `PYTHONUTF8=1` 后生成 7020 字节合法 `.drawio` |
| 仍缺 | `akshare`（`a-stock-financial` 查 A 股财报必需）、`playwright`（`cicpa-company-query` 全量导出）、`chromadb`/`chonkie`/`fastmcp`（`local-rag`）、`torch`/`transformers`（`local-rag` 可选重排器） |

> `cicpa_query` 从安装清单里去掉了：它在 PyPI 上**不存在**，是技能自己的模块
> （`cicpa-company-query/scripts/cicpa_query.py`）。留着它会让整条 pip 命令失败。

---

## 验证

```sh
# 不需要 DSH 就能跑的一部分
node test/smoke.js
```

它覆盖：技能名语法、frontmatter 拆分、标量解析（含嵌套块跳过、块标量 `|`/`>`）、
两种目录布局的发现、候选对象契约、正文加载、坏文件隔离、重名按 rank 裁决、
根目录不存在、来源 spec 解析。

装进 DSH 之后逐项确认（**"装上了"不等于"能用"**）：

- [x] 往安装目录放一个技能 → **当前会话的技能目录立刻出现它**，不用重启也不用刷新
- [x] 该技能能被加载，正文与资源基目录都正确（`Base directory: %USERPROFILE%\.dsh\skills\skill-market-self-check`）
- [x] provider 在活目录上发现候选：`skill-market-self-check [market-install rank=352]`
- [x] **`audit-report-checker`（18 文件）和 `tianchuan-perspective`（15 文件）整目录装好，
      当前会话的可用技能目录立刻出现两者，描述完整**（含五行块标量描述）
- [x] `skill_market` 工具出现在 agent 的工具列表里（说明原生 definition 注册成功）
- [x] GitHub 目录 / 搜索 / 安装 / 卸载全链路（`test/marketplace-live.js`，两个仓库）
- [ ] `skill_market { action: "local" }` 返回结果 —— 首次实测报了
      `content.some is not a function`（`render` 少了 content-block 包装），**已修**，待重启复验
- [ ] 在内置 `/` 菜单里能搜到并选中该技能 —— 需要你看一眼菜单
- [ ] 左下角「技能」点开插件弹层：顶部搜索框能实时过滤、行可点选、Escape 能关 —— 需要刷新页面后点一下

- [ ] 往 `localDirs` 丢一个新技能目录 → 不用重启就能搜到
- [ ] `skill_market { action: "install" }` 装一个 GitHub 技能 → `$DSH_HOME/skills/<name>/SKILL.md` 存在 → 菜单可见
- [ ] 同名技能同时存在时，赢的是你按 rank 预期的那一个
- [ ] 卸载插件后 slot / source / provider 全部消失，控制台无残留报错
- [ ] 明暗两套主题下按钮可读

> 已经装了一个自检技能 `skill-market-self-check` 在 `$DSH_HOME/skills/`。
> 它本身就是一个可用的验证入口：让 agent 加载它，它会报告当前生效的技能来源。

---

## 顶部搜索框与纯白底（2026-10-10）

需求：弹层顶部要有搜索框（按名称 / 描述 / 标签实时过滤，空查询保持原样，查不到给友好空状态），
并且插件的界面从不透明纯白（`#FFFFFF`）底色出发，字与图标保持对比度。

结论与做法：

- 截图里那个弹层是**宿主**的 `/` 触发菜单（`MenuSurface` 加一组哈希化的 CSS module 类名），插件只能往里塞行：
  顶部插不进输入框，底色也是全应用共享的材质。所以「技能」按钮改成打开**插件自绘弹层**
  （`conversation.input.overlay` 槽，与宿主菜单同一处锚点），输入框里手打 `/` 的菜单保持原样。
- 三处界面共用一套过滤：`skillTags()` 把行上本来带的语义拼成可搜文本——来源、`tag.installed`（本插件安装）、
  `tag.readonly`（只读）、`tag.menuOn` / `tag.menuOff`、`tag.modelOn` / `tag.modelOff`、`tag.userOnly`；
  `skillHaystack()` 再把名称与描述拼进去。`filterSkills()` 是唯一入口，空查询原样返回，因此弹层保住了
  "最近使用优先、取前 10"的排序，面板保住了筛选 chip，两边不会各搜一套。
- 纯白底与对比度：面板在 `.dshSkillPanel_panel` 作用域内**把浅色 token 钉死**
  （`--dsw-alias-label-*`、`--dsw-alias-border-l*`、`--dsw-alias-interactive-bg-hover`、
  `--dsw-alias-bg-module-platform`、两个 state 色），再 `background:#FFFFFF` 并去掉 `backdrop-filter`；
  弹层样式全部写死、不引用主题 token。两者在深色主题下同样是白底深字。
- 弹层交互：打开即聚焦搜索框（`preventScroll`），↑↓ 选择、Enter 使用、Esc 关闭；点击弹层之外或点回编辑器即关闭，
  关闭时把焦点交还 composer 的 `contenteditable`。选中走的是与面板同一条插入通道
  （`captureInsertion` + `insertText`），只有失败才退回剪贴板并在弹层里说明原因。
- 新增 `test/client-render.js`（并接进 CI）盯着这条链路，见「开发」一节。

---

## 技能重命名与中文显示名（2026-10-10）

需求（先后两条）：面板里能给技能改名，改名后**永久保留原名**（曾用名），列表同时显示当前名称与原名，
搜索按两者都能命中，旧名仍能找到该技能，改名要有校验，不能影响现有技能的调用与展示；
随后明确：**要能把技能名改成中文**。

结论与做法：

- **中文名不能写进 `name:`（平台硬限制）**。`@deepseek-ai/dsh-skill` 里
  `SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`，注册表在三处校验它：provider 返回的候选名（`validateCandidate`，
  非法名字会让**整个观测**被拒绝）、载入的定义名、`skills.get()` 的名字；内置 `dsh-skill-filesystem` 用同一套，
  并在文件解析阶段就把非法名忽略掉。所以中文 `name:` 的结果是技能从菜单、`skill` 工具与模型目录里消失。
  因此本插件把名称拆成两个：**技术名**（`name`，kebab-case，唯一能被调用的）与**显示名**（`display-name`，
  任意文字含中文，面板/弹层/`/` 菜单标签用它）。
- **改名是真的改名**（技术名）：技能身份由 `SKILL.md` 的 frontmatter `name` 决定，所以 `renameSkill` 同时移动目录
  （`<root>/<旧名>/SKILL.md` → `<root>/<新名>/SKILL.md`，平铺的 `<旧名>.md` 同理）并改写 frontmatter；
  文件不在标准位置（用户手工摆放）时只改 frontmatter，不搬文件。只给显示名时**不动文件、不动 `name`**。
- **记录写在技能自己身上，没有第二份存储**。frontmatter 多三个键：
  - `display-name`：当前显示名（可清空）；
  - `original-name`：首次改名时写入，此后永不修改（`rewriteNameAndAliases` 只在被要求时改写它，不会删除）；
  - `aliases`：交出去的名字（技术名与显示名混排），最旧在前，每次改名追加；唯一的"移除"是某个名字又变回
    当前名称时从列表里移出（它已经是当前名称，不能同时是自己的曾用名）。
  好处是记录跟着技能走、跟着 zip/目录复制走、卸载插件也不丢；代价是改名必须写文件，
  所以只对本插件可写的来源（安装目录 + `localDirs`）开放，内置/项目技能照旧只读。
- **旧的技术名仍可调用**：provider 在发现阶段把每个曾用名发布成**别名条目**（`aliasOf` 指向当前名称，
  `rank` 固定 900——比平台 rank 表里任何真实来源都差），`get()` 对别名条目返回**被问的那个名字**并附上同一份正文，
  因为注册表会核对"载入的定义是否带着候选的名字"（`dsh-skill` 的 `definition.name !== candidate.name` 检查）。
  rank 900 保证别名永远不会抢占同名真实技能。`aliasEntries: false` 可整体关掉这些条目，
  此时旧名只在插件自己的面板/弹层里可搜。别名条目在每个探索周期只发布一次，且跳过已被真实技能占用的名字。
  **显示名一律不发布**：用 `isSkillName(alias)` 过滤，否则一个中文条目就会让 provider 的观测被注册表拒绝。
- **列表不重复**：`manager.list()` 先读一份 provider 目录建索引（`readRenameIndex`：当前名 → 曾用名、曾用名 → 当前名、
  当前名 → 显示名），再按索引跳过别名行、把 `previousNames` 与 `displayName` 挂到真正的行上。因此面板/弹层永远一技能一行，
  而搜索（`skillHaystack` 把两个名字、描述、标签、曾用名并成一份 haystack）与详情（显示名 + `/技术名` 标签 + 「原名 X」徽标）
  都拿得到两边的信息。
- **显示名怎么露出**：面板与弹层直接画 `display-name`（`skillLabel()`），旁边固定保留 `/技术名` 标签；
  `/` 菜单那一组走宿主菜单的 `label` 字段（`item.label ?? item.name`，查询同时匹配 label），
  所以打 `/` 时中文名可见、可搜，选中后落进输入框的仍是 `/技术名 `（`onPick` 只认技术名）。
  模型的技能目录与 `skill` 工具按注册表的 `name` 呈现，插件改不了，这一点在 README 里写明了。
- **校验**：技术名——非空、kebab-case（`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`，与注册表一致）、`SKILL_NAME_MAX = 64`、
  不与自己相同、不与任何其他技能的名称/显示名/曾用名冲突；显示名——`DISPLAY_NAME_MAX = 40`、单行（拒绝控制字符）、
  同样不许与其他技能的名称/显示名/曾用名重复。前端 `renameProblem()` / `displayProblem()` 先判一遍，
  宿主 `renameSkill()` 再判一遍（还会检查目标是可写文件、目标路径不存在）。
- **使用记录跟着走**：技术名变化时 `usage.json` 的键从旧名迁到新名（取两者较大的时间戳），
  菜单的"最近使用"排序不会因改名丢失；只改显示名时不动使用记录。
- 兼容性：从未改名、也没设过显示名的技能**不带这些键**，与改动前完全一致；`name` / `description` / `whenToUse` / 正文 /
  已有策略键的行序都不动（`rewriteNameAndAliases` 只替换它认识的那几行，其余原样保留）。删除技能会一并带走记录。

涉及的文件：`lib/skill-file.js`（`parseNameList` / `previousNamesOf` / `rewriteNameAndAliases` / `topLevelKey`、
`DISPLAY_KEY` 与 `DISPLAY_NAME_MAX`、解析时读出三个键）、
`lib/manage.js`（`renameSkill` 同时处理两个名字 / `assertNameFree` / `relocate` / `writeAtomic` / `migrateUsage` /
`readRenameIndex`、list 合并别名行并附显示名）、`lib/provider.js`（别名条目 + 候选携带 `displayName`）、
`index.js`（路由 `rename`、命令 `rename`、工具动作 `rename` 的 `newName`/`displayName`、配置 `aliasEntries`）、
`client.js`（「改中文名」按钮与两栏表单、`displayProblem`、`skillLabel`、原名徽标、搜索覆盖两个名字与曾用名）。

---

## 已知限制

- **`skillMarket` 服务在本机不会发布**：它需要 `@deepseek-ai/cordis` 的 `Service` 基类，而该 specifier 在 profile 里解析不到（已实测）。插件会打一条 info 跳过，provider 和 `skill_market` 工具都不受影响。要让它生效，只能让 DSH 自己提供这个 specifier。
- **没有 `defineTool` 的参数校验**：工具用手写原生 definition，参数校验由 `normalizeAction` 自己兜（只校验 `action`，其余参数按需读取）。**另外 `render` 必须自己返回 content-block 数组**，宿主不会再包一层。`defineTool` 未来若可用，建议换回去。
- **`conversation.input.left` 是 list 槽**，同一个 `priority` 下 `id` 必须唯一。如果你还装了别的往这里放按钮的插件，不冲突；`priority` 相同会直接抛错。
- **按钮不再走 `toggleSource`（2026-10-10 起）**：左下角「技能」打开的是插件自绘弹层，宿主菜单只负责输入框里手打 `/` 的那条路。因此早先担心过的"合成 hit 导致选中行不生效"不再适用于按钮；弹层另有两条宿主 DOM 依赖，都很轻：位置取自 `.overlayAnchor`、点击外部与交还焦点用 `[data-composer-card]` 和其中的 `[contenteditable="true"]`，找不到时静默降级（只是不抢/不还焦点）。
- **同名技能在不同子目录里会被去重**：仓库同时发布 `.dsh/skills/<n>/` 和 `skills/<n>/` 时，
  目录里只留一个（按路径排序第一个），另一个会打一行 progress 说明。因为安装是按技能名落盘的，
  两个同名条目必然有一个装不上。
- **`skill_market install` 只装单个 `SKILL.md`**，只适合单文件技能。目录型技能必须用
  `tools/install-skill-dir.js`——否则 `references/`、`scripts/` 全丢，技能读起来没问题、
  一执行就崩。把整目录安装并进工具是下一步最该做的事。
- **不在仓库根目录的技能**：只收集路径深度 ≤ 6 段、且文件名恰为 `SKILL.md` 的文件。
  如果某个仓库的技能放在更深的位置，用 `owner/repo#ref` 配合 `path` 参数，或把该子目录单独列为一个仓库。
- **`installRoot` 必须是内置 provider 的扫描根之一**（默认 `$DSH_HOME/skills` 就是），否则装完要重启。
- **不写 `#ref` 时读的是仓库当前默认分支**，随上游变动而变动。`sources` 的默认值方便第一次试用，要可复现就 pin 到 commit sha 或 tag。
- **私有仓库**需要 `DSH_SKILL_MARKET_TOKEN` 或 `token` 配置。
- 目前**没有**自绘的集市面板（浏览 / 一键安装按钮）。集市能力已经通过 `skill_market` 工具可用，图形化面板属于下一阶段。
- 技能正文会随用户消息一起进入上下文，所以选中一个技能**必然**付它的 token 成本，这一点和使用 `skill` 工具相同。
- **安装方式是链接**：包一旦从 `<WORKSPACE>\` 移走或删除，profile 就会加载失败。要变成独立副本见"安装"一节的最后一段。

---

## 开发

```sh
node --check index.js client.js lib/*.js   # 语法
node test/smoke.js                          # 不需要网络：解析、发现、裁决
node test/rename.js                         # 不需要 Harness：重命名的全部行为
node test/client-render.js                  # 客户端半边：加载、激活、三处界面各渲染一次
node test/panel-logic.js                    # 不需要 Harness：面板读写的 host 侧逻辑
node test/marketplace-live.js               # 真连 GitHub，验证目录/搜索/安装/卸载全链路
node test/marketplace-live.js NanmiCoder/dsh-agent-teams   # 换一个仓库再跑
```

`test/rename.js` 在一份临时安装根上跑完改名的每条路径：目录布局与平铺布局的物理移动、frontmatter 四个键
（`name` / `display-name` / `original-name` / `aliases`）的写入与追加、只改显示名时不动文件、一次调用同时改两个名字、
重命名回原名时别名列表的变化、校验拒绝（空、非 kebab、中文技术名、超 64、超 40 的显示名、多行显示名、重名、
占用别人的显示名或曾用名、越权路径）、使用记录迁移，以及 provider 发布的别名条目
（`aliasOf` / rank 900 / `get()` 返回被问的名字 / **中文名绝不出现在候选名里**）与 `manager.list()` 不重复列行。

`test/client-render.js` 用一个几十行的 React 替身把 `client.js` 装进 Node：跑一遍 `apply()`，
确认三处界面都注册上、每个 `effect` 都返回了清理函数，然后把弹层与管理面板各渲染几遍
（空查询的短名单、按名称 / 描述 / 标签的查询、查不到时的空状态），断言渲染结果里的行与文案。
它守的是那条最贵的线：**客户端半边出问题会让整个应用起不来**。

`test/panel-logic.js` 覆盖面板真正依赖的四件事：list 载荷的形状与标注、
隐藏后 discovery 立刻少一个、取消隐藏后回来、整目录安装落盘并被 provider 发现。
最近一次运行：

```
ok  list returns skills  14 skills
ok  every entry has a name and description
ok  every entry is annotated
ok  entries come from the install root
ok  hiding removes it from discovery  13 skills
ok  unhiding restores it  14 skills
ok  install wrote the skill  transport=tree
ok  install reported no failures
ok  provider discovers the fresh install
panel logic checks passed
```

冒烟覆盖：技能名语法、frontmatter 拆分、标量解析（含跳过嵌套块与块标量）、两种目录布局、
候选契约、正文加载、坏文件隔离、重名按 rank 裁决、根目录不存在、来源 spec 解析。

联网覆盖（**已对两个真实仓库全绿**）：自动解析默认分支、目录列出并解析 frontmatter、
按名称/描述搜索、安装落盘并保留 frontmatter、provider 能发现装好的技能、
拒绝覆盖已存在的技能、拒绝删除不是自己装的技能、删除自己装的技能、错误信息可读。

> `test/marketplace-live.js` 的 `marketplace` 那条路走 **REST API**，
> **未认证配额是 60 次/小时/IP**，用光之后它必然失败（403），那是配额不是回归。
> 配额用光时用 `tools/install-skill-dir-git.js` 验证同一批能力——它走 git，不受配额影响。
> 想根治就给 `DSH_SKILL_MARKET_TOKEN` 设一个 token。

改动怎么生效：

- `client.js` → 构建 watcher 在跑就自动重载，否则**刷新页面**。
- `index.js` / `lib/*.js` → **重启 DSH**（host 模块被 Loader 缓存，改文件不会换掉已加载的 fiber）。
- `package.json` / `exports` / 插件集合 → **重启**。
- 因为是 junction 链接，**不用重装**；改完工作区里的文件重启即可。
- Client 半边**不要** `require` 任何 `@deepseek-ai/dsh-client-*` 包；只从浏览器模块表取 `react`。样式只用 `--dsw-alias-*` / `--dsw-specific-*` 主题 token。
