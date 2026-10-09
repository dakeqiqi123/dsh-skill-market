/**
 * The marketplace: reading catalogs and mutating the skill directory.
 *
 * Every operation lives here once. The client entry point, a settings page, and
 * the agent tool all call these same methods, because two implementations of
 * "install" would drift and only one of them would get the path guards right.
 *
 * Dependency policy matches `index.js`: only Node builtins and relative files at
 * module scope. The Cordis `Service` base class arrives as an argument from the
 * caller that could resolve it, which is what keeps this file testable without
 * the Harness present.
 *
 * @module dsh-skill-market/marketplace
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchRemoteSkill, listRemoteSkills, parseSourceSpec } from './github.js'
import { installedSkillFile } from './provider.js'
import { isSkillName, parseFrontmatter } from './skill-file.js'

/** The service key other host plugins inject to reach these operations. */
export const SERVICE_NAME = 'skillMarket'

/**
 * Publish {@link MarketOperations} as a Cordis service.
 *
 * The base class is passed in rather than imported so this module stays free of
 * Harness specifiers; `index.js` is the only place that resolves them, lazily.
 * Constructing a `Service` registers it on the owning context immediately, and
 * unloading the plugin unregisters it through the same fiber.
 *
 * @param options - wiring.
 * @param options.Service - the `Service` base class from `@deepseek-ai/cordis`.
 * @returns the published service instance.
 */
export function installService({ Service, ...wiring }) {
  class SkillMarketService extends Service {
    constructor(ctx) {
      super(ctx, SERVICE_NAME)
      this.operations = new MarketOperations(wiring)
    }

    catalog(options) {
      return this.operations.catalog(options)
    }

    search(options) {
      return this.operations.search(options)
    }

    install(options) {
      return this.operations.install(options)
    }

    installFromUrl(options) {
      return this.operations.installFromUrl(options)
    }

    remove(options) {
      return this.operations.remove(options)
    }

    local() {
      return this.operations.local()
    }

    get root() {
      return this.operations.root
    }
  }
  return new SkillMarketService(wiring.ctx)
}

/**
 * Host operations backing the skill marketplace.
 *
 * Mutating operations are deliberately conservative: they refuse to overwrite an
 * existing skill, they validate the name they are about to turn into a
 * directory, and they never delete a directory they cannot prove this plugin
 * installed.
 */
export class MarketOperations {
  /**
   * @param options - wiring.
   * @param options.ctx - host plugin context.
   * @param options.provider - the skill provider, invalidated after every mutation.
   * @param options.installRoot - resolved directory GitHub and catalog installs land in.
   * @param options.sources - curated source specs.
   * @param options.token - optional GitHub token.
   */
  constructor({ ctx, provider, installRoot, sources, token }) {
    this.ctx = ctx
    this.provider = provider
    this.installRoot = installRoot
    this.sources = sources
    this.token = token
  }

  /** The resolved install directory, reported to the UI so it can show it. */
  get root() {
    return this.installRoot
  }

  /**
   * List the curated sources and the skills each currently offers.
   *
   * A source that fails is reported in place rather than failing the call: one
   * unreachable repository must not hide the other sources' contents.
   *
   * @param options - cancellation and progress reporting.
   * @returns `{ root, sources: [{ spec, repo, ref, ok, skills, error }] }`.
   */
  async catalog({ signal, onProgress } = {}) {
    const sources = []
    for (const spec of this.sources) {
      try {
        const { repo, ref } = parseSourceSpec(spec)
        const skills = await listRemoteSkills({ spec, token: this.token, signal, onProgress })
        sources.push({ spec, repo, ref, ok: true, skills })
      } catch (error) {
        sources.push({ spec, repo: String(spec), ref: '', ok: false, skills: [], error: message(error) })
      }
    }
    return { root: this.installRoot, sources }
  }

  /**
   * Ad-hoc search across the curated sources and any extra spec the caller names.
   * @param options - query, extra spec, and cancellation.
   * @returns matching remote skills with their source.
   */
  async search({ query = '', spec, signal, onProgress } = {}) {
    const specs = spec === undefined || spec === '' ? this.sources : [spec, ...this.sources]
    const needle = query.trim().toLowerCase()
    const matches = []
    for (const candidate of specs) {
      try {
        const skills = await listRemoteSkills({ spec: candidate, token: this.token, signal, onProgress })
        const { repo, ref } = parseSourceSpec(candidate)
        for (const skill of skills) {
          if (needle !== '' && !`${skill.name} ${skill.description}`.toLowerCase().includes(needle)) continue
          matches.push({ ...skill, repo, ref })
        }
      } catch (error) {
        if (spec !== undefined && candidate === spec) throw error
        onProgress?.(`source ${candidate} skipped: ${message(error)}`)
      }
    }
    return { query, matches }
  }

