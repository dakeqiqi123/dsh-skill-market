# dsh-skill-market

[![CI](https://github.com/dakeqiqi123/dsh-skill-market/actions/workflows/ci.yml/badge.svg)](https://github.com/dakeqiqi123/dsh-skill-market/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.2.0-informational.svg)](https://github.com/dakeqiqi123/dsh-skill-market)

Skills for the DeepSeek Harness: a composer entry that **picks a skill**, and a management panel that
**installs, enables, organizes and removes** them.

一个把「选技能」和「管技能」放在同一处的 DSH 插件：输入框左下角一个「技能」按钮，点开就是搜索 + 技能列表；
再往下两行是 **从本地添加技能** 和 **管理技能**（浏览、搜索、双击即用、两档开关、四种安装来源）。

> 本插件属于 DeepSeek Harness 生态的第三方插件，不是官方项目。适配：Harness 0.2.x 桌面端（Web 前端）。
> 开发过程、验证矩阵与踩坑记录见 [`docs/DEVNOTES.md`](docs/DEVNOTES.md)；
> 立项时的设计笔记（扩展点取证与取舍）见 [`docs/DESIGN.md`](docs/DESIGN.md)。

---

## 功能

**技能菜单**（输入框左下角「技能」）

- 点击后在输入框正上方打开插件自己的弹层：**顶部搜索框**，按技能**名称、描述或标签**实时过滤。
- 标签就是每行本来带的那些语义：来源、「本插件安装」、「只读」、「菜单可见 / 不可见」、「模型可用 / 不可用」、「仅用户可调用」——搜「只读」「不可见」这类词也能命中。
- **输入为空时保持原样**：仍然只列 **10 个**技能，排序取"最近使用 / 最新搭载"里较新的那个，底部两行固定动作照旧。
- **没有匹配**时不是一片空白，而是回显关键词的空状态 + 提示 + 一键清空。
- 键盘：↑↓ 选择、Enter 使用、Esc 关闭；点一行即把 `/<技能名> ` 放进输入框。
- 在输入框里打 `/` 仍然走 Harness 自带菜单，行为不变。

**管理面板**

- 搜索 + 分类筛选：全部 / 本插件安装 / 本地目录 / 其他来源 / 可修改。
- 搜索同样覆盖**名称、描述和上面那组标签**，与筛选条件叠加生效。
- 无匹配时给出同样的友好空状态（回显关键词 + 一键清空）。
- 每行显示首字母徽标、名称（有显示名时显示它，并附 `/技术名` 标签）、来源徽标、描述，以及两个开关：
  - **菜单可见** → `user-invocable`
  - **模型可用** → `disable-model-invocation`

  （与平台内置技能界面同一套语义，直接改写该技能 `SKILL.md` 的 frontmatter。）
- **双击任意一行即可使用**：技能以 `/<技能名> ` 的形式落进输入框光标处，面板自动关闭。
- **可改中文名**：每行（可写来源）都有「改中文名」，表单里两栏——**显示名**（中文/任意文字，面板、弹层与 `/` 菜单显示的就是它）和**技术名**（kebab-case，`/名称` 调用令牌用的那个）。只改显示名时技术名与目录都不动。
- 有重命名记录的行会同时显示**原名**徽标（多个曾用名时显示 `原名 X +N`，悬停可看全部）；有显示名时行上还会保留 `/技术名` 标签，提醒调用令牌是什么。
- 搜索**同时命中显示名、技术名与所有曾用名**，弹层、面板、`/` 菜单与 `skill_market` 工具一致。
- 四种安装来源：**本地文件夹 / zip 压缩包 / 粘贴 SKILL.md / GitHub 仓库**。
- 列表每 2 秒自动重读，别处（或模型）装好的技能会自己出现。
- 弹层与面板都是**不透明纯白底**（`#FFFFFF`）并锁定浅色文字，深色主题下同样清晰。

**给模型的入口**

- `skill_market` 工具：`list` / `local` / `catalog` / `search` / `install` / `install-dir` / `install-text` / `policy` / `rename` / `remove`。
- 会话命令 `/skill-market <list|install|add-dir|add-zip|add-text|policy|rename|touch|remove>`，供手输与调试。

---

## 安装

要求：DSH 桌面端（Harness 0.2.x，Web 前端），Node 20+。

**用宿主自己的安装入口**（GUI 插件页安装，或命令行）：

```sh
dsh plugin --profile <your-profile> add /absolute/path/to/dsh-skill-market
```

装完重启应用即可。**不要**手写 profile 的 `package.json` 或 `cordis.patch.yml`，也不要在 profile 目录里手工跑 pnpm ——
上面这条命令会替你写依赖、跑包管理器、把新 bundle 选进 profile。

用本仓库源码安装时，profile 里的依赖是 `file:` 形式：**移动或删除源码目录会让 profile 加载失败**。
需要长期稳定的话，把包放到固定位置后再安装。

---

## 使用要点

**技能格式**：目录 `<技能名>/SKILL.md` 或单文件 `<技能名>.md`，frontmatter 至少要有
`name`（kebab-case）和 `description`。可选字段：

```yaml
---
name: my-skill
description: 这个技能做什么（显示在菜单里）
disable-model-invocation: true   # 可选：禁止模型主动调用
user-invocable: false            # 可选：不在用户菜单里出现
---
正文…
```

这两个可选字段就是面板里两个开关写回去的内容；都不写即两者都启用。

**安装落点**：默认 `$DSH_HOME/skills`——这也是内置文件系统 provider 已经在扫描并监听的目录，
所以装完立即生效、无需重启。使用历史记在 `$DSH_HOME/skill-market/usage.json`。

**zip 上传**：选一个包含 `SKILL.md` 的 zip（可带子目录、脚本、附件），单包上限 8 MB。

---

## 配置

配置由安装入口写进 profile 的 patch 层，可用键：

| 键 | 默认 | 说明 |
|---|---|---|
| `localDirs` | `[]` | 额外扫描的技能目录 |
| `installRoot` | 空 | 安装落点；空 = `$DSH_HOME/skills` |
| `rank` | `350` | 本 provider 在注册表里的优先级，越小越靠前 |
| `sources` | `[]` | 精选清单里的 `owner/repo[#ref]` 来源 |
| `token` | 空 | 访问私有仓库用的 GitHub token；建议改用环境变量 |
| `registerTool` | `true` | 是否注册 `skill_market` 工具 |
| `aliasEntries` | `true` | 是否把技能的曾用名也发布成可调用的条目；关掉后旧名仍可搜索，但不再能当技能调用 |

---

## 名称：显示名与技术名（数据结构调整）

**为什么不能直接把技能名改成中文**：平台的技能名是硬性语法。`@deepseek-ai/dsh-skill` 里
`SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`，注册表在**三处**校验它（provider 返回的候选名、载入的定义名、
`skills.get()` 的名字），内置文件系统 provider 也用同一套。中文写进 `name:` 的结果是：技能文件被 provider 忽略、
或整个 provider 的观测被拒绝 —— 技能会从菜单、`skill` 工具和模型目录里消失。

所以这个插件把两件事分开：

| | 技术名 `name` | 显示名 `display-name` |
|---|---|---|
| 取值 | kebab-case（小写字母/数字/连字符），≤ 64 | 任意文字，通常中文，≤ 40，单行 |
| 谁在用 | 注册表、`/名称` 调用令牌、`skill` 工具、模型目录 | 本插件的弹层、管理面板、以及 `/` 菜单里本插件那一组的标签 |
| 改动后果 | **真改名**：目录/文件与 frontmatter 一起移动，旧名进 `aliases` 并可继续被调用 | 只写 frontmatter，不动文件、不动调用 |

```yaml
---
name: audit-report-review        # 技术名：唯一能被调用的那个
display-name: 审计报告复核        # 显示名：面板、弹层里看到的就是它，也是 `/` 菜单本插件那组的标签
description: …
original-name: audit-review      # 首次改名时写入，此后永不修改
aliases: [audit-review, 报表复核] # 用过的、且不再是当前名称的名字（技术名与显示名混排），最旧在前
---
```

- **只增不删**：每次改名把交出去的名字追加进 `aliases`（技术名和显示名都算）；`original-name` 只写一次。
  唯一的"移除"是某个名字又变回当前名称时——它不能同时是自己的曾用名。
  没有第二个存储：记录写在技能自己身上，跟着技能走，卸载插件也不丢。
- **旧的技术名仍可调用**：provider 会把它们发布成**别名条目**（rank 900，比任何真实来源都差），
  所以 `/旧名` 依旧能注入同一个技能；同名真实技能永远优先，别名不会抢占别人的名字。
  设 `aliasEntries: false` 可整体关掉这些条目。
  **显示名永远不会被发布成条目**——它不是合法技能名，发布会连累整个 provider 的观测被注册表拒绝。
- **列表与搜索**：面板与弹层显示显示名（没有则显示技术名），旁边保留 `/技术名` 标签；有记录时附带「原名」徽标。
  搜索同时匹配显示名、技术名、描述、标签与全部曾用名；别名条目不会被重复列成两行。
- **校验**：技术名——非空、kebab-case、≤ 64、不能与任何其他技能的名称/显示名/曾用名冲突；
  显示名——≤ 40、单行、不能与其他技能的名称/显示名/曾用名重复。前端先判一次，宿主再判一次；
  只对本插件可写的来源（安装目录 / `localDirs`）生效。
- **"最近使用"**：技术名变化时 `usage.json` 的键会跟着迁移，菜单排序不受影响。
- **兼容性**：没改过名、也没设过显示名的技能**不带这些键**，行为与以前完全一致；`name`、`description`、
  `whenToUse`、正文、已有策略键的位置都不变。删除技能会把记录一起删掉（文件没了，别名也没有意义）。
- **模型侧**：模型的技能目录与 `description` 仍按技术名呈现，这是注册表的行为，插件无法改变；
  想让它看到中文，写在 `description` 里（本插件不改描述）。

---

## 开发

```
index.js            插件入口：注册 skill provider、宿主路由、会话命令、agent 工具
lib/manage.js       技能管理核心：列举 / 重命名 / 开关 frontmatter / 目录·zip·粘贴安装 / 使用记录
lib/marketplace.js  集市操作：目录、搜索、GitHub 安装、卸载
lib/provider.js     技能来源 provider（含曾用名条目）
lib/skill-file.js   SKILL.md 发现、frontmatter 解析与重命名记录
lib/github.js       GitHub 目录与单文件拉取
lib/git-install.js  整目录安装
client.js           客户端半边：菜单来源 + 自绘弹层 + 管理面板
cordis.patch.yml    本插件插入 profile 配置树的那一行
test/ tools/        测试与辅助脚本
```

三条约定（都很重要，改代码前先看）：

- **host 半边只 import Node 内置模块和相对路径文件**。profile 的 `node_modules` 里没有 `@deepseek-ai/*`，
  静态 import 它们会在插件激活前就失败；需要宿主能力时走 `inject` / `ctx.get()`，或容错动态 import。
- **客户端半边的 `apply` 整体包在 try/catch 里**：这类 profile 把"客户端条目激活失败"当致命错误，
  UI 出问题绝不该让整个应用起不来。`test/client-render.js` 用一个极小的 React 替身把三处 UI 各渲染一遍，
  专门盯这条线。
- **面板与菜单的内部流量走宿主 HTTP 路由**，不走会话命令——命令结果会被回显到对话里，而面板每 2 秒轮询一次。

检查：

```sh
node --check index.js && node --check client.js && node --check lib/*.js
node test/smoke.js              # 与前端无关的解析 / provider 用例
node test/rename.js             # 重命名：物理移动、记录、校验、使用记录迁移、别名条目
node test/client-render.js      # 客户端半边：加载、激活、三个界面各渲染一次
node test/panel-logic.js        # 面板纯逻辑
node test/marketplace-live.js   # 真连 GitHub（可选）
```

---

## 已知限制

- 客户端半边在 Harness 0.2.x 桌面端前端上验证过；跨大版本升级可能需要跟随 slot / 输入触发接口调整。
- 「从本地添加技能」依赖宿主提供目录选择器；没有桌面能力时会退化为"上传 zip / 粘贴内容"。
- 弹层空查询默认 10 条是刻意的：在弹层顶部的搜索框里输入即搜全部技能；`/` 菜单同理。
- zip 解包只支持 stored 与 deflate 两种压缩方式（正常压缩包都是这两种）。
- 重命名只改**本插件可写的**技能（安装目录与 `localDirs`）；内置/项目技能与平台其他来源一样保持只读。
- 曾用名条目会出现在 built-in `/` 菜单与模型技能目录里（描述前缀「曾用名 …」）；不要这份额外条目时用
  `aliasEntries: false` 关掉，旧名仍可在面板与弹层里搜到。

---

## License

MIT © 2026 dakeqiqi123。开发记录与验证矩阵见 [`docs/DEVNOTES.md`](docs/DEVNOTES.md)。
