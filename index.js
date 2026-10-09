/**
 * Host half of `dsh-skill-market`.
 *
 * Responsibilities, in order of importance:
 *
 *  1. Contribute a skill provider to `ctx.skills` for the configured local
 *     directories plus the install root. Once registered, the built-in `/` skill
 *     menu, the `skill` tool, and the system-prompt catalog all serve these
 *     skills with no UI work — that is the whole reason this half exists.
 *  2. Offer skill management — browse, install from a local folder / archive /
 *     pasted document / GitHub, flip the two invocation flags, remove — once, as
 *     a host service and as an agent tool, so the panel and the model cannot
 *     drift apart.
 *
 * The panel reaches these operations through session commands, with payloads
 * carried as base64 because a command line cannot hold newlines or binary.
 *
 * Nothing here renders; the composer entry lives in `client.js`.
 *
 * Dependency policy: this module imports **only Node builtins and relative
 * files**. Harness packages are not resolvable from a profile directory, so a
 * static `import '@deepseek-ai/cordis'` would fail before the plugin ever
 * activated. Capabilities arrive through `inject` / `ctx.get()`, and the one
 * package that would need a real import (`@deepseek-ai/cordis`, for the Service
 * base class) is loaded lazily with a documented degradation.
 *
 * @module dsh-skill-market
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { SkillManager } from './lib/manage.js'
import { buildRoots, MarketSkillProvider } from './lib/provider.js'

/** Plugin row name as it appears in the composed config tree. */
export const name = 'skill-market'

/**
 * Required services.
 *
 * Only `skills` is mandatory: without a registry there is nothing to contribute
 * to, so the fiber stays pending rather than activating uselessly. The tool
 * registry is optional — a profile with no tool layer still gets the provider.
 */
export const inject = ['skills']

/**
 * Row configuration, read from `cordis.patch.yml`.
 *
 * Deliberately a plain object, not a schemastery schema: importing that package
 * from here would be a bare Harness import, and the CLI validates the row's
 * `config` against `Config` only when one is exported. Every key below is
 * therefore defaulted in code, and an unknown key is ignored rather than fatal.
 *
 * @typedef {object} SkillMarketConfig
 * @property {string[]} [localDirs] - extra skill directories.
 * @property {string} [installRoot] - install target; empty resolves to `$DSH_HOME/skills`.
 * @property {number} [rank] - precedence band inside this provider; lower wins.
 * @property {string[]} [sources] - curated `owner/repo[#ref]` sources.
 * @property {string} [token] - GitHub token; empty falls back to the environment.
 * @property {boolean} [registerTool] - register the `skill_market` tool.
 */

/** Defaults for every configuration key. */
export const DEFAULTS = {
  localDirs: [],
  installRoot: '',
  rank: 350,
  sources: [],
  token: '',
  registerTool: true,
}

/** Row id this plugin's patch inserts, used to address its own config for edits. */
export const ROW_ID = 'skill-market'

/** Route family the management panel talks to. */
export const ROUTE_PREFIX = '/api/skill-market'

/** Largest request body the panel may send, in bytes (an archive travels as base64). */
const MAX_BODY_BYTES = 12 * 1024 * 1024

/**
 * Activate the plugin.
 *
 * @param ctx - host context carrying `skills`.
 * @param {SkillMarketConfig} [config] - row configuration.
 */
export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...config }
  const installRoot = resolveInstallRoot(settings.installRoot)
  const localDirs = (settings.localDirs ?? []).map((entry) => resolve(entry))
  const roots = buildRoots({ localDirs, installRoot, rank: settings.rank })

  const provider = new MarketSkillProvider({ ctx, roots })
  ctx.skills.registerProvider(() => provider)

  const sources = (settings.sources ?? []).filter((spec) => typeof spec === 'string' && spec.trim() !== '')
  const token = settings.token === '' ? undefined : settings.token
  const manager = new SkillManager({ ctx, provider, installRoot, localDirs, dataDir: resolveDataDir() })
  const wiring = { ctx, provider, manager, installRoot, localDirs, sources, token }

  ctx.logger.info(
    `skill-market: ${String(roots.length)} root(s); install root ${installRoot}` +
      (localDirs.length === 0 ? ' (no localDirs configured)' : `; local dirs: ${localDirs.join(', ')}`),
  )

  if (settings.registerTool !== false) {
    ctx.inject(['tools'], (toolCtx) => {
      registerTool(toolCtx, wiring)
    })
  }

  // The management panel's data path: plain HTTP routes, not session commands.
  // A session command's result is echoed into the conversation, and the panel
  // polls — so a command transport would fill the transcript with the plugin's
  // own traffic. Routes keep the panel's reads and writes invisible to the chat,
  // and they also work when no session is open yet.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: (req, res) => {
            void handleRoute(req, res, wiring)
          },
        }),
      'skill-market: host routes',
    )
  })

  // The session command stays for manual use and for the agent: it is the one
  // entry point a person can type, and the panel no longer depends on it.
  registerPanelCommands(ctx, wiring)

  // The service is the seam a host-side UI action would call. It needs the Cordis
  // Service base class, which lives in a Harness package, so it is attempted
  // lazily and skipped with a note when unresolvable.
  void (async () => {
    try {
      const { Service } = await import('@deepseek-ai/cordis')
      const { installService } = await import('./lib/marketplace.js')
      installService({ Service, ctx, provider, installRoot, sources, token })
    } catch (error) {
      ctx.logger.info(
        'skill-market: skillMarket service not published (' +
          `${error instanceof Error ? error.message : String(error)}); ` +
          'the skill provider, the panel commands and the skill_market tool are unaffected',
      )
    }
  })()
}