  /**
   * Install one skill from a repository into the install root.
   *
   * The write order is: create the directory, publish SKILL.md, then invalidate
   * the provider. A failure after the directory exists removes it again, so a
   * failed install leaves no half-skill behind for the next discovery to trip
   * over. An existing skill is never overwritten.
   *
   * @param options - repository coordinates and cancellation.
   * @returns `{ installed: true, name, path, ref, repo }`.
   */
  async install({ repo, ref, path, token, signal }) {
    if (typeof repo !== 'string' || !repo.includes('/')) throw new Error('install requires a repository as "owner/repo"')
    if (typeof path !== 'string' || path === '') throw new Error('install requires the repository path of a SKILL.md')
    // No `ref` default on purpose: an unspecified ref is resolved to the
    // repository's real default branch inside `fetchRemoteSkill`, and a `'main'`
    // default here would silently defeat that and 404 on `master` repositories.
    const skill = await fetchRemoteSkill({ repo, ref, path, token: token ?? this.token, signal })
    if (!isSkillName(skill.name)) throw new Error(`refusing to install a skill with the invalid name "${skill.name}"`)

    const directory = join(this.installRoot, skill.name)
    const file = installedSkillFile(this.installRoot, skill.name)
    if (await exists(file)) {
      throw new Error(`skill "${skill.name}" is already installed at ${file}; remove it first to reinstall`)
    }
    await mkdir(directory, { recursive: false }).catch((error) => {
      if (error?.code === 'EEXIST') {
        throw new Error(`install directory ${directory} already exists but has no SKILL.md; resolve it by hand`)
      }
      throw error
    })
    try {
      await writeFile(file, renderSkillFile(skill), { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
    this.provider.invalidate()
    this.ctx.logger.info(`skill-market: installed "${skill.name}" from ${repo}@${skill.ref} into ${file}`)
    // Report the resolved ref, so a caller can pin what it just installed.
    return { installed: true, name: skill.name, path: file, ref: skill.ref, repo }
  }

  /**
   * Install a skill from any https URL that serves a SKILL.md.
   *
   * @param options - url and cancellation.
   * @returns the install result.
   */
  async installFromUrl({ url, signal }) {
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('installFromUrl requires an https URL')
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`fetching ${url} failed (${response.status})`)
    const body = await response.text()
    const parsed = await parseFrontmatter(body)
    const name = parsed?.data?.name
    if (typeof name !== 'string' || !isSkillName(name)) {
      throw new Error(`${url} does not carry a skill with a valid name in its frontmatter`)
    }
    const directory = join(this.installRoot, name)
    const file = installedSkillFile(this.installRoot, name)
    if (await exists(file)) throw new Error(`skill "${name}" is already installed at ${file}`)
    await mkdir(directory, { recursive: true })
    await writeFile(file, body, { encoding: 'utf8', flag: 'wx' })
    this.provider.invalidate()
    return { installed: true, name, path: file, ref: 'url', repo: url }
  }

  /**
   * Remove a skill this plugin installed.
   *
   * The guard is the point: only a directory holding a readable SKILL.md whose
   * `name` matches the directory name is removed. A skill the user wrote by hand
   * into the same root, or a partially written directory, is left alone and
   * reported instead.
   *
   * @param options - skill name.
   * @returns `{ removed: boolean, name, path?, reason? }`.
   */
  async remove({ name }) {
    if (!isSkillName(name)) throw new Error(`invalid skill name "${name}"`)
    const file = installedSkillFile(this.installRoot, name)
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { removed: false, name, reason: `no installed skill named "${name}" under ${this.installRoot}` }
      }
      throw error
    }
    const parsed = await parseFrontmatter(text)
    if (parsed?.data?.name !== name) {
      return {
        removed: false,
        name,
        reason: `${file} exists but its frontmatter names "${String(parsed?.data?.name)}"; refusing to delete it`,
      }
    }
    await rm(join(this.installRoot, name), { recursive: true, force: true })
    this.provider.invalidate()
    this.ctx.logger.info(`skill-market: removed installed skill "${name}"`)
    return { removed: true, name, path: file }
  }

  /**
   * Report what discovery can currently see.
   *
   * Nothing is copied: the local directories are already roots of this provider,
   * so "my own folder" is a first-class source rather than an install target.
   *
   * @returns the local and installed skills, with the resolved install root.
   */
  async local() {
    const candidates = await this.provider.list({})
    const list = Array.isArray(candidates) ? candidates : candidates.candidates
    const project = (candidate) => ({
      name: candidate.name,
      description: candidate.description,
      path: candidate.path,
    })
    return {
      root: this.installRoot,
      local: list.filter((candidate) => candidate.source === 'market-local').map(project),
      installed: list.filter((candidate) => candidate.source === 'market-install').map(project),
    }
  }
}

/**
 * Render a fetched skill back into a canonical SKILL.md file.
 *
 * Frontmatter is rewritten rather than passed through so an installed skill
 * always carries exactly the keys this project understands; a remote file cannot
 * smuggle extra fields into the user's skill directory.
 *
 * @param skill - a fetched remote skill.
 * @returns the file text.
 */
function renderSkillFile(skill) {
  const lines = ['---', `name: ${skill.name}`, `description: ${JSON.stringify(skill.description)}`]
  if (skill.invocation?.modelInvocable === false) lines.push('disable-model-invocation: true')
  if (skill.invocation?.userInvocable === false) lines.push('user-invocable: false')
  lines.push('---', '', skill.content, '')
  return lines.join('\n')
}

/** Whether a path exists. */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Message of an unknown thrown value. */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
