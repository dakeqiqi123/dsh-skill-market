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
      'panel.search': '搜索技能',
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
      'panel.search': 'Search skills',
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
      '.dshSkillPanel_panel{box-sizing:border-box;display:flex;flex-direction:column;width:min(880px,100%);max-height:min(720px,100%);border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);overflow:hidden;font-family:var(--dsw-font-family)}',
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
      '.dshSkillPanel_actions{display:flex;gap:10px;align-items:center;flex:none}',
      '.dshSkillPanel_switch{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
      '.dshSkillPanel_switch input{accent-color:var(--dsw-alias-state-business-primary);margin:0}',
      '.dshSkillPanel_foot{padding:10px 16px;border-top:.5px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);flex:none;display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap}',
      '.dshSkillPanel_err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;padding:8px 16px;flex:none;word-break:break-word}',
      '.dshSkillPanel_ok{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:8px 16px;flex:none;word-break:break-word}',
      '.dshSkillPanel_empty{padding:32px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px}',
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

      /** Recency of one skill: the later of "last used" and "installed here". */
      const recency = (skill) => Math.max(skill.lastUsedAt ?? 0, skill.installedAt ?? 0)

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
          // A query searches every skill, so the shortlist never hides something
          // the user is explicitly looking for.
          for (const skill of list) {
            if (`${skill.name} ${skill.description}`.toLowerCase().includes(needle)) rows.push(skillRow(skill))
          }
          return rows

          function skillRow(skill) {
            return {
              name: skill.name,
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

        const matches = state.skills.filter((skill) => {
          if (filter === 'installed' && skill.installed !== true) return false
          if (filter === 'local' && !String(skill.source).includes('local')) return false
          if (filter === 'other' && (skill.installed === true || String(skill.source).includes('local'))) return false
          if (filter === 'writable' && skill.writable !== true) return false
          if (query.trim() === '') return true
          const needle = query.trim().toLowerCase()
          return `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(needle)
        })

        const installedCount = state.skills.filter((skill) => skill.installed === true).length

        const row = (skill) => {
          const editable = skill.writable === true && skill.path !== undefined
          return h(
            'div',
            {
              className: 'dshSkillPanel_row',
              key: `${skill.name}@${String(skill.path)}`,
              title: t('panel.useHint'),
              onDoubleClick: () => void useSkill(skill),
            },
            h('div', { className: 'dshSkillPanel_badge' }, initial(skill.name)),
            h(
              'div',
              { style: { minWidth: 0 } },
              h(
                'div',
                { className: 'dshSkillPanel_nameLine' },
                h('span', { className: 'dshSkillPanel_name' }, skill.name),
                h('span', { className: 'dshSkillPanel_tag' }, skill.source),
                skill.installed === true
                  ? h('span', { className: 'dshSkillPanel_tag' }, t('panel.filter.installed'))
                  : null,
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
                ? h('div', { className: 'dshSkillPanel_empty' }, t('panel.empty'))
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

    /** The composer button. */
    function SkillMarketButton({ open, menu, t, capture, inputActions }) {
      React.useEffect(() => {
        if (typeof capture === 'function') capture(inputActions)
      }, [capture, inputActions])
      const launched = menu === undefined ? false : useStoreValue(menu) === SOURCE
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
          'aria-expanded': launched ? 'true' : 'false',
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

          // One source owns the whole menu: the skill rows, then the two action
          // rows at the bottom. The button opens the menu through
          // `toggleSource(name)`, and the host renders exactly that one source —
          // so a second source could never appear beside it.
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
          // slot props. It is what lets the panel put `/<skill> ` into the draft
          // instead of asking the user to retype it.
          const inputActions = { value: undefined }

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
                  if (actx === undefined) return { open: undefined, menu: undefined, t, capture: () => {} }
                  const controller = ctx.inputTriggers.sessionOf(actx)
                  return {
                    menu: controller.launcher,
                    open: () => {
                      controller.toggleSource(SOURCE, {
                        trigger: TRIGGER,
                        query: '',
                        quoted: false,
                        position: 'leading',
                        span: { start: 0, end: 0, draftRev: 0 },
                      })
                    },
                    t,
                    // The host resolves session props for this slot; the button
                    // hands the input actions back so the overlay panel can use
                    // them too (an overlay is not session-scoped).
                    capture: (actions) => {
                      inputActions.value = actions
                    },
                  }
                },
              },
              SkillMarketButton,
            ),
          )

          console.info('[skill-market] client half active: menu rows, composer button and management panel registered')
        } catch (error) {
          console.error('[skill-market] client half failed to activate; UI contributions are unavailable:', error)
        }
      },
    }
  },
})