/**
 * Answer one request from the management panel.
 *
 * The handler owns the whole response, so every branch — including a malformed
 * request — answers JSON rather than throwing out of the socket: a panel that
 * receives `{ ok: false, error }` can show the reason instead of failing mute.
 *
 * @param req - node request.
 * @param res - node response.
 * @param wiring - provider, manager, roots, and marketplace wiring.
 */
async function handleRoute(req, res, wiring) {
  const send = (status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  try {
    if (req.method !== 'POST') {
      send(405, { ok: false, error: 'POST required' })
      return
    }
    const action = new URL(req.url ?? '/', 'http://skill-market').pathname
      .slice(ROUTE_PREFIX.length)
      .replace(/^\/+/, '')
    const body = await readJsonBody(req)
    send(200, { ok: true, value: await dispatchRoute(action, body, wiring) })
  } catch (error) {
    send(400, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Read a JSON request body, refusing anything larger than the panel may send. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error(`request body exceeds ${String(MAX_BODY_BYTES)} bytes`)
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed
}

/**
 * Route one panel action to the management operations.
 *
 * @param action - the tail of the request path.
 * @param body - the decoded request body.
 * @param wiring - provider, manager and marketplace wiring.
 * @returns whatever the operation answered.
 */
async function dispatchRoute(action, body, wiring) {
  switch (action) {
    case 'list':
      return await wiring.manager.list()
    case 'policy':
      return await wiring.manager.setInvocation(body)
    case 'touch':
      return await wiring.manager.recordUse({ name: body.name })
    case 'install-dir':
      return await wiring.manager.installDirectory({ path: body.path })
    case 'install-zip':
      return await wiring.manager.installArchive({ data: body.data, name: body.name })
    case 'install-text':
      return await wiring.manager.installText({ text: body.text })
    case 'install-repo': {
      if (typeof body.repo !== 'string' || !/^[^/]+\/[^/]+$/.test(body.repo)) {
        throw new Error('install-repo requires a repository as "owner/repo"')
      }
      const { installSkillDirectories } = await import('./lib/git-install.js')
      const directories = typeof body.directory === 'string' && body.directory.trim() !== '' ? [body.directory.trim()] : []
      return await installSkillDirectories({
        ctx: wiring.ctx,
        provider: wiring.provider,
        installRoot: wiring.installRoot,
        repo: body.repo,
        directories,
      })
    }
    case 'remove':
      return await removeSkill(wiring, body.name)
    default:
      throw new Error(
        `unknown action ${JSON.stringify(action)}; expected list, policy, touch, install-dir, install-zip, install-text, install-repo or remove`,
      )
  }
}

/**
 * Publish the management operations as one session command.
 *
 * Commands and not an HTTP route: a panel has to read and write through
 * something the client already reaches, and a client-callable *structured* API
 * in the Harness comes from the generated Remote namespace machinery, which a
 * plain-JavaScript plugin cannot emit. A session command is reachable from the
 * client (`ctx.remote.commands.execute`), executes against the agent without
 * producing a model message, and its `text` field is passed through verbatim —
 * so the JSON payload travels there. The client parses it.
 *
 * Payloads that contain newlines or bytes (a pasted document, an archive) travel
 * as base64, because a command line is a single line.
 *
 * @param ctx - host plugin context.
 * @param wiring - provider, manager, roots, and marketplace wiring.
 */
function registerPanelCommands(ctx, wiring) {
  ctx.inject(['commands'], (commandCtx) => {
    const reply = (value) => ({ kind: 'success', text: JSON.stringify(value) })
    const fail = (error) => ({ kind: 'error', text: error instanceof Error ? error.message : String(error) })

    commandCtx.effect(
      () =>
        commandCtx.commands.register({
          name: 'skill-market',
          description: 'Manage skills: list / install / add-dir / add-zip / add-text / policy / touch / remove',
          input: { hint: '<list|install|add-dir|add-zip|add-text|policy|touch|remove> [arguments]' },
          handler: async ({ rawInput }) => {
            try {
              const parts = String(rawInput ?? '').trim().split(/\s+/)
              const action = parts[0] === undefined || parts[0] === '' ? 'list' : parts[0]
              const rest = parts.slice(1)
              switch (action) {
                case 'list':
                  return reply(await wiring.manager.list())
                case 'add-dir':
                  return reply(await wiring.manager.installDirectory({ path: rest.join(' ') }))
                case 'add-zip':
                  return reply(
                    await wiring.manager.installArchive({
                      data: rest[0],
                      name: rest.length > 1 ? decodeText(rest.slice(1).join(' ')) : undefined,
                    }),
                  )
                case 'add-text':
                  return reply(await wiring.manager.installText({ text: decodeText(rest.join(' ')) }))
                case 'policy':
                  return reply(await wiring.manager.setInvocation(decodeJson(rest.join(' '))))
                case 'touch':
                  return reply(await wiring.manager.recordUse({ name: rest.join(' ') }))
                case 'remove':
                  return reply(await removeSkill(wiring, rest.join(' ')))
                case 'install':
                  return reply(await installFromRepo(commandCtx, wiring, rest))
                default:
                  return {
                    kind: 'error',
                    text: `unknown action ${JSON.stringify(action)}; expected list, install, add-dir, add-zip, add-text, policy or remove`,
                  }
              }
            } catch (error) {
              return fail(error)
            }
          },
        }),
      'skill-market: panel command',
    )
  })
}

/** Remove one skill this plugin installed. */
async function removeSkill(wiring, name) {
  const { MarketOperations } = await import('./lib/marketplace.js')
  const market = new MarketOperations({
    ctx: wiring.ctx,
    provider: wiring.provider,
    installRoot: wiring.installRoot,
    sources: [],
    token: undefined,
  })
  return await market.remove({ name })
}

/** Install one or more skill directories from a repository. */
async function installFromRepo(ctx, wiring, args) {
  const repo = args[0]
  if (typeof repo !== 'string' || !/^[^/]+\/[^/]+$/.test(repo)) {
    throw new Error('usage: install <owner/repo> [skill-directory ...]')
  }
  const { installSkillDirectories } = await import('./lib/git-install.js')
  return await installSkillDirectories({
    ctx,
    provider: wiring.provider,
    installRoot: wiring.installRoot,
    repo,
    directories: args.slice(1),
  })
}

/** Decode a base64 utf8 payload that travelled through the command line. */
function decodeText(value) {
  if (typeof value !== 'string' || value === '') throw new Error('expected a base64 payload')
  return Buffer.from(value, 'base64').toString('utf8')
}

/** Decode a base64 JSON payload that travelled through the command line. */
function decodeJson(value) {
  const parsed = JSON.parse(decodeText(value))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('expected a JSON object payload')
  }
  return parsed
}

/**
 * Register the agent-facing marketplace tool.
 *
 * The definition is written out in the registry's **raw** shape rather than
 * produced by `@deepseek-ai/dsh-tools`'s `defineTool`, because that specifier
 * does not resolve from a profile directory. A raw definition only needs
 * `output.render` to be callable and both schemas to be supported JSON Schema.
 *
 * @param toolCtx - context carrying `tools`.
 * @param wiring - provider, manager and marketplace wiring.
 */
function registerTool(toolCtx, wiring) {
  void import('./lib/marketplace.js')
    .then(({ MarketOperations }) => {
      const market = new MarketOperations(wiring)
      toolCtx.tools.register({
        name: 'skill_market',
        description:
          'Browse and manage the skills available to this profile. Actions: "list" returns every skill with its ' +
          'origin and invocation flags; "local" lists what the configured local directories and the install root ' +
          'hold; "catalog" lists the curated sources and their skills; "search" finds skills in a repository; ' +
          '"install" downloads one SKILL.md from a repository; "install-dir" mounts every skill found in a local ' +
          'folder; "install-text" writes a pasted SKILL.md; "policy" flips whether the menu and the model may use ' +
          'a skill; "remove" deletes a skill this plugin installed. Installations write to disk and take effect ' +
          'immediately.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'local', 'catalog', 'search', 'install', 'install-dir', 'install-text', 'policy', 'remove'],
              description: 'One of: list, local, catalog, search, install, install-dir, install-text, policy, remove.',
            },
            repo: { type: 'string', description: 'Repository as "owner/repo". Required for install.' },
            ref: { type: 'string', description: 'Commit sha or tag to install from. Defaults to the default branch.' },
            path: { type: 'string', description: 'Repository path of a SKILL.md, or the local SKILL.md for policy.' },
            directory: { type: 'string', description: 'Absolute local folder holding skills. Required for install-dir.' },
            text: { type: 'string', description: 'A whole SKILL.md document. Required for install-text.' },
            query: { type: 'string', description: 'Search text matched against skill name and description.' },
            spec: { type: 'string', description: 'Ad-hoc "owner/repo[#ref]" source for search.' },
            skillName: { type: 'string', description: 'Skill name to remove.' },
            modelInvocable: { type: 'boolean', description: 'Whether the model may call the skill. For policy.' },
            userInvocable: { type: 'boolean', description: 'Whether the skill appears in the user menu. For policy.' },
          },
          required: ['action'],
        },
        output: {
          // Deliberately loose: the panel payloads are nested and each action
          // answers a different shape. The registry validates the value against
          // this schema before `render` runs, so a narrow schema would reject
          // honest output.
          schema: { type: 'object' },
          /**
           * Render one result for the model.
           *
           * The registry does NOT wrap this return value — it becomes the tool
           * result's `content` verbatim, so it must be a content-block array.
           *
           * @param _args - arguments the call was made with.
           * @param value - the validated value returned by `execute`.
           * @returns one text content block.
           */
          render: (_args, value) => [
            {
              type: 'text',
              text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
            },
          ],
        },
        execute: async (args, exec) => {
          const action = normalizeAction(args)
          const signal = exec?.signal
          switch (action) {
            case 'list':
              return await wiring.manager.list()
            case 'local':
              return await market.local()
            case 'catalog':
              return await market.catalog({ signal })
            case 'search':
              return await market.search({ query: args.query ?? '', spec: args.spec, signal })
            case 'install':
              return await market.install({ repo: args.repo, ref: args.ref, path: args.path, signal })
            case 'install-dir':
              return await wiring.manager.installDirectory({ path: args.directory })
            case 'install-text':
              return await wiring.manager.installText({ text: args.text })
            case 'policy':
              return await wiring.manager.setInvocation({
                path: args.path,
                modelInvocable: args.modelInvocable,
                userInvocable: args.userInvocable,
              })
            case 'remove':
              return await market.remove({ name: args.skillName })
            /* c8 ignore next 2 -- normalizeAction rejects every other value first */
            default:
              throw new Error(`unknown skill_market action "${String(action)}"`)
          }
        },
      })
      wiring.ctx.logger.info('skill-market: skill_market tool registered')
    })
    .catch((error) => {
      wiring.ctx.logger.warn(
        `skill-market: skill_market tool not registered: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
}

/** The closed action set, mirroring the parameter schema above. */
const ACTIONS = new Set([
  'list',
  'local',
  'catalog',
  'search',
  'install',
  'install-dir',
  'install-text',
  'policy',
  'remove',
])

/**
 * Validate the one argument this tool dispatches on.
 *
 * Without `defineTool` there is no schema validation in front of `execute`, so
 * an unknown action must fail loudly here instead of silently falling through.
 *
 * @param args - model-supplied arguments.
 * @returns the validated action name.
 */
function normalizeAction(args) {
  const action = args?.action
  if (typeof action !== 'string' || !ACTIONS.has(action)) {
    throw new Error(`skill_market requires action to be one of ${[...ACTIONS].map((value) => `"${value}"`).join(', ')}`)
  }
  return action
}

/**
 * Resolve the install directory.
 *
 * `$DSH_HOME/skills` is the target of choice because the built-in filesystem
 * provider already scans and watches it: an install becomes visible without a
 * restart, and a user who later removes this plugin keeps their skills.
 *
 * @param configured - the configured path, possibly empty.
 * @returns an absolute directory path.
 */
function resolveInstallRoot(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') {
    return isAbsolute(configured) ? configured : resolve(configured)
  }
  const home = process.env.DSH_HOME
  const base = home !== undefined && home !== '' ? home : join(homedir(), '.dsh')
  return join(base, 'skills')
}

/**
 * Resolve this plugin's own state directory.
 *
 * It sits beside `skills` under the Harness home rather than inside a skill
 * directory, so the usage history is never mistaken for a skill and survives a
 * reinstall of the plugin.
 *
 * @returns an absolute directory path.
 */
function resolveDataDir() {
  const home = process.env.DSH_HOME
  const base = home !== undefined && home !== '' ? home : join(homedir(), '.dsh')
  return join(base, 'skill-market')
}
