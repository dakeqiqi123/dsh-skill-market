window.__ModuleLoader__.load({
  id: 'dsh-skill-market',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * Client half of `dsh-skill-market`.
     *
     * Two surfaces, both riding host machinery instead of reimplementing it:
     *
     *  1. The composer menu. A skill source publishes what the registry can see,
     *     and two action rows sit under the list — "从本地添加技能" and "管理技能"
     *     — so the search box, keyboard handling and Escape all come from the
     *     host's own input-trigger menu.
     *  2. A management panel in the overlay slot: browse, search, filter, flip the
     *     two invocation flags, install from four sources, remove, and watch the
     *     list refresh itself.
     *
     * Everything the panel does travels through one session command
     * (`/skill-market …`), whose payloads are base64 because a command line holds
     * a single line. That keeps the host as the single implementation of every
     * mutation.
     *
     * A UI contribution must never block boot: the profile treats a client entry
     * that fails to activate as fatal, so the whole body below is wrapped and a
     * defect is reported instead of thrown.
     */

    /** Trigger character. `/` keeps this group beside the built-in skill group. */
    const TRIGGER = '/'
    /** Source name for the skill list, unique per (trigger, name) across the client. */
    const SOURCE = 'market-skill'
    /** Locale namespace registered below. */
    const NS = 'skillMarket'
    /** How long a fetched catalog may serve menu opens before it is re-read. */
    const CATALOG_TTL_MS = 3000
    /** How often the open panel re-reads the list. */
    const PANEL_POLL_MS = 2000
    /** How many skills the composer menu offers before deferring to the panel. */
    const MENU_LIMIT = 10

    /** Visible text. Both dictionaries carry the same keys. */
    const zh = {
      'button.label': '技能',
      'button.title': '选择技能',
      'menu.userOnly': '仅用户可调用',
      'menu.add': '从本地添加技能',
      'menu.addHint': '选择一个包含 SKILL.md 的文件夹',
      'menu.manage': '管理技能',
      'menu.manageHint': '浏览、搜索全部技能；双击即用',
      'panel.title': '技能管理',
      'panel.close': '关闭',
      'panel.search': '搜索名称、描述或标签',
      'panel.refresh': '刷新',
      'panel.filter.all': '全部',
      'panel.filter.installed': '本插件安装',
      'panel.filter.local': '本地目录',
      'panel.filter.other': '其他来源',
      'panel.filter.writable': '可修改',
      'panel.switch.user': '菜单可见',
      'panel.switch.userHint': '关闭后不在 / 菜单里出现',
      'panel.switch.model': '模型可用',
      'panel.switch.modelHint': '关闭后模型不能主动调用',
      'panel.remove': '卸载',
      'panel.removeHint': '删除本插件安装的技能目录',
      'panel.readonly': '只读',
      'panel.readonlyHint': '这个来源的技能不能被本插件修改或删除',
      'panel.loading': '正在读取技能…',
      'panel.empty': '没有匹配的技能',
      'panel.emptyQuery': '没有找到与「{query}」匹配的技能',
      'panel.emptyHint': '换个关键词或筛选条件试试',
      'panel.clearSearch': '清空搜索',
      'panel.error': '读取失败：{message}',
      'panel.foot': '共 {count} 个技能 · 已装 {installed} 个 · 安装目录 {root}',
      'panel.updated': '刚刚更新',
      'panel.useHint': '双击一行即可把该技能放进输入框',
      'panel.copied': '已复制 {token}，粘贴到输入框即可使用',
      'panel.installFolder': '从文件夹',
      'panel.installZip': '上传 zip',
      'panel.installText': '粘贴内容',
      'panel.installGitHub': '从 GitHub',
      'panel.pasteTitle': '粘贴 SKILL.md',
      'panel.pasteHint': '粘贴一份带 frontmatter（name、description）的完整技能文档',
      'panel.pastePlaceholder': '---\nname: my-skill\ndescription: 这个技能做什么\n---\n\n正文…',
      'panel.zipTitle': '上传技能压缩包',
      'panel.zipHint': '选择一个含 SKILL.md 的 zip（最大 8 MB）',
      'panel.repoTitle': '从 GitHub 安装',
      'panel.repoHint': 'owner/repo，可再填技能目录；留空则安装仓库里全部技能',
      'panel.repoPlaceholder': 'owner/repo',
      'panel.dirPlaceholder': '技能目录（可选）',
      'panel.submit': '安装',
      'panel.cancel': '取消',
      'panel.noSession': '还没有活动会话，先发一条消息再打开面板',
      'panel.noPicker': '这个环境不支持选择本地文件夹，请改用「上传 zip」或「粘贴内容」',
      'panel.busy': '正在处理…',
      'panel.installed': '已安装 {names}',
      'panel.skipped': '跳过 {count} 个（已存在或缺少必要字段）',
      'panel.failed': '失败 {count} 个',
      'picker.search': '搜索技能名称、描述或标签',
      'picker.emptyQuery': '没有找到与「{query}」匹配的技能',
      'picker.emptyHint': '换个关键词，或清空搜索框查看全部技能',
      'picker.clear': '清空',
      'picker.keys': '↑↓ 选择 · Enter 使用 · Esc 关闭',
      'picker.count': '共 {count} 个技能',
      'picker.clipboardFailed': '无法写入输入框，也无法访问剪贴板，请手动输入 {token}',
      'tag.installed': '本插件安装',
      'tag.readonly': '只读',
      'tag.userOnly': '仅用户可调用',
      'tag.menuOn': '菜单可见',
      'tag.menuOff': '菜单不可见',
      'tag.modelOn': '模型可用',
      'tag.modelOff': '模型不可用',
      'panel.rename': '改中文名',
      'panel.renameTitle': '修改技能名称',
      'panel.renameCurrent': '当前名称：{name}',
      'panel.renameLabel': '新名称（kebab-case）',
      'panel.renameHint': '显示名可以是中文，出现在面板、弹层与技能菜单里；调用用的技术名仍是 kebab-case。此前的名称会永久保留为曾用名，仍能搜到。',
      'panel.renameEmpty': '名称不能为空',
      'panel.renameSame': '这与当前名称相同',
      'panel.renameInvalid': '只能用小写字母、数字和连字符，例如 audit-report-review',
      'panel.renameTooLong': '名称最长 {max} 个字符',
      'panel.renameTaken': '「{name}」已经被另一个技能使用',
      'panel.renameAliasTaken': '「{name}」是另一个技能的曾用名，仍然为它保留',
      'panel.renameSave': '保存',
      'panel.renamed': '已更新为 {name}',
      'panel.displayLabel': '显示名（可用中文）',
      'panel.displayHint': '面板、弹层与技能菜单里显示的就是它；留空则显示技术名',
      'panel.displayTooLong': '显示名最长 {max} 个字符',
      'panel.displayInvalid': '显示名不能包含换行或控制字符',
      'panel.displayTaken': '「{name}」已经被另一个技能占用',
      'panel.techLabel': '技术名（kebab-case，用于调用）',
      'panel.techHint': '留空表示不改；`/名称` 调用令牌用的始终是技术名',
      'panel.identityNothing': '名称没有变化',
      'panel.formerName': '原名 {name}',
      'panel.formerNameMore': '原名 {name} +{count}',
      'panel.formerAll': '曾用名：{names}',
    }
    const en = {
      'button.label': 'Skills',
      'button.title': 'Choose a skill',
      'menu.userOnly': 'user-only',
      'menu.add': 'Add from this computer',
      'menu.addHint': 'Pick a folder containing SKILL.md',
      'menu.manage': 'Manage skills',
      'menu.manageHint': 'Browse and search every skill; double-click to use',
      'panel.title': 'Skills',
      'panel.close': 'Close',
      'panel.search': 'Search name, description or tag',
      'panel.refresh': 'Refresh',
      'panel.filter.all': 'All',
      'panel.filter.installed': 'Installed here',
      'panel.filter.local': 'Local folders',
      'panel.filter.other': 'Other sources',
      'panel.filter.writable': 'Editable',
      'panel.switch.user': 'In menu',
      'panel.switch.userHint': 'Hidden from the / menu when off',
      'panel.switch.model': 'Model can use',
      'panel.switch.modelHint': 'The model cannot call it when off',
      'panel.remove': 'Remove',
      'panel.removeHint': 'Delete a skill this plugin installed',
      'panel.readonly': 'read-only',
      'panel.readonlyHint': 'This source cannot be modified or removed here',
      'panel.loading': 'Reading skills…',
      'panel.empty': 'No matching skill',
      'panel.emptyQuery': 'No skill matches “{query}”',
      'panel.emptyHint': 'Try another keyword or filter',
      'panel.clearSearch': 'Clear search',
      'panel.error': 'Read failed: {message}',
      'panel.foot': '{count} skill(s) · {installed} installed here · install root {root}',
      'panel.updated': 'updated just now',
      'panel.useHint': 'Double-click a row to put that skill in the composer',
      'panel.copied': 'Copied {token} — paste it into the composer',
      'panel.installFolder': 'From folder',
      'panel.installZip': 'Upload zip',
      'panel.installText': 'Paste document',
      'panel.installGitHub': 'From GitHub',
      'panel.pasteTitle': 'Paste a SKILL.md',
      'panel.pasteHint': 'Paste a complete skill document with frontmatter (name, description)',
      'panel.pastePlaceholder': '---\nname: my-skill\ndescription: what this skill does\n---\n\nbody…',
      'panel.zipTitle': 'Upload a skill archive',
      'panel.zipHint': 'Pick a zip containing SKILL.md (8 MB max)',
      'panel.repoTitle': 'Install from GitHub',
      'panel.repoHint': 'owner/repo, optionally a skill directory; empty installs every skill in the repository',
      'panel.repoPlaceholder': 'owner/repo',
      'panel.dirPlaceholder': 'skill directory (optional)',
      'panel.submit': 'Install',
      'panel.cancel': 'Cancel',
      'panel.noSession': 'No active session yet — send a message first',
      'panel.noPicker': 'This environment cannot pick a local folder; use “Upload zip” or “Paste document”',
      'panel.busy': 'Working…',
      'panel.installed': 'installed {names}',
      'panel.skipped': 'skipped {count} (already present or missing fields)',
      'panel.failed': 'failed {count}',
      'picker.search': 'Search name, description or tag',
      'picker.emptyQuery': 'No skill matches “{query}”',
      'picker.emptyHint': 'Try another keyword, or clear the box to see every skill',
      'picker.clear': 'Clear',
      'picker.keys': '↑↓ move · Enter use · Esc close',
      'picker.count': '{count} skill(s)',
      'picker.clipboardFailed': 'Could not insert the skill, and the clipboard is unavailable — type {token} yourself',
      'tag.installed': 'installed here',
      'tag.readonly': 'read-only',
      'tag.userOnly': 'user-only',
      'tag.menuOn': 'in menu',
      'tag.menuOff': 'hidden from menu',
      'tag.modelOn': 'model can use',
      'tag.modelOff': 'model cannot use',
      'panel.rename': 'Rename',
      'panel.renameTitle': 'Change what this skill is called',
      'panel.renameCurrent': 'Current name: {name}',
      'panel.renameLabel': 'New name (kebab-case)',
      'panel.renameHint':
        'The display name may be any text, Chinese included, and is what the panel, the picker and the skill menu show. The technical name, in kebab-case, stays what the skill is called by. Previous names are kept and stay searchable.',
      'panel.renameEmpty': 'The name must not be empty',
      'panel.renameSame': 'That is already this skill’s name',
      'panel.renameInvalid': 'Use lower-case letters, digits and hyphens only, for example audit-report-review',
      'panel.renameTooLong': 'The name may be at most {max} characters',
      'panel.renameTaken': '“{name}” is already used by another skill',
      'panel.renameAliasTaken': '“{name}” is a name another skill carried before and is kept for it',
      'panel.renameSave': 'Save',
      'panel.renamed': 'updated to {name}',
      'panel.displayLabel': 'Display name (Chinese is fine)',
      'panel.displayHint': 'What the panel, the picker and the skill menu show; empty falls back to the technical name',
      'panel.displayTooLong': 'A display name may be at most {max} characters',
      'panel.displayInvalid': 'A display name must be one line without control characters',
      'panel.displayTaken': '“{name}” is already taken by another skill',
      'panel.techLabel': 'Technical name (kebab-case, used to call it)',
      'panel.techHint': 'Leave empty to keep it; the `/name` token always uses the technical name',
      'panel.identityNothing': 'Nothing changed',
      'panel.formerName': 'formerly {name}',
      'panel.formerNameMore': 'formerly {name} +{count}',
      'panel.formerAll': 'previous names: {names}',
    }

    /** Composer button styles. */
    const css = [
      '.dshSkillMarket_button{',
      'box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;',
      'height:28px;padding:0 8px;border:0;border-radius:var(--dsw-radius-md);',
      'background:0 0;color:var(--dsw-alias-label-tertiary);',
      'font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);',
      'line-height:20px;cursor:pointer;white-space:nowrap;',
      '}',
      '.dshSkillMarket_button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.dshSkillMarket_button[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.dshSkillMarket_button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
      '.dshSkillMarket_button:disabled{opacity:.5;cursor:default}',
      '.dshSkillMarket_glyph{display:grid;place-items:center;width:14px;height:14px;flex:none}',
    ].join('')

    const TAG_ID = 'dsh-skill-market/button.css'
    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(TAG_ID) + ']') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-skill-market'
      tag.dataset.pluginCss = TAG_ID
      tag.textContent = css
      document.head.appendChild(tag)
    }

    /** Management panel styles. */
    const PANEL_TAG_ID = 'dsh-skill-market/panel.css'
    const panelCss = [
      '.dshSkillPanel_scrim{position:fixed;inset:0;background:var(--dsw-alias-bg-mask,rgba(0,0,0,.35));display:flex;align-items:flex-start;justify-content:center;padding:48px 24px;z-index:1200}',
      // The panel paints its own opaque surface: it is the plugin's own card, not a
      // borrowed translucent menu material. Pinning the light colour tokens inside
      // this scope keeps text, icons and controls readable even when the rest of
      // the application runs a dark theme.
      '.dshSkillPanel_panel{--dsw-alias-label-primary:#1B1B1F;--dsw-alias-label-secondary:#4A4A52;--dsw-alias-label-tertiary:#85858F;--dsw-alias-label-inverse:#FFFFFF;--dsw-alias-border-l1:#E3E3E8;--dsw-alias-border-l2:#EDEDF0;--dsw-alias-interactive-bg-hover:#F2F2F5;--dsw-alias-bg-module-platform:#F7F7F9;--dsw-alias-state-error-primary:#C62828;--dsw-alias-state-business-primary:#2B6CF6;--dsw-specific-menu:#FFFFFF;box-sizing:border-box;display:flex;flex-direction:column;width:min(880px,100%);max-height:min(720px,100%);border-radius:var(--dsw-radius-lg);background:#FFFFFF;box-shadow:var(--dsw-elevation-prominent);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);overflow:hidden;font-family:var(--dsw-font-family)}',
      '.dshSkillPanel_head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:.5px solid var(--dsw-alias-border-l2);flex:none}',
      '.dshSkillPanel_title{font-size:15px;font-weight:600;line-height:22px;flex:none}',
      '.dshSkillPanel_search{flex:auto;min-width:120px}',
      '.dshSkillPanel_close{display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none}',
      '.dshSkillPanel_close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.dshSkillPanel_tools{display:flex;gap:8px;align-items:center;padding:10px 16px;border-bottom:.5px solid var(--dsw-alias-border-l2);flex:none;flex-wrap:wrap}',
      '.dshSkillPanel_chip{height:26px;padding:0 10px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.dshSkillPanel_chip[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshSkillPanel_input{box-sizing:border-box;width:100%;height:30px;padding:0 10px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px}',
      '.dshSkillPanel_area{box-sizing:border-box;width:100%;min-height:150px;padding:8px 10px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-mono,monospace);font-size:12px;line-height:18px;resize:vertical}',
      '.dshSkillPanel_input:focus-visible,.dshSkillPanel_area:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
      '.dshSkillPanel_btn{height:30px;padding:0 12px;border:0;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;cursor:pointer;flex:none;white-space:nowrap}',
      '.dshSkillPanel_btn:hover:not(:disabled){filter:brightness(1.08)}',
      '.dshSkillPanel_btn:disabled{opacity:.45;cursor:default}',
      '.dshSkillPanel_btnPrimary{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-inverse,var(--dsw-alias-label-primary))}',
      '.dshSkillPanel_btnDanger{color:var(--dsw-alias-state-error-primary);background:0 0}',
      '.dshSkillPanel_body{display:flex;flex-direction:column;gap:2px;padding:6px 8px 12px;overflow-y:auto;flex:auto}',
      '.dshSkillPanel_row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 8px;border-radius:var(--dsw-radius-md)}',
      '.dshSkillPanel_row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshSkillPanel_badge{display:grid;place-items:center;width:30px;height:30px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:600;flex:none}',
      '.dshSkillPanel_nameLine{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dshSkillPanel_name{font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshSkillPanel_desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshSkillPanel_tag{font-size:11px;line-height:16px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);flex:none;white-space:nowrap}',
      // The invocation token, kept visible beside a display name: `/name` is what a
      // person has to type, and it is deliberately not translated or hidden.
      '.dshSkillPanel_tech{font-family:var(--dsw-font-family-mono,monospace);color:var(--dsw-alias-label-secondary)}',
      '.dshSkillPanel_actions{display:flex;gap:10px;align-items:center;flex:none}',
      '.dshSkillPanel_switch{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
      '.dshSkillPanel_switch input{accent-color:var(--dsw-alias-state-business-primary);margin:0}',
      '.dshSkillPanel_foot{padding:10px 16px;border-top:.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);flex:none;display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap}',
      '.dshSkillPanel_err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;padding:8px 16px;flex:none;word-break:break-word}',
      '.dshSkillPanel_ok{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:8px 16px;flex:none;word-break:break-word}',
      '.dshSkillPanel_empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px}',
      '.dshSkillPanel_emptyTitle{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;word-break:break-word}',
      '.dshSkillPanel_emptyHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.dshSkillPanel_sub{border-bottom:.5px solid var(--dsw-alias-border-l2);padding:12px 16px;display:flex;flex-direction:column;gap:8px;flex:none}',
      '.dshSkillPanel_subTitle{font-size:13px;font-weight:500;line-height:20px}',
      '.dshSkillPanel_subHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.dshSkillPanel_subRow{display:flex;gap:8px;align-items:center}',
    ].join('')

    function ensurePanelStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(PANEL_TAG_ID) + ']') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-skill-market'
      tag.dataset.pluginCss = PANEL_TAG_ID
      tag.textContent = panelCss
      document.head.appendChild(tag)
    }

    /**
     * Picker styles.
     *
     * This popup paints its own opaque white surface with fixed colours instead of
     * theme tokens: it sits inside the composer over whatever the application theme
     * is showing, so the card stays white and its text stays dark in either theme.
     */
    const PICKER_TAG_ID = 'dsh-skill-market/picker.css'
    const pickerCss = [
      '.dshSkillPicker_popup{box-sizing:border-box;position:absolute;bottom:calc(100% + 4px);left:0;right:0;z-index:101;display:flex;flex-direction:column;max-height:400px;overflow:hidden;border:.5px solid #E3E3E8;border-radius:var(--dsw-radius-lg);background:#FFFFFF;box-shadow:var(--dsw-elevation-prominent);color:#1B1B1F;font-family:var(--dsw-font-family)}',
      '.dshSkillPicker_search{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:.5px solid #EDEDF0;flex:none}',
      '.dshSkillPicker_input{box-sizing:border-box;flex:auto;min-width:0;height:30px;padding:0 10px;border-radius:var(--dsw-radius-md);border:.5px solid #E3E3E8;background:#F7F7F9;color:#1B1B1F;font-family:inherit;font-size:13px}',
      '.dshSkillPicker_input::placeholder{color:#8A8A94}',
      '.dshSkillPicker_input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid #2B6CF6;outline-offset:-2px}',
      '.dshSkillPicker_clear{height:26px;padding:0 8px;border:0;border-radius:var(--dsw-radius-md);background:#F1F1F4;color:#4A4A52;font-family:inherit;font-size:12px;cursor:pointer;flex:none}',
      '.dshSkillPicker_clear:hover{background:#E7E7EC}',
      '.dshSkillPicker_viewport{display:flex;flex-direction:column;gap:2px;padding:6px;overflow-y:auto;flex:auto;min-height:0}',
      '.dshSkillPicker_row{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:6px 8px;border:0;border-radius:var(--dsw-radius-md);background:0 0;color:#1B1B1F;font-family:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
      '.dshSkillPicker_row:hover{background:#F7F7F9}',
      '.dshSkillPicker_row[aria-selected="true"]{background:#F1F1F4}',
      '.dshSkillPicker_row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid #2B6CF6;outline-offset:-2px}',
      '.dshSkillPicker_glyph{display:grid;place-items:center;width:14px;height:14px;flex:none;color:#8A8A94;font-size:12px}',
      '.dshSkillPicker_name{flex:none;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}',
      '.dshSkillPicker_tag{flex:none;padding:1px 6px;border-radius:999px;background:#F1F1F4;color:#6B6B75;font-size:11px;line-height:16px;white-space:nowrap;max-width:32%;overflow:hidden;text-overflow:ellipsis}',
      '.dshSkillPicker_tech{font-family:var(--dsw-font-family-mono,monospace);color:#4A4A52;background:#F7F7F9}',
      '.dshSkillPicker_desc{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:#8A8A94;font-size:12px;line-height:18px}',
      '.dshSkillPicker_empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:24px 16px;text-align:center}',
      '.dshSkillPicker_emptyTitle{color:#4A4A52;font-size:13px;line-height:20px;word-break:break-word}',
      '.dshSkillPicker_emptyHint{color:#8A8A94;font-size:12px;line-height:18px}',
      '.dshSkillPicker_note{color:#4A4A52;font-size:12px;line-height:18px;padding:4px 10px;flex:none;word-break:break-word}',
      '.dshSkillPicker_err{color:#C62828;font-size:12px;line-height:18px;padding:4px 10px;flex:none;word-break:break-word}',
      '.dshSkillPicker_foot{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border-top:.5px solid #EDEDF0;color:#8A8A94;font-size:11px;line-height:16px;flex:none}',
    ].join('')

    function ensurePickerStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(PICKER_TAG_ID) + ']') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-skill-market'
      tag.dataset.pluginCss = PICKER_TAG_ID
      tag.textContent = pickerCss
      document.head.appendChild(tag)
    }

    /**
     * Call one skill-market host route and unwrap its answer.
     *
     * The panel's traffic deliberately avoids the session-command channel: a
     * command result is echoed into the conversation, and the panel polls, so
     * that transport would fill the transcript with the plugin's own bookkeeping.
     * A route is invisible to the chat, needs no session, and answers every
     * failure as JSON the panel can show.
     *
     * @param action - route tail, e.g. `list`.
     * @param payload - JSON body, when the action takes one.
     * @returns the route's value.
     */
    async function callHost(action, payload) {
      const response = await fetch(`api/skill-market/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload ?? {}),
      })
      const text = await response.text()
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`${action} failed (HTTP ${String(response.status)})`)
      }
      if (response.ok !== true || parsed?.ok !== true) {
        throw new Error(
          typeof parsed?.error === 'string' && parsed.error !== ''
            ? parsed.error
            : `${action} failed (HTTP ${String(response.status)})`,
        )
      }
      return parsed.value
    }

    /** Ask the desktop (or the workspace service) for a local folder. */
    async function pickFolder(ctx, t) {
      const hook = globalThis.__DSH_DIRECTORY_PICKER__
      if (hook !== undefined && typeof hook.pick === 'function') {
        const picked = await hook.pick()
        return picked === null || picked === undefined ? undefined : picked
      }
      const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
      if (workspace !== undefined && typeof workspace.pickDirectory === 'function') {
        const picked = await workspace.pickDirectory()
        return picked === null || picked === undefined ? undefined : picked
      }
      throw new Error(t('panel.noPicker'))
    }

    /** Human-readable summary of one install report. */
    function describeInstall(t, payload) {
      const parts = []
      const names = (payload?.installed ?? []).map((entry) => entry.name).join(', ')
      if (names !== '') parts.push(t('panel.installed', { names }))
      if ((payload?.skipped ?? []).length > 0) parts.push(t('panel.skipped', { count: payload.skipped.length }))
      if ((payload?.failed ?? []).length > 0) parts.push(t('panel.failed', { count: payload.failed.length }))
      const detail = (payload?.skipped ?? [])[0]?.reason ?? (payload?.failed ?? [])[0]?.error
      return parts.length === 0 ? t('panel.updated') : `${parts.join(' · ')}${detail === undefined ? '' : ` — ${detail}`}`
    }

    /** First letter of a skill name, used as the row badge. */
    function initial(name) {
      return String(name ?? '?').slice(0, 1).toUpperCase()
    }

    /** Read one value out of a `{ getSnapshot, subscribe }` store. */
    function useStoreValue(store) {
      const [value, setValue] = React.useState(() => store.getSnapshot())
      React.useEffect(() => {
        setValue(store.getSnapshot())
        return store.subscribe(() => {
          setValue(store.getSnapshot())
        })
      }, [store])
      return value
    }

    /**
     * Every label a row already carries, as text a search may match: the source
     * chip, the installed and read-only chips, the two availability states, and the
     * names the skill carried before a rename. Some of these are drawn and some only
     * implied by a switch, so matching them makes "只读" or "菜单不可见" findable
     * without widening any row.
     *
     * @param t - translator bound to this plugin's namespace.
     * @param skill - one listing entry.
     * @returns the tag strings for that skill.
     */
    function skillTags(t, skill) {
      const tags = [String(skill.source ?? '')]
      if (skill.installed === true) tags.push(t('tag.installed'))
      if (skill.writable !== true || skill.path === undefined) tags.push(t('tag.readonly'))
      tags.push(skill.userInvocable === false ? t('tag.menuOff') : t('tag.menuOn'))
      tags.push(skill.modelInvocable === false ? t('tag.modelOff') : t('tag.modelOn'))
      if (skill.modelInvocable === false) tags.push(t('tag.userOnly'))
      // Previous names are searched exactly like the current one, which is what
      // keeps an old habit pointing at the same skill.
      for (const previous of skill.previousNames ?? []) tags.push(String(previous))
      return tags
    }

    /** One lower-cased haystack per skill: both names, the description and the tags. */
    function skillHaystack(t, skill) {
      return [
        String(skill.name ?? ''),
        String(skill.displayName ?? ''),
        String(skill.description ?? ''),
        ...skillTags(t, skill),
      ]
        .join(' ')
        .toLowerCase()
    }

    /**
     * Free-text filtering over name, description and tags.
     *
     * An empty query returns the input untouched, so every caller keeps its own
     * ordering: the picker its recency shortlist, the panel its chip-filtered list.
     *
     * @param t - translator bound to this plugin's namespace.
     * @param skills - listings to filter.
     * @param query - what the user typed.
     * @returns the matching subset, in the given order.
     */
    function filterSkills(t, skills, query) {
      const needle = String(query ?? '').trim().toLowerCase()
      if (needle === '') return skills
      return skills.filter((skill) => skillHaystack(t, skill).includes(needle))
    }

    /** Recency of one skill: the later of "last used" and "installed here". */
    const recency = (skill) => Math.max(skill.lastUsedAt ?? 0, skill.installedAt ?? 0)

    /** Skill-name rules, mirroring the host's own check in `lib/skill-file.js`. */
    const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    /** Longest name the host writes; the form refuses longer input before sending it. */
    const SKILL_NAME_MAX = 64
    /** Longest display name the host writes; it has to fit one menu row. */
    const DISPLAY_NAME_MAX = 40

    /**
     * Why a display name would be refused, or undefined when it is fine.
     *
     * Free text, Chinese included, but bounded and on one line, and it must not be a
     * name another skill already answers to — its technical name, its display name or
     * anything it carried before, because all of those are searchable.
     *
     * @param t - translator bound to this plugin's namespace.
     * @param options - `{ skills, path, value }`: the listing, the skill being renamed,
     *   and what the user typed.
     * @returns the reason to show, or undefined.
     */
    function displayProblem(t, { skills, path, value }) {
      const name = String(value ?? '').trim()
      if (name === '') return undefined
      if (name.length > DISPLAY_NAME_MAX) return t('panel.displayTooLong', { max: DISPLAY_NAME_MAX })
      if (/[\u0000-\u001f\u007f]/.test(name)) return t('panel.displayInvalid')
      for (const skill of skills) {
        if (skill.path !== undefined && skill.path === path) continue
        if (skill.name === name || skill.displayName === name || (skill.previousNames ?? []).includes(name)) {
          return t('panel.displayTaken', { name })
        }
      }
      return undefined
    }

    /** What a row calls a skill: its display name when it has one, else the technical name. */
    function skillLabel(skill) {
      return typeof skill.displayName === 'string' && skill.displayName !== '' ? skill.displayName : String(skill.name ?? '')
    }

    /**
     * Why a rename would be refused, or undefined when it is fine.
     *
     * This mirrors the host's rules so the form can answer without a round trip; the
     * host still decides, because it also sees skills this listing may not carry.
     *
     * @param t - translator bound to this plugin's namespace.
     * @param options - `{ skills, path, current, value }`: the listing, the skill
     *   being renamed, its current name, and what the user typed.
     * @returns the reason to show, or undefined.
     */
    function renameProblem(t, { skills, path, current, value }) {
      const name = String(value ?? '').trim()
      if (name === '') return t('panel.renameEmpty')
      if (name === current) return t('panel.renameSame')
      if (!SKILL_NAME_RE.test(name)) return t('panel.renameInvalid')
      if (name.length > SKILL_NAME_MAX) return t('panel.renameTooLong', { max: SKILL_NAME_MAX })
      for (const skill of skills) {
        if (skill.path !== undefined && skill.path === path) continue
        if (skill.name === name) return t('panel.renameTaken', { name })
        if ((skill.previousNames ?? []).includes(name)) return t('panel.renameAliasTaken', { name })
      }
      return undefined
    }

    /**
     * The chip a renamed skill wears, or undefined for a skill that never moved:
     * the name it carried first, plus how many more it has been through.
     */
    function formerNameChip(t, skill) {
      const previous = skill.previousNames ?? []
      if (previous.length === 0) return undefined
      const [first, ...rest] = previous
      return rest.length === 0
        ? t('panel.formerName', { name: first })
        : t('panel.formerNameMore', { name: first, count: rest.length })
    }

    /**
     * Per-session boolean flags with subscribers.
     *
     * The composer overlay renders once per mounted session, so the picker's state
     * has to be keyed by session: one shared flag would open it in every composer
     * at once.
     *
     * @returns the flag store: two readers and the subscribing hook.
     */
    function createSessionFlags() {
      const flags = new Map()
      const entryFor = (id) => {
        const key = typeof id === 'string' ? id : ''
        let entry = flags.get(key)
        if (entry === undefined) {
          entry = { open: false, listeners: new Set() }
          flags.set(key, entry)
        }
        return entry
      }
      return {
        isOpen: (id) => entryFor(id).open,
        set(id, next) {
          const entry = entryFor(id)
          if (entry.open === next) return
          entry.open = next
          for (const listener of entry.listeners) listener()
        },
        useOpen(id) {
          const [value, setValue] = React.useState(() => entryFor(id).open)
          React.useEffect(() => {
            const entry = entryFor(id)
            setValue(entry.open)
            const listener = () => setValue(entry.open)
            entry.listeners.add(listener)
            return () => {
              entry.listeners.delete(listener)
            }
          }, [id])
          return value
        },
      }
    }

    /** Give the keyboard back to the composer card the popup lives in. */
    function handBackFocus(root) {
      if (root === null || root === undefined || typeof root.closest !== 'function') return
      const card = root.closest('[data-composer-card]')
      const editor = card === null ? null : card.querySelector('[contenteditable="true"]')
      if (editor instanceof HTMLElement) editor.focus({ preventScroll: true })
    }

    /**
     * The skill source.
     *
     * `onPick` produces the literal `/<name> `, the same token a user would type:
     * the host's pre-step boundary recognises a leading `/<name>` in the submitted
     * message and injects the skill body, so selection is deterministic rather
     * than dependent on the model choosing to call the `skill` tool.
     *
     * @param ctx - client root context.
     * @param t - bound translator for this namespace.
     */
    function createSkillSource(ctx, t, actions) {
      const skills = ctx.remote.skills
      const sessions = ctx.sessions
      /** Per-session single-flight fetch plus the last good answer. */
      const state = new Map()

      const catalog = (session, force) => {
        const sessionId = session?.sessionId
        if (typeof sessionId !== 'string') return Promise.resolve([])
        const entry = state.get(sessionId) ?? { at: 0, skills: undefined, inflight: undefined }
        state.set(sessionId, entry)
        if (entry.inflight !== undefined) return entry.inflight
        if (!force && entry.skills !== undefined && Date.now() - entry.at < CATALOG_TTL_MS) {
          return Promise.resolve(entry.skills)
        }

        const abort = new AbortController()
        entry.inflight = (async () => {
          // The plugin's own listing is preferred because it also carries when a
          // skill was last used and when it arrived — the two orderings the menu
          // shortlist is built from. The registry is the fallback, so a host
          // without the command still shows a usable menu.
          try {
            const payload = await actions.listSkills()
            return payload.skills ?? []
          } catch (error) {
            console.warn('[skill-market] host listing unavailable, falling back to the registry:', error)
          }
          if (sessions.binding(sessionId) === undefined) {
            throw new Error(`skill catalog requires a retained session "${sessionId}"`)
          }
          return sessions.using(sessionId, { source: 'skillMarket', signal: abort.signal }, async (reference) => {
            abort.signal.throwIfAborted()
            const snapshot = reference.binding.session.getSnapshot()
            if (snapshot.openState !== 'open') {
              throw snapshot.openError ?? new Error(`session "${sessionId}" is not open`)
            }
            const result = await skills.list({ sessionId }, abort.signal)
            abort.signal.throwIfAborted()
            if (!result.ok) throw new Error(`skills/list failed: ${result.error.code}: ${result.error.message}`)
            return result.value.skills
          })
        })()
          .then((list) => {
            const visible = list.filter((skill) => skill.userInvocable !== false)
            entry.skills = visible
            entry.at = Date.now()
            console.info(`[skill-market] catalog refreshed: ${visible.length} skill(s)`)
            return visible
          })
          .catch((error) => {
            console.error('[skill-market] catalog load failed:', error)
            // Serve the last good answer rather than an empty menu: a failed
            // refresh must not look like "you have no skills".
            return entry.skills ?? []
          })
          .finally(() => {
            entry.inflight = undefined
          })
        return entry.inflight
      }

      return {
        trigger: TRIGGER,
        name: SOURCE,
        // After the built-in `command` (0) and `skill` (2) groups; the two action
        // rows below register higher still, so they sit at the bottom.
        order: 6,
        showGroupTitle: false,
        warm(session) {
          void catalog(session, true)
        },
        async candidates(session, { query, signal }) {
          // Always re-read: a catalog cached at page load keeps a freshly
          // installed skill invisible, which reads as "the plugin is broken".
          const list = await catalog(session, true)
          if (signal?.aborted === true) return []
          const needle = String(query ?? '').trim().toLowerCase()
          const rows = []
          if (needle === '') {
            // The default view is deliberately short: the skills this session is
            // most likely to want, most recent first. Everything else lives in
            // the management panel, which has its own search.
            const shortlist = [...list].sort((left, right) => recency(right) - recency(left)).slice(0, MENU_LIMIT)
            for (const skill of shortlist) rows.push(skillRow(skill))
            rows.push({ name: t('menu.add'), description: t('menu.addHint'), actionId: 'add' })
            rows.push({ name: t('menu.manage'), description: t('menu.manageHint'), actionId: 'manage' })
            return rows
          }
          // A query searches every skill — name, description and tags alike — so
          // the shortlist can never hide something the user is looking for.
          for (const skill of filterSkills(t, list, query)) rows.push(skillRow(skill))
          return rows

          function skillRow(skill) {
            // `label` is what the host menu shows and what its query matches, so a
            // skill with a Chinese display name is found and read in Chinese; the
            // pick still hands the technical name to the composer.
            const label = skillLabel(skill)
            return {
              name: skill.name,
              ...(label === skill.name ? {} : { label }),
              description:
                skill.modelInvocable === false ? `${t('menu.userOnly')} · ${skill.description}` : skill.description,
            }
          }
        },
        lexicon(session) {
          const entry = state.get(session?.sessionId)
          return entry?.skills?.map((skill) => skill.name)
        },
        onPick({ candidate }) {
          const actionId =
            candidate?.actionId ??
            (candidate?.name === t('menu.add') ? 'add' : candidate?.name === t('menu.manage') ? 'manage' : undefined)
          if (actionId === 'add') {
            void actions.onAdd()
            return { text: '' }
          }
          if (actionId === 'manage') {
            void actions.onManage()
            return { text: '' }
          }
          // Remember the choice: this is what keeps the shortlist useful.
          void actions.recordUse(candidate.name)
          return { text: `/${candidate.name} ` }
        },
      }
    }

    /**
     * The management panel.
     *
     * State lives in the component; every mutation goes through the host and is
     * followed by a refresh, so what the user sees is what the registry reports
     * rather than an optimistic local guess. A slow poll keeps the list live while
     * the panel is open — a skill installed elsewhere, or by the model, appears
     * without reopening.
     *
     * @param options - translator, visibility hooks, and the command wiring.
     * @returns the panel component.
     */
    function createManagePanel({ t, useOpen, onClose, wiring }) {
      const FILTERS = [
        ['all', 'panel.filter.all'],
        ['installed', 'panel.filter.installed'],
        ['local', 'panel.filter.local'],
        ['other', 'panel.filter.other'],
        ['writable', 'panel.filter.writable'],
      ]

      return function ManagePanel() {
        const open = useOpen()
        const [state, setState] = React.useState({ phase: 'idle', skills: [], installRoot: '', error: undefined })
        const [query, setQuery] = React.useState('')
        const [filter, setFilter] = React.useState('all')
        const [busy, setBusy] = React.useState(false)
        const [note, setNote] = React.useState(undefined)
        const [error, setError] = React.useState(undefined)
        const [sub, setSub] = React.useState(undefined)
        const [pasteText, setPasteText] = React.useState('')
        const [repoText, setRepoText] = React.useState('')
        const [dirText, setDirText] = React.useState('')
        const [updatedAt, setUpdatedAt] = React.useState(0)
        const [renameTarget, setRenameTarget] = React.useState(undefined)
        const [renameText, setRenameText] = React.useState('')
        const [displayText, setDisplayText] = React.useState('')

        const refresh = React.useCallback(async (options) => {
          if (options?.reveal === true) {
            setState((previous) => ({ ...previous, phase: previous.skills.length === 0 ? 'loading' : previous.phase }))
          }
          try {
            const payload = await callHost('list')
            setState({
              phase: 'ready',
              skills: payload.skills ?? [],
              installRoot: payload.installRoot ?? '',
              error: undefined,
            })
            setUpdatedAt(Date.now())
          } catch (cause) {
            setState((previous) => ({
              ...previous,
              phase: 'error',
              error: cause instanceof Error ? cause.message : String(cause),
            }))
          }
        }, [])

        React.useEffect(() => {
          if (!open) return undefined
          void refresh({ reveal: true })
          const timer = setInterval(() => {
            void refresh({ reveal: false })
          }, PANEL_POLL_MS)
          return () => clearInterval(timer)
        }, [open, refresh])

        React.useEffect(() => {
          if (!open) return undefined
          const onKey = (event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            if (sub !== undefined) setSub(undefined)
            else onClose()
          }
          window.addEventListener('keydown', onKey, true)
          return () => window.removeEventListener('keydown', onKey, true)
        }, [open, onClose, sub])

        if (!open) return null

        /** Run one mutating action with busy/error reporting and a refresh. */
        const perform = async (work) => {
          setBusy(true)
          setError(undefined)
          try {
            setNote(await work())
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            setBusy(false)
            await refresh({ reveal: false })
          }
        }

        const toggle = (skill, key, value) => {
          if (skill.path === undefined || skill.writable !== true) return
          const payload =
            key === 'userInvocable'
              ? { path: skill.path, userInvocable: value }
              : { path: skill.path, modelInvocable: value }
          void perform(async () => {
            await callHost('policy', payload)
            return undefined
          })
        }

        const removeSkill = (skill) =>
          perform(async () => {
            const result = await callHost('remove', { name: skill.name })
            return result?.removed === true ? t('panel.updated') : String(result?.reason ?? t('panel.updated'))
          })

        /**
         * Change what a skill is called.
         *
         * Two names travel in one call: the display name (free text, usually
         * Chinese) and the technical name (kebab-case, the one `/name` resolves).
         * Only what actually changed is sent, so a display-only edit never touches
         * the invocation token.
         */
        const submitRename = () =>
          perform(async () => {
            const target = renameTarget
            if (target === undefined || target.path === undefined) return undefined
            const payload = { path: target.path }
            const technical = renameText.trim()
            if (technical !== '' && technical !== target.name) payload.name = technical
            const display = displayText.trim()
            if (display !== (target.displayName ?? '')) payload.displayName = display
            if (payload.name === undefined && payload.displayName === undefined) return t('panel.identityNothing')
            const result = await callHost('rename', payload)
            setSub(undefined)
            setRenameTarget(undefined)
            setRenameText('')
            setDisplayText('')
            return t('panel.renamed', { name: String(result?.displayName ?? result?.name ?? technical) })
          })

        /**
         * Use one skill from the panel: put `/<name> ` into the composer draft
         * through the host's own insertion channel, which is the same path a menu
         * pick takes. When that channel is unavailable — no composer bound yet —
         * the token is copied instead, so the gesture never fails silently.
         */
        const useSkill = async (skill) => {
          const token = `/${skill.name} `
          const actions = wiring.inputActions()
          if (
            actions !== undefined &&
            typeof actions.captureInsertion === 'function' &&
            typeof actions.insertText === 'function'
          ) {
            try {
              const span = actions.captureInsertion()
              if (actions.insertText(token, span) !== false) {
                void wiring.recordUse(skill.name)
                onClose()
                return
              }
            } catch (error) {
              console.warn('[skill-market] could not insert the skill token:', error)
            }
          }
          try {
            await navigator.clipboard.writeText(token)
            setNote(t('panel.copied', { token: token.trim() }))
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error))
          }
        }

        const installFolder = async () => {
          setError(undefined)
          let path
          try {
            path = await pickFolder(wiring.ctx, t)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
            return
          }
          if (path === undefined) return
          await perform(async () => describeInstall(t, await callHost('install-dir', { path })))
        }

        const installPaste = () =>
          perform(async () => {
            const result = describeInstall(t, await callHost('install-text', { text: pasteText }))
            setSub(undefined)
            setPasteText('')
            return result
          })

        const installRepo = () =>
          perform(async () => {
            const result = await callHost('install-repo', { repo: repoText.trim(), directory: dirText.trim() })
            setSub(undefined)
            setRepoText('')
            setDirText('')
            const names = (result?.installed ?? []).map((entry) => entry.name).join(', ')
            return names === '' ? t('panel.updated') : t('panel.installed', { names })
          })

        const installArchive = async (files) => {
          const file = files?.[0]
          if (file === undefined) return
          setBusy(true)
          setError(undefined)
          try {
            const buffer = await file.arrayBuffer()
            if (buffer.byteLength > 8 * 1024 * 1024) throw new Error('the archive is larger than 8 MB')
            const bytes = new Uint8Array(buffer)
            let binary = ''
            const chunk = 32768
            for (let offset = 0; offset < bytes.length; offset += chunk) {
              binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
            }
            setNote(describeInstall(t, await callHost('install-zip', { data: btoa(binary), name: file.name })))
            setSub(undefined)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            setBusy(false)
            await refresh({ reveal: false })
          }
        }

        // Chips first, free text second: one pass for the filter, then the shared
        // haystack over name, description and tags, so both surfaces search alike.
        const byFilter = state.skills.filter((skill) => {
          if (filter === 'installed' && skill.installed !== true) return false
          if (filter === 'local' && !String(skill.source).includes('local')) return false
          if (filter === 'other' && (skill.installed === true || String(skill.source).includes('local'))) return false
          if (filter === 'writable' && skill.writable !== true) return false
          return true
        })
        const matches = filterSkills(t, byFilter, query)

        const installedCount = state.skills.filter((skill) => skill.installed === true).length

        const row = (skill) => {
          const editable = skill.writable === true && skill.path !== undefined
          const former = formerNameChip(t, skill)
          const previousNames = skill.previousNames ?? []
          const named = typeof skill.displayName === 'string' && skill.displayName !== ''
          return h(
            'div',
            {
              className: 'dshSkillPanel_row',
              key: `${skill.name}@${String(skill.path)}`,
              title:
                previousNames.length === 0
                  ? t('panel.useHint')
                  : `${t('panel.useHint')} · ${t('panel.formerAll', { names: previousNames.join(', ') })}`,
              onDoubleClick: () => void useSkill(skill),
            },
            h('div', { className: 'dshSkillPanel_badge' }, initial(skillLabel(skill))),
            h(
              'div',
              { style: { minWidth: 0 } },
              h(
                'div',
                { className: 'dshSkillPanel_nameLine' },
                h('span', { className: 'dshSkillPanel_name' }, skillLabel(skill)),
                // A display name hides the invocation token, so the row keeps showing
                // it: `/name` is what a person has to type.
                named
                  ? h('span', { className: 'dshSkillPanel_tag dshSkillPanel_tech', title: t('panel.techHint') }, `/${skill.name}`)
                  : null,
                h('span', { className: 'dshSkillPanel_tag' }, skill.source),
                skill.installed === true
                  ? h('span', { className: 'dshSkillPanel_tag' }, t('panel.filter.installed'))
                  : null,
                former === undefined
                  ? null
                  : h(
                      'span',
                      {
                        className: 'dshSkillPanel_tag',
                        title: t('panel.formerAll', { names: previousNames.join(', ') }),
                      },
                      former,
                    ),
              ),
              h('div', { className: 'dshSkillPanel_desc', title: skill.description }, skill.description),
            ),
            h(
              'div',
              { className: 'dshSkillPanel_actions' },
              editable
                ? h(
                    'label',
                    { className: 'dshSkillPanel_switch', title: t('panel.switch.userHint') },
                    h('input', {
                      type: 'checkbox',
                      checked: skill.userInvocable !== false,
                      disabled: busy,
                      onChange: (event) => toggle(skill, 'userInvocable', event.target.checked),
                    }),
                    t('panel.switch.user'),
                  )
                : null,
              editable
                ? h(
                    'label',
                    { className: 'dshSkillPanel_switch', title: t('panel.switch.modelHint') },
                    h('input', {
                      type: 'checkbox',
                      checked: skill.modelInvocable !== false,
                      disabled: busy,
                      onChange: (event) => toggle(skill, 'modelInvocable', event.target.checked),
                    }),
                    t('panel.switch.model'),
                  )
                : h('span', { className: 'dshSkillPanel_tag', title: t('panel.readonlyHint') }, t('panel.readonly')),
              editable
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshSkillPanel_btn',
                      disabled: busy,
                      title: t('panel.renameHint', { max: SKILL_NAME_MAX }),
                      onClick: () => {
                        setRenameTarget(skill)
                        setRenameText('')
                        setDisplayText(skill.displayName ?? '')
                        setSub('rename')
                      },
                    },
                    t('panel.rename'),
                  )
                : null,
              skill.installed === true
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshSkillPanel_btn dshSkillPanel_btnDanger',
                      disabled: busy,
                      title: t('panel.removeHint'),
                      onClick: () => void removeSkill(skill),
                    },
                    t('panel.remove'),
                  )
                : null,
            ),
          )
        }

        const subDialog = () => {
          if (sub === 'paste') {
            return h(
              'div',
              { className: 'dshSkillPanel_sub' },
              h('div', { className: 'dshSkillPanel_subTitle' }, t('panel.pasteTitle')),
              h('div', { className: 'dshSkillPanel_subHint' }, t('panel.pasteHint')),
              h('textarea', {
                className: 'dshSkillPanel_area',
                placeholder: t('panel.pastePlaceholder'),
                value: pasteText,
                onChange: (event) => setPasteText(event.target.value),
              }),
              h(
                'div',
                { className: 'dshSkillPanel_subRow' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshSkillPanel_btn dshSkillPanel_btnPrimary',
                    disabled: busy || pasteText.trim() === '',
                    onClick: () => void installPaste(),
                  },
                  t('panel.submit'),
                ),
                h('button', { type: 'button', className: 'dshSkillPanel_btn', onClick: () => setSub(undefined) }, t('panel.cancel')),
              ),
            )
          }
          if (sub === 'zip') {
            return h(
              'div',
              { className: 'dshSkillPanel_sub' },
              h('div', { className: 'dshSkillPanel_subTitle' }, t('panel.zipTitle')),
              h('div', { className: 'dshSkillPanel_subHint' }, t('panel.zipHint')),
              h('input', {
                type: 'file',
                accept: '.zip,application/zip',
                onChange: (event) => void installArchive(event.target.files),
              }),
              h(
                'div',
                { className: 'dshSkillPanel_subRow' },
                h('button', { type: 'button', className: 'dshSkillPanel_btn', onClick: () => setSub(undefined) }, t('panel.cancel')),
              ),
            )
          }
          if (sub === 'github') {
            return h(
              'div',
              { className: 'dshSkillPanel_sub' },
              h('div', { className: 'dshSkillPanel_subTitle' }, t('panel.repoTitle')),
              h('div', { className: 'dshSkillPanel_subHint' }, t('panel.repoHint')),
              h('input', {
                className: 'dshSkillPanel_input',
                placeholder: t('panel.repoPlaceholder'),
                value: repoText,
                onChange: (event) => setRepoText(event.target.value),
              }),
              h('input', {
                className: 'dshSkillPanel_input',
                placeholder: t('panel.dirPlaceholder'),
                value: dirText,
                onChange: (event) => setDirText(event.target.value),
              }),
              h(
                'div',
                { className: 'dshSkillPanel_subRow' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshSkillPanel_btn dshSkillPanel_btnPrimary',
                    disabled: busy || repoText.trim() === '',
                    onClick: () => void installRepo(),
                  },
                  t('panel.submit'),
                ),
                h('button', { type: 'button', className: 'dshSkillPanel_btn', onClick: () => setSub(undefined) }, t('panel.cancel')),
              ),
            )
          }
          if (sub === 'rename' && renameTarget !== undefined) {
            const technical = renameText.trim()
            const problem =
              technical === ''
                ? undefined
                : renameProblem(t, {
                    skills: state.skills,
                    path: renameTarget.path,
                    current: renameTarget.name,
                    value: technical,
                  })
            const display = displayText.trim()
            const displayIssue = displayProblem(t, {
              skills: state.skills,
              path: renameTarget.path,
              value: display,
            })
            const changed = (technical !== '' && technical !== renameTarget.name) || display !== (renameTarget.displayName ?? '')
            return h(
              'div',
              { className: 'dshSkillPanel_sub' },
              h('div', { className: 'dshSkillPanel_subTitle' }, t('panel.renameTitle')),
              h(
                'div',
                { className: 'dshSkillPanel_subHint' },
                t('panel.renameCurrent', {
                  name:
                    renameTarget.displayName === undefined
                      ? renameTarget.name
                      : `${renameTarget.displayName}（/${renameTarget.name}）`,
                }),
              ),
              h('div', { className: 'dshSkillPanel_subHint' }, t('panel.renameHint', { max: SKILL_NAME_MAX })),
              h('input', {
                className: 'dshSkillPanel_input',
                placeholder: t('panel.displayLabel'),
                'aria-label': t('panel.displayLabel'),
                value: displayText,
                onChange: (event) => setDisplayText(event.target.value),
              }),
              displayIssue === undefined
                ? h('div', { className: 'dshSkillPanel_subHint' }, t('panel.displayHint'))
                : h('div', { className: 'dshSkillPanel_err' }, displayIssue),
              h('input', {
                className: 'dshSkillPanel_input',
                placeholder: `${t('panel.techLabel')} — ${renameTarget.name}`,
                'aria-label': t('panel.techLabel'),
                value: renameText,
                onChange: (event) => setRenameText(event.target.value),
              }),
              problem === undefined
                ? h('div', { className: 'dshSkillPanel_subHint' }, t('panel.techHint'))
                : h('div', { className: 'dshSkillPanel_err' }, problem),
              h(
                'div',
                { className: 'dshSkillPanel_subRow' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshSkillPanel_btn dshSkillPanel_btnPrimary',
                    disabled: busy || displayIssue !== undefined || problem !== undefined || !changed,
                    onClick: () => void submitRename(),
                  },
                  t('panel.renameSave'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshSkillPanel_btn',
                    onClick: () => {
                      setSub(undefined)
                      setRenameTarget(undefined)
                      setRenameText('')
                      setDisplayText('')
                    },
                  },
                  t('panel.cancel'),
                ),
              ),
            )
          }
          return null
        }

        return h(
          'div',
          {
            className: 'dshSkillPanel_scrim',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) onClose()
            },
          },
          h(
            'div',
            { className: 'dshSkillPanel_panel' },
            h(
              'div',
              { className: 'dshSkillPanel_head' },
              h('div', { className: 'dshSkillPanel_title' }, t('panel.title')),
              h('input', {
                className: 'dshSkillPanel_input dshSkillPanel_search',
                placeholder: t('panel.search'),
                value: query,
                onChange: (event) => setQuery(event.target.value),
              }),
              h('button', { type: 'button', className: 'dshSkillPanel_btn', disabled: busy, onClick: () => void refresh({ reveal: true }) }, t('panel.refresh')),
              h('button', { type: 'button', className: 'dshSkillPanel_close', 'aria-label': t('panel.close'), onClick: onClose }, '✕'),
            ),
            h(
              'div',
              { className: 'dshSkillPanel_tools' },
              ...FILTERS.map(([id, key]) =>
                h(
                  'button',
                  {
                    key: id,
                    type: 'button',
                    className: 'dshSkillPanel_chip',
                    'aria-pressed': filter === id,
                    onClick: () => setFilter(id),
                  },
                  t(key),
                ),
              ),
              h('div', { style: { flex: 'auto' } }),
              h('button', { type: 'button', className: 'dshSkillPanel_btn', disabled: busy, onClick: () => void installFolder() }, t('panel.installFolder')),
              h('button', { type: 'button', className: 'dshSkillPanel_btn', disabled: busy, onClick: () => setSub('zip') }, t('panel.installZip')),
              h('button', { type: 'button', className: 'dshSkillPanel_btn', disabled: busy, onClick: () => setSub('paste') }, t('panel.installText')),
              h('button', { type: 'button', className: 'dshSkillPanel_btn', disabled: busy, onClick: () => setSub('github') }, t('panel.installGitHub')),
            ),
            subDialog(),
            error === undefined ? null : h('div', { className: 'dshSkillPanel_err' }, t('panel.error', { message: error })),
            note === undefined ? null : h('div', { className: 'dshSkillPanel_ok' }, note),
            state.phase === 'loading' && state.skills.length === 0
              ? h('div', { className: 'dshSkillPanel_empty' }, t('panel.loading'))
              : matches.length === 0
                ? h(
                    'div',
                    { className: 'dshSkillPanel_empty' },
                    h(
                      'div',
                      { className: 'dshSkillPanel_emptyTitle' },
                      query.trim() === '' ? t('panel.empty') : t('panel.emptyQuery', { query: query.trim() }),
                    ),
                    h('div', { className: 'dshSkillPanel_emptyHint' }, t('panel.emptyHint')),
                    query.trim() === '' || state.skills.length === 0
                      ? null
                      : h(
                          'button',
                          { type: 'button', className: 'dshSkillPanel_btn', onClick: () => setQuery('') },
                          t('panel.clearSearch'),
                        ),
                  )
                : h('div', { className: 'dshSkillPanel_body' }, ...matches.map(row)),
            h(
              'div',
              { className: 'dshSkillPanel_foot' },
              h('span', null, t('panel.foot', { count: state.skills.length, installed: installedCount, root: state.installRoot })),
              h('span', null, t('panel.useHint')),
              h('span', null, busy ? t('panel.busy') : updatedAt === 0 ? '' : t('panel.updated')),
            ),
          ),
        )
      }
    }

    /**
     * The picker: the plugin's own popup above the composer.
     *
     * The host's `/` menu still serves typed queries; this surface exists because
     * that menu cannot host a search box of ours, and because the plugin wants one
     * opaque card of its own. It reuses the panel's ordering, its tag-aware search
     * and its insertion path, so the two views cannot drift apart.
     *
     * @param options - translator and the shared wiring (catalog, use recording,
     *   the folder and manage actions).
     * @returns the picker component, fed per session by its overlay seat.
     */
    function createSkillPicker({ t, wiring }) {
      return function SkillPicker({ useOpen, onClose, inputActions, fallbackActions }) {
        const open = typeof useOpen === 'function' ? useOpen() : false
        const close = typeof onClose === 'function' ? onClose : () => {}
        const [skills, setSkills] = React.useState([])
        const [query, setQuery] = React.useState('')
        const [active, setActive] = React.useState(0)
        const [error, setError] = React.useState(undefined)
        const [note, setNote] = React.useState(undefined)
        const inputRef = React.useRef(null)
        const rootRef = React.useRef(null)

        // Re-read the catalog on every open: a skill installed a second ago has to
        // be visible here, and the listing is a local route.
        React.useEffect(() => {
          if (!open) return undefined
          let cancelled = false
          setQuery('')
          setActive(0)
          setError(undefined)
          setNote(undefined)
          void (async () => {
            try {
              const payload = await wiring.listSkills()
              if (!cancelled) setSkills(payload?.skills ?? [])
            } catch (cause) {
              if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
            }
          })()
          return () => {
            cancelled = true
          }
        }, [open])

        // Opening moves the keyboard into the search box; closing hands it back to
        // the composer, the way the menu it replaces does.
        React.useEffect(() => {
          if (!open) return undefined
          inputRef.current?.focus({ preventScroll: true })
          const root = rootRef.current
          return () => handBackFocus(root)
        }, [open])

        React.useEffect(() => {
          if (!open) return undefined
          const onKey = (event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            close()
          }
          const onPointerDown = (event) => {
            const root = rootRef.current
            if (root === null || !(event.target instanceof Node)) return
            if (root.contains(event.target)) return
            const card = root.closest('[data-composer-card]')
            if (card?.contains(event.target) === true) {
              // Going back to the editor gives the popup up, so a `/` typed there
              // opens the host's own menu alone.
              if (event.target instanceof Element && event.target.closest('[contenteditable="true"]') !== null) close()
              return
            }
            close()
          }
          window.addEventListener('keydown', onKey, true)
          document.addEventListener('pointerdown', onPointerDown, true)
          return () => {
            window.removeEventListener('keydown', onKey, true)
            document.removeEventListener('pointerdown', onPointerDown, true)
          }
        }, [open, close])

        if (!open) return null

        const needle = query.trim()
        // An empty query keeps the familiar view: most recent skills first, capped,
        // then the two action rows. A query searches every skill, so the shortlist
        // can never hide what someone is explicitly looking for.
        const listed =
          needle === ''
            ? [...skills].sort((left, right) => recency(right) - recency(left)).slice(0, MENU_LIMIT)
            : filterSkills(t, skills, needle)
        const rows =
          needle === ''
            ? [
                ...listed.map((skill) => ({ kind: 'skill', skill })),
                { kind: 'action', actionId: 'add', name: t('menu.add'), description: t('menu.addHint') },
                { kind: 'action', actionId: 'manage', name: t('menu.manage'), description: t('menu.manageHint') },
              ]
            : listed.map((skill) => ({ kind: 'skill', skill }))
        const activeIndex = rows.length === 0 ? -1 : Math.min(active, rows.length - 1)

        /** Same insertion path as the panel, with the same clipboard fallback. */
        const pick = (skill) => {
          const token = `/${skill.name} `
          const actions =
            inputActions ?? (typeof fallbackActions === 'function' ? fallbackActions() : undefined)
          if (actions !== undefined && typeof actions.insertText === 'function') {
            try {
              const span = actions.captureInsertion()
              if (actions.insertText(token, span) !== false) {
                void wiring.recordUse(skill.name)
                close()
                return
              }
            } catch (cause) {
              console.warn('[skill-market] could not insert the skill token:', cause)
            }
          }
          // Never fail silently: the token lands on the clipboard instead, and the
          // popup stays open with a note so the copy is not a surprise.
          if (navigator.clipboard === undefined) {
            setError(t('picker.clipboardFailed', { token: token.trim() }))
            return
          }
          void navigator.clipboard
            .writeText(token.trim())
            .then(() => setNote(t('panel.copied', { token: token.trim() })))
            .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
        }

        const runAction = (actionId) => {
          close()
          const started = actionId === 'add' ? wiring.onAdd() : wiring.onManage()
          void Promise.resolve(started).catch((cause) => {
            console.warn('[skill-market] picker action failed:', cause)
          })
        }

        const onInputKeyDown = (event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActive((value) => Math.min(Math.max(value + step, 0), Math.max(rows.length - 1, 0)))
            return
          }
          if (event.key !== 'Enter') return
          event.preventDefault()
          const row = activeIndex === -1 ? undefined : rows[activeIndex]
          if (row === undefined) return
          if (row.kind === 'skill') pick(row.skill)
          else runAction(row.actionId)
        }

        const clearQuery = () => {
          setQuery('')
          setActive(0)
          inputRef.current?.focus()
        }

        const rowNode = (row, index) => {
          const isSkill = row.kind === 'skill'
          const description = isSkill
            ? row.skill.modelInvocable === false
              ? `${t('menu.userOnly')} · ${row.skill.description}`
              : row.skill.description
            : row.description
          const former = isSkill ? formerNameChip(t, row.skill) : undefined
          const named = isSkill && typeof row.skill.displayName === 'string' && row.skill.displayName !== ''
          return h(
            'button',
            {
              key: isSkill ? `skill:${row.skill.name}@${String(row.skill.path)}` : `action:${row.actionId}`,
              type: 'button',
              role: 'option',
              'aria-selected': index === activeIndex,
              className: 'dshSkillPicker_row',
              onMouseMove: () => setActive(index),
              onMouseDown: (event) => {
                event.preventDefault()
                if (isSkill) pick(row.skill)
                else runAction(row.actionId)
              },
            },
            isSkill ? null : h('span', { className: 'dshSkillPicker_glyph', 'aria-hidden': 'true' }, '＋'),
            h('span', { className: 'dshSkillPicker_name' }, isSkill ? skillLabel(row.skill) : row.name),
            named
              ? h('span', { className: 'dshSkillPicker_tag dshSkillPicker_tech' }, `/${row.skill.name}`)
              : null,
            former === undefined
              ? null
              : h(
                  'span',
                  {
                    className: 'dshSkillPicker_tag',
                    title: t('panel.formerAll', { names: (row.skill.previousNames ?? []).join(', ') }),
                  },
                  former,
                ),
            h('span', { className: 'dshSkillPicker_desc', title: description }, description),
          )
        }

        return h(
          'div',
          { className: 'dshSkillPicker_popup', ref: rootRef, 'data-skill-market': 'picker' },
          h(
            'div',
            { className: 'dshSkillPicker_search' },
            h('input', {
              ref: inputRef,
              type: 'search',
              className: 'dshSkillPicker_input',
              placeholder: t('picker.search'),
              'aria-label': t('picker.search'),
              value: query,
              onChange: (event) => {
                setQuery(event.target.value)
                setActive(0)
              },
              onKeyDown: onInputKeyDown,
            }),
            needle === ''
              ? null
              : h('button', { type: 'button', className: 'dshSkillPicker_clear', onClick: clearQuery }, t('picker.clear')),
          ),
          error === undefined
            ? null
            : h('div', { className: 'dshSkillPicker_err' }, t('panel.error', { message: error })),
          note === undefined ? null : h('div', { className: 'dshSkillPicker_note' }, note),
          rows.length === 0
            ? h(
                'div',
                { className: 'dshSkillPicker_empty' },
                h('div', { className: 'dshSkillPicker_emptyTitle' }, t('picker.emptyQuery', { query: needle })),
                h('div', { className: 'dshSkillPicker_emptyHint' }, t('picker.emptyHint')),
                h('button', { type: 'button', className: 'dshSkillPicker_clear', onClick: clearQuery }, t('picker.clear')),
              )
            : h(
                'div',
                { className: 'dshSkillPicker_viewport', role: 'listbox', 'aria-label': t('picker.search') },
                ...rows.map(rowNode),
              ),
          h(
            'div',
            { className: 'dshSkillPicker_foot' },
            h('span', null, t('picker.keys')),
            h('span', null, t('picker.count', { count: needle === '' ? skills.length : rows.length })),
          ),
        )
      }
    }

    /** The composer button. */
    function SkillMarketButton({ open, menu, t, capture, inputActions, useOpen }) {
      React.useEffect(() => {
        if (typeof capture === 'function') capture(inputActions)
      }, [capture, inputActions])
      const launched = menu === undefined ? false : useStoreValue(menu) === SOURCE
      const pickerOpen = typeof useOpen === 'function' ? useOpen() : false
      const label = typeof t === 'function' ? t('button.label') : '技能'
      const title = typeof t === 'function' ? t('button.title') : '选择技能'
      const disabled = typeof open !== 'function'
      return h(
        'button',
        {
          type: 'button',
          className: 'dshSkillMarket_button',
          'aria-label': title,
          'aria-haspopup': 'menu',
          'aria-expanded': launched || pickerOpen ? 'true' : 'false',
          title,
          disabled,
          onClick: () => {
            if (!disabled) open()
          },
        },
        h(
          'span',
          { className: 'dshSkillMarket_glyph', 'aria-hidden': 'true' },
          h(
            'svg',
            {
              viewBox: '0 0 16 16',
              width: 14,
              height: 14,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.4,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            },
            h('path', { d: 'M8 2.2 3 6.4v6.2h3.2V9.4h3.6v3.2H13V6.4Z' }),
          ),
        ),
        h('span', null, label),
      )
    }

    return {
      // `remote.skills` and `remote.commands` are the generated namespaces the
      // built-in skill source also declares; `remote` alone does not guarantee
      // they exist.
      inject: ['slots', 'inputTriggers', 'sessions', 'remote', 'remote.skills', 'remote.commands', 'locale'],

      apply(ctx) {
        // A UI contribution must never block the application's boot: this profile
        // treats a client entry that fails to activate as fatal, so a defect here
        // would make the whole product unstartable.
        try {
          ensureStyles()
          ensurePanelStyles()
          ensurePickerStyles()
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skill-market: dictionaries')
          const t = ctx.locale.bind(NS)

          // Panel visibility lives here, because the menu rows and the overlay are
          // separate registrations that must share one state.
          const panel = { open: false, listeners: new Set() }
          const setPanelOpen = (next) => {
            if (panel.open === next) return
            panel.open = next
            for (const listener of panel.listeners) listener()
          }
          const usePanelOpen = () => {
            const [value, setValue] = React.useState(panel.open)
            React.useEffect(() => {
              const listener = () => setValue(panel.open)
              panel.listeners.add(listener)
              return () => {
                panel.listeners.delete(listener)
              }
            }, [])
            return value
          }

          // The picker is per session, because its seat in the composer overlay is:
          // one shared flag would open it in every mounted composer at once.
          const pickers = createSessionFlags()

          // One source owns the menu that a typed `/` opens: the skill rows, then
          // the two action rows at the bottom. The host renders exactly that one
          // source, so a second source could never appear beside it.
          const handleAddFromFolder = async () => {
            const path = await pickFolder(ctx, t)
            if (path === undefined) return
            const payload = await callHost('install-dir', { path })
            console.info('[skill-market] installed from folder:', payload)
            setPanelOpen(true)
          }
          const handleManage = async () => {
            setPanelOpen(true)
          }

          /** The host's own listing, which carries the recency the shortlist sorts on. */
          const listSkills = () => callHost('list')
          /** Remember one use so the skill stays in the menu's shortlist. */
          const recordUse = async (name) => {
            if (typeof name !== 'string' || name === '') return
            try {
              await callHost('touch', { name })
            } catch (error) {
              console.warn('[skill-market] could not record skill use:', error)
            }
          }

          // The composer's own insertion channel, captured from the session-scoped
          // slot props. It is what lets the panel and the picker put `/<skill> `
          // into the draft instead of asking the user to retype it. The panel uses
          // the last capture; the picker asks for the one of its own session.
          const inputActions = { value: undefined }
          const sessionActions = new Map()

          ctx.effect(
            () =>
              ctx.inputTriggers.registerSource(
                createSkillSource(ctx, t, {
                  onAdd: handleAddFromFolder,
                  onManage: handleManage,
                  listSkills,
                  recordUse,
                }),
              ),
            'skill-market: trigger source',
          )

          const ManagePanel = createManagePanel({
            t,
            useOpen: usePanelOpen,
            onClose: () => setPanelOpen(false),
            wiring: {
              ctx,
              inputActions: () => inputActions.value,
              recordUse,
            },
          })

          // The picker takes a seat in the composer's own overlay, so it opens
          // directly above the input — where the host menu it replaces used to be.
          const SkillPicker = createSkillPicker({
            t,
            wiring: {
              listSkills,
              recordUse,
              onAdd: handleAddFromFolder,
              onManage: handleManage,
            },
          })

          ctx.slots.inject('conversation.input.overlay', () =>
            ctx.slots.register(
              {
                name: 'conversation.input.overlay',
                id: 'skill-market.picker',
                order: 30,
                locale: NS,
                inject: (sessionId) => {
                  const key = typeof sessionId === 'string' ? sessionId : ''
                  return {
                    useOpen: () => pickers.useOpen(key),
                    onClose: () => pickers.set(key, false),
                    // The session kit hands the composer actions to session-scoped
                    // seats; the button also captures them, so either route works.
                    fallbackActions: () => sessionActions.get(key),
                  }
                },
              },
              SkillPicker,
            ),
          )

          // A panel is a global overlay, so it takes the overlay seat rather than
          // a composer slot.
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'skill-market.panel', order: 40, locale: NS }, ManagePanel),
          )

          ctx.slots.inject('conversation.input.left', () =>
            ctx.slots.register(
              {
                name: 'conversation.input.left',
                id: 'skill-market',
                order: 20,
                locale: NS,
                inject: (sessionId) => {
                  const actx = ctx.sessions.scope(sessionId)
                  if (actx === undefined) {
                    return { open: undefined, menu: undefined, t, capture: () => {}, useOpen: () => false }
                  }
                  const controller = ctx.inputTriggers.sessionOf(actx)
                  const key = typeof sessionId === 'string' ? sessionId : ''
                  return {
                    menu: controller.launcher,
                    useOpen: () => pickers.useOpen(key),
                    open: () => {
                      if (pickers.isOpen(key)) {
                        pickers.set(key, false)
                        return
                      }
                      // One popup at a time: whatever the host menu is showing for
                      // this composer gives way to the picker.
                      controller.dismiss()
                      pickers.set(key, true)
                    },
                    t,
                    // The host resolves session props for this slot; the button
                    // hands the input actions back so the overlays can use them too.
                    capture: (actions) => {
                      inputActions.value = actions
                      if (actions !== undefined) sessionActions.set(key, actions)
                    },
                  }
                },
              },
              SkillMarketButton,
            ),
          )

          console.info(
            '[skill-market] client half active: menu rows, picker, composer button and management panel registered',
          )
        } catch (error) {
          console.error('[skill-market] client half failed to activate; UI contributions are unavailable:', error)
        }
      },
    }
  },
})
