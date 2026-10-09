/**
 * The market's skill provider.
 *
 * One provider (not one per directory) so the registry sees a single catalog,
 * a single invalidation point, and one consistent rank band. `list()` reads
 * frontmatter only; `get()` reads the body — the split the registry relies on
 * so browsing a menu never pays for the bodies it does not load.
 *
 * @module dsh-skill-market/provider
 */

import { join } from 'node:path'
import { isFile, listSkillFiles, parseSkillFile } from './skill-file.js'

/** Provider name shown in `skill.source` diagnostics and in the model catalog. */
export const PROVIDER_NAME = 'skill-market'

/**
 * Discovery cache lifetime. Long enough that opening a menu repeatedly does not
 * re-read the disk, short enough that a skill dropped in by hand appears
 * without restarting the Harness. Explicit `invalidate()` from the marketplace
 * operations bypasses it entirely.
 */
const CACHE_TTL_MS = 5000

/**
 * A skill source rooted at one directory.
 *
 * @typedef {{ path: string, source: string, rank: number }} Root
 */

/**
 * Skill provider over a fixed set of roots.
 *
 * `list()` never throws and never returns a half-built catalog: an unreadable
 * root contributes nothing, a malformed file is reported and skipped, and a
 * genuine failure yields `{ candidates, complete: false }` so the registry
 * keeps its last good catalog instead of dropping the provider.
 */
export class MarketSkillProvider {
  /**
   * @param options - provider wiring.
   * @param options.ctx - host plugin context, used only for logging.
   * @param options.roots - directory roots, lowest rank first.
   * @param options.hidden - live `{ names: string[] }` view of the hidden list.
   */
  constructor({ ctx, roots, hidden }) {
    /** @type {import('@deepseek-ai/cordis').Context} */
    this.ctx = ctx
    /** @type {Root[]} */
    this.roots = roots
    /**
     * Held by reference, not copied: the panel replaces `.names` and the next
     * discovery must see it. `undefined` means nothing is hidden.
     */
    this.hidden = hidden
    /** Stable provider name required by the registry's ownership check. */
    this.name = PROVIDER_NAME
    /** @type {Map<string, object>} skill name -> summary, rebuilt per discovery. */
    this.catalog = new Map()
    this.cache = undefined
  }

  /** Replace the root set (config is per-activation, so this is mostly for clarity). */
  setRoots(roots) {
    this.roots = roots
    this.invalidate()
  }

  /** Drop the discovery cache so the next read re-scans the disk. */
  invalidate() {
    this.cache = undefined
  }

  /**
   * Discover skill candidates across every root.
   *
   * A name that appears in more than one root resolves to the lowest-rank root
   * *within this provider*; cross-provider precedence is the registry's job and
   * is decided by the same rank number.
   *
   * @param options - registry lookup options (`cwd` is intentionally unused: these roots are workspace-independent).
   * @returns the candidate list, or an incomplete observation when a root threw.
   */
  async list(_options = {}) {
    const cached = this.cache
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.candidates
    }

    /** @type {object[]} */
    const candidates = []
    const seen = new Set()
    // Read the live list once per discovery: a hidden skill is dropped before it
    // can win a name, which is what keeps the menu and the panel consistent.
    const hidden = new Set(this.hidden?.names ?? [])
    let complete = true

    for (const root of this.roots) {
      let files
      try {
        files = await listSkillFiles(root.path)
      } catch (error) {
        complete = false
        this.ctx.logger.warn(`skill-market: root "${root.path}" skipped: ${message(error)}`)
        continue
      }
      for (const path of files) {
        if (!(await isFile(path))) continue
        let parsed
        try {
          parsed = await parseSkillFile(path)
        } catch (error) {
          complete = false
          this.ctx.logger.warn(`skill-market: skill file ${path} skipped: ${message(error)}`)
          continue
        }
        if (parsed === undefined) continue
        if (parsed.reason !== undefined) {
          this.ctx.logger.warn(`skill-market: skill file ${path} ignored: ${parsed.reason}`)
          continue
        }
        if (hidden.has(parsed.name)) continue
        if (seen.has(parsed.name)) {
          this.ctx.logger.warn(`skill-market: skill "${parsed.name}" from ${path} ignored because a higher-priority root already provides it`)
          continue
        }
        seen.add(parsed.name)
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
          invocation: parsed.invocation,
          source: root.source,
          provider: PROVIDER_NAME,
          rank: root.rank,
          path,
          locator: { path, root: root.path, source: root.source },
        })
      }
    }

    this.catalog = new Map(candidates.map((candidate) => [candidate.name, candidate]))
    const result = complete ? candidates : { candidates, complete }
    if (complete) this.cache = { at: Date.now(), candidates }
    return result
  }

  /**
   * Load one skill body from the locator discovery produced.
   *
   * The registry re-checks that the loaded definition still carries the name it
   * selected; a renamed file must therefore surface as a name mismatch rather
   * than a silent relabel, so the parsed name is returned unchanged.
   *
   * @param candidate - a candidate previously returned by `list()`.
   * @returns the full definition, or undefined when the file disappeared.
   */
  async get(candidate) {
    const locator = candidate?.locator
    if (locator === undefined) return undefined
    const parsed = await parseSkillFile(locator.path)
    if (parsed === undefined || parsed.reason !== undefined) return undefined
    return {
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
      invocation: parsed.invocation,
      source: locator.source,
      provider: PROVIDER_NAME,
      resourceBase: { kind: 'directory', path: locator.root },
      path: parsed.path,
      content: parsed.content,
    }
  }
}

/**
 * Build the root list for one activation.
 *
 * `localDirs` come first at the configured rank and step upward, so the first
 * configured directory outranks the later ones; the install root is appended
 * last because a marketplace install is the least specific source of the three.
 * Every local directory therefore outranks anything installed from a catalog.
 *
 * @param options - configuration and resolved paths.
 * @param options.localDirs - user-configured directories.
 * @param options.installRoot - resolved install directory.
 * @param options.rank - base rank.
 * @returns the ordered roots.
 */
export function buildRoots({ localDirs, installRoot, rank }) {
  const roots = []
  let next = rank
  for (const path of localDirs) {
    roots.push({ path, source: 'market-local', rank: next })
    next += 1
  }
  roots.push({ path: installRoot, source: 'market-install', rank: next })
  return roots
}

/** Resolve `<root>/<name>/SKILL.md` for a skill installed by this plugin. */
export function installedSkillFile(installRoot, name) {
  return join(installRoot, name, 'SKILL.md')
}

/** Message of an unknown thrown value. */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
