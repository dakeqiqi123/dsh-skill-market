# dsh-skill-market

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

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

- 搜索与键盘操作全部复用 Harness 自带菜单：上下键、Enter 选中、Escape 关闭。
- 默认只列出 **10 个**技能，排序取"最近使用 / 最新搭载"里较新的那个——技能多了菜单也不会失控。
- 在输入框里打字即搜**全部技能**，不会被这 10 个挡住。
- 底部两行固定动作：**从本地添加技能**（弹系统目录选择器）、**管理技能**。

**管理面板**

- 搜索 + 分类筛选：全部 / 本插件安装 / 本地目录 / 其他来源 / 可修改。
- 每行显示首字母徽标、名称、来源徽标、描述，以及两个开关：
  - **菜单可见** → `user-invocable`
  - **模型可用** → `disable-model-invocation`

  （与平台内置技能界面同一套语义，直接改写该技能 `SKILL.md` 的 frontmatter。）
- **双击任意一行即可使用**：技能以 `/<技能名> ` 的形式落进输入框光标处，面板自动关闭。
- 四种安装来源：**本地文件夹 / zip 压缩包 / 粘贴 SKILL.md / GitHub 仓库**。
- 列表每 2 秒自动重读，别处（或模型）装好的技能会自己出现。

**给模型的入口**

- `skill_market` 工具：`list` / `local` / `catalog` / `search` / `install` / `install-dir` / `install-text` / `policy` / `remove`。
- 会话命令 `/skill-market <list|install|add-dir|add-zip|add-text|policy|touch|remove>`，供手输与调试。

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

---

## 开发

```
index.js            插件入口：注册 skill provider、宿主路由、会话命令、agent 工具
lib/manage.js       技能管理核心：列举 / 开关 frontmatter / 目录·zip·粘贴安装 / 使用记录
lib/marketplace.js  集市操作：目录、搜索、GitHub 安装、卸载
lib/provider.js     技能来源 provider
lib/skill-file.js   SKILL.md 发现与 frontmatter 解析
lib/github.js       GitHub 目录与单文件拉取
lib/git-install.js  整目录安装
client.js           客户端半边：菜单来源 + 管理面板
cordis.patch.yml    本插件插入 profile 配置树的那一行
test/ tools/        测试与辅助脚本
```

三条约定（都很重要，改代码前先看）：

- **host 半边只 import Node 内置模块和相对路径文件**。profile 的 `node_modules` 里没有 `@deepseek-ai/*`，
  静态 import 它们会在插件激活前就失败；需要宿主能力时走 `inject` / `ctx.get()`，或容错动态 import。
- **客户端半边的 `apply` 整体包在 try/catch 里**：这类 profile 把"客户端条目激活失败"当致命错误，
  UI 出问题绝不该让整个应用起不来。
- **面板与菜单的内部流量走宿主 HTTP 路由**，不走会话命令——命令结果会被回显到对话里，而面板每 2 秒轮询一次。

检查：

```sh
node --check index.js && node --check client.js && node --check lib/*.js
node test/smoke.js              # 与前端无关的解析 / provider 用例
node test/panel-logic.js        # 面板纯逻辑
node test/marketplace-live.js   # 真连 GitHub（可选）
```

---

## 已知限制

- 客户端半边在 Harness 0.2.x 桌面端前端上验证过；跨大版本升级可能需要跟随 slot / 输入触发接口调整。
- 「从本地添加技能」依赖宿主提供目录选择器；没有桌面能力时会退化为"上传 zip / 粘贴内容"。
- 菜单默认 10 条是刻意的：更多请用管理面板的搜索。
- zip 解包只支持 stored 与 deflate 两种压缩方式（正常压缩包都是这两种）。

---

## License

MIT © 2026 dakeqiqi123。开发记录与验证矩阵见 [`docs/DEVNOTES.md`](docs/DEVNOTES.md)。
