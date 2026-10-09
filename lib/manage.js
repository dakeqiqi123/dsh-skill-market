/**
 * Skill management: browsing, invocation policy, and local delivery.
 *
 * This is the host half of the management panel. It exists so that the panel,
 * the `skill_market` tool, and any future settings page share one implementation
 * of "which skills exist", "what can this one do", and "where does a new one go".
 *
 * Dependency policy matches the rest of the plugin: Node builtins and relative
 * files only. ZIP archives are expanded with `node:zlib` rather than an external
 * tool, because a profile's `node_modules` cannot resolve a package and spawning
 * PowerShell would make the plugin's behaviour depend on the machine.
 *
 * Invocation policy is the platform's own: `SKILL.md` frontmatter carries
 * `disable-model-invocation: true` (the model cannot call it) and
 * `user-invocable: false` (the user does not see it in the `/` menu). Writing
 * those keys — rather than keeping a private hidden-list — is what keeps this
 * panel consistent with the built-in skill interface.
 *
 * @module dsh-skill-market/manage
 */

import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { isSkillName, parseFrontmatter, splitFrontmatter } from './skill-file.js'

/** Frontmatter key meaning "the model must not invoke this skill". */
const MODEL_KEY = 'disable-model-invocation'
/** Frontmatter key meaning "the user's `/` menu must not offer this skill". */
const USER_KEY = 'user-invocable'

/** Skills larger than this are refused: the panel sends archives through a command. */
export const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024

/**
 * Read and write the skills a profile currently has.
 *
 * Every mutating method refuses to touch a file it cannot prove is a skill under
 * a directory this plugin is allowed to write: `installRoot` plus the configured
 * local directories. Bundled and project skills stay read-only, which is the same
 * boundary the built-in skill interfaces describe.
 */
export class SkillManager {
  /**
   * @param options - wiring.
   * @param options.ctx - host plugin context.
   * @param options.provider - this plugin's skill provider, invalidated after mutations.
   * @param options.installRoot - directory installs land in.
   * @param options.localDirs - extra skill directories the user configured.
   * @param options.dataDir - directory for this plugin's own state (usage history).
   */
  constructor({ ctx, provider, installRoot, localDirs = [], dataDir }) {
    this.ctx = ctx
    this.provider = provider
    this.installRoot = installRoot
    this.localDirs = localDirs
    this.dataDir = dataDir ?? join(installRoot, '..', 'skill-market')
    this.usageFile = join(this.dataDir, 'usage.json')
  }

  /** Directories this plugin may write skill files into. */
  get writableRoots() {
    return [this.installRoot, ...this.localDirs]
  }

  /**
   * List every skill the profile currently exposes, with its policy and origin.
   *
   * The registry is the source of truth when it is reachable, because it already
   * merges every provider (bundled, project, custom, user, this plugin's) and
   * carries the invocation policy the platform enforces. The fallback walks this
   * plugin's own provider, so a composition without a registry still lists
   * something useful.
   *
   * @returns `{ installRoot, roots, skills }`, each skill carrying
   *   `{ name, description, whenToUse?, path, source, modelInvocable, userInvocable,
   *     installed, writable, lastUsedAt, installedAt }`,
   *   where the two timestamps feed the composer menu's "recent" shortlist.
   */
  async list() {
    const registry = typeof this.ctx?.get === 'function' ? this.ctx.get('skills') : this.ctx?.skills
    let summaries
    if (registry !== undefined && typeof registry.list === 'function') {
      const listed = await registry.list({})
      summaries = Array.isArray(listed) ? listed : (listed?.skills ?? [])
    } else {
      summaries = await this.listFromProvider()
    }
    const usage = await this.readUsage()
    const skills = []
    for (const summary of summaries) {
      const skill = this.describe(summary)
      if (skill.name === undefined) continue
      skill.lastUsedAt = usage.used[skill.name] ?? 0
      skill.installedAt = 0
      if (skill.installed === true && skill.path !== undefined) {
        try {
          skill.installedAt = (await stat(skill.path)).mtimeMs
        } catch {
          skill.installedAt = 0
        }
      }
      skills.push(skill)
    }
    skills.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    return { installRoot: this.installRoot, roots: this.writableRoots, skills }
  }

  /**
   * Remember that one skill was used, so the menu can offer it again next time.
   *
   * The file keeps a bounded history: only the most recent entries survive, which
   * is all the shortlist needs and keeps the write small.
   *
   * @param options - the skill name.
   * @returns `{ name, lastUsedAt }`.
   */
  async recordUse({ name }) {
    if (typeof name !== 'string' || name.trim() === '') throw new Error('recordUse requires a skill name')
    const usage = await this.readUsage()
    const at = Date.now()
    usage.used[name] = at
    const kept = Object.entries(usage.used)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 200)
    await mkdir(this.dataDir, { recursive: true })
    await writeFile(this.usageFile, `${JSON.stringify({ used: Object.fromEntries(kept) }, null, 2)}\n`, 'utf8')
    return { name, lastUsedAt: at }
  }

  /** Read the usage history, tolerating a missing or unreadable file. */
  async readUsage() {
    try {
      const parsed = JSON.parse(await readFile(this.usageFile, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.used === 'object' && parsed.used !== null) {
        return { used: parsed.used }
      }
    } catch {
      // A missing or corrupt history only costs the shortlist its ordering.
    }
    return { used: {} }
  }

  /** Fallback listing through this plugin's own provider. */
  async listFromProvider() {
    const listed = await this.provider.list({})
    const candidates = Array.isArray(listed) ? listed : (listed?.candidates ?? [])
    const summaries = []
    for (const candidate of candidates) {
      let invocation
      try {
        const text = await readFile(candidate.path, 'utf8')
        const parsed = await parseFrontmatter(text)
        invocation = parsed?.data === undefined ? undefined : invocationFrom(parsed.data)
      } catch {
        invocation = undefined
      }
      summaries.push({ ...candidate, invocation })
    }
    return summaries
  }

  /**
   * Normalize one registry summary (or provider candidate) for the panel.
   *
   * @param summary - a `SkillSummary` or a provider candidate.
   * @returns the panel row.
   */
  describe(summary) {
    const path = typeof summary.path === 'string' ? summary.path : undefined
    const invocation = summary.invocation ?? {}
    const modelInvocable = invocation.modelInvocable ?? summary.modelInvocable ?? true
    const userInvocable = invocation.userInvocable ?? summary.userInvocable ?? true
    return {
      name: summary.name,
      description: summary.description ?? '',
      ...(summary.whenToUse === undefined ? {} : { whenToUse: summary.whenToUse }),
      ...(path === undefined ? {} : { path }),
      source: String(summary.provider ?? summary.source ?? 'unknown'),
      modelInvocable: modelInvocable !== false,
      userInvocable: userInvocable !== false,
      installed: path !== undefined && inside(this.installRoot, path),
      writable: path !== undefined && this.writableRoots.some((root) => inside(root, path)),
    }
  }

  /**
   * Rewrite one skill's invocation policy in its own frontmatter.
   *
   * Only the two policy keys are touched; the rest of the frontmatter and the
   * whole body are preserved. The write goes through a temporary file in the same
   * directory so a crash cannot leave a half-written SKILL.md behind.
   *
   * @param options - target file and the flags to store.
   * @returns `{ name, path, modelInvocable, userInvocable }`.
   */
  async setInvocation({ path, modelInvocable, userInvocable }) {
    const file = this.assertWritableSkillFile(path)
    const text = await readFile(file, 'utf8')
    const split = splitFrontmatter(text)
    if (split === undefined) throw new Error(`${file} has no frontmatter to edit`)
    const rewritten = [
      '---',
      ...rewritePolicy(split.yamlText.split(/\r?\n/), {
        ...(modelInvocable === undefined ? {} : { modelInvocable: modelInvocable !== false }),
        ...(userInvocable === undefined ? {} : { userInvocable: userInvocable !== false }),
      }),
      '---',
      split.body.replace(/^\n/, ''),
    ].join('\n')
    const temporary = join(dirname(file), `.skill-market-${String(Date.now())}.tmp`)
    await writeFile(temporary, rewritten, 'utf8')
    await rename(temporary, file)
    this.provider.invalidate()
    const parsed = await parseFrontmatter(rewritten)
    const policy = invocationFrom(parsed?.data ?? {})
    this.ctx.logger.info(
      `skill-market: "${String(parsed?.data?.name)}" policy now model=${String(policy.modelInvocable)} user=${String(policy.userInvocable)}`,
    )
    return { name: parsed?.data?.name, path: file, ...policy }
  }

  /**
   * Install every skill found under one local directory.
   *
   * A directory holding `SKILL.md` is one skill; otherwise its immediate
   * subdirectories are scanned, which is how a repository of skills arrives when
   * the user picks the checkout's root. The whole directory is copied — scripts
   * and assets included — because a skill that ships a script is useless without
   * it.
   *
   * @param options - absolute source directory.
   * @returns `{ installed, skipped, failed }` with one entry per candidate.
   */
  async installDirectory({ path }) {
    const source = this.assertSourceDirectory(path)
    const candidates = await discoverSkillDirectories(source)
    if (candidates.length === 0) {
      throw new Error(`no SKILL.md found in ${source} or its immediate subdirectories`)
    }
    return await this.installCandidates(candidates)
  }

  /**
   * Install from a ZIP archive delivered by the panel.
   *
   * @param options - base64 payload and an optional display name.
   * @returns the install report.
   */
  async installArchive({ data, name }) {
    if (typeof data !== 'string' || data === '') throw new Error('installArchive requires the archive bytes')
    const bytes = Buffer.from(data, 'base64')
    if (bytes.byteLength === 0) throw new Error('the uploaded archive is empty')
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error(`the archive is ${String(bytes.byteLength)} bytes; the limit is ${String(MAX_ARCHIVE_BYTES)}`)
    }
    const staging = join(this.installRoot, `.skill-market-unpack-${String(Date.now())}`)
    await mkdir(staging, { recursive: true })
    try {
      const written = await extractZip(bytes, staging)
      const candidates = await discoverSkillDirectories(staging)
      if (candidates.length === 0) {
        throw new Error(`${String(name ?? 'the archive')} carries no SKILL.md (${String(written)} file(s) unpacked)`)
      }
      return await this.installCandidates(candidates)
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Install a skill from pasted `SKILL.md` text.
   *
   * @param options - the document text.
   * @returns the install report.
   */
  async installText({ text }) {
    if (typeof text !== 'string' || text.trim() === '') throw new Error('installText requires the SKILL.md text')
    const parsed = await parseFrontmatter(text)
    const name = parsed?.data?.name
    const description = parsed?.data?.description
    if (typeof name !== 'string' || !isSkillName(name)) {
      throw new Error('the pasted document needs a kebab-case "name" in its frontmatter')
    }
    if (typeof description !== 'string' || description.trim() === '') {
      throw new Error('the pasted document needs a "description" in its frontmatter')
    }
    const directory = join(this.installRoot, name)
    if (await exists(directory)) {
      return { installed: [], skipped: [{ name, reason: `"${name}" already exists at ${directory}` }], failed: [] }
    }
    await mkdir(directory, { recursive: true })
    const file = join(directory, 'SKILL.md')
    await writeFile(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
    this.provider.invalidate()
    return { installed: [{ name, path: file }], skipped: [], failed: [] }
  }

  /** Copy each discovered skill directory into the install root. */
  async installCandidates(candidates) {
    const installed = []
    const skipped = []
    const failed = []
    for (const candidate of candidates) {
      try {
        const text = await readFile(join(candidate, 'SKILL.md'), 'utf8')
        const parsed = await parseFrontmatter(text)
        const name = parsed?.data?.name
        if (typeof name !== 'string' || !isSkillName(name)) {
          skipped.push({ name, directory: candidate, reason: 'frontmatter needs a kebab-case "name"' })
          continue
        }
        if (typeof parsed?.data?.description !== 'string' || parsed.data.description.trim() === '') {
          skipped.push({ name, directory: candidate, reason: 'frontmatter needs a "description"' })
          continue
        }
        const target = join(this.installRoot, name)
        if (await exists(target)) {
          skipped.push({ name, directory: candidate, reason: `"${name}" already exists at ${target}` })
          continue
        }
        await cp(candidate, target, { recursive: true, errorOnExist: true, force: false })
        installed.push({ name, path: join(target, 'SKILL.md') })
      } catch (error) {
        failed.push({ directory: candidate, error: message(error) })
      }
    }
    if (installed.length > 0) this.provider.invalidate()
    this.ctx.logger.info(
      `skill-market: installed ${String(installed.length)} skill(s), skipped ${String(skipped.length)}, failed ${String(failed.length)}`,
    )
    return { installed, skipped, failed }
  }

  /** Refuse a path that is not a skill file under a writable root. */
  assertWritableSkillFile(path) {
    if (typeof path !== 'string' || !isAbsolute(path)) {
      throw new Error(`expected an absolute SKILL.md path, got ${JSON.stringify(path)}`)
    }
    if (!path.toLowerCase().endsWith('.md')) throw new Error(`${path} is not a markdown skill file`)
    if (!this.writableRoots.some((root) => inside(root, path))) {
      throw new Error(
        `${path} is outside the directories this plugin may modify (${this.writableRoots.join(', ')}); ` +
          'bundled and project skills are read-only here',
      )
    }
    return path
  }

  /** Refuse a path that is not an existing absolute directory. */
  assertSourceDirectory(path) {
    if (typeof path !== 'string' || path.trim() === '') throw new Error('expected the absolute path of a local folder')
    if (!isAbsolute(path)) throw new Error(`${path} is not an absolute path`)
    return resolve(path)
  }
}

/**
 * Turn frontmatter data into the two flags the UI shows.
 * @param data - parsed frontmatter.
 * @returns `{ modelInvocable, userInvocable }`.
 */
export function invocationFrom(data) {
  return {
    modelInvocable: data[MODEL_KEY] !== true,
    userInvocable: data[USER_KEY] !== false,
  }
}

/**
 * Rewrite the two policy keys inside one frontmatter block, preserving order.
 *
 * An enabled flag removes its key (the defaults are the enabled state), which is
 * what the built-in skill interface does too — a skill that was never toggled
 * carries no policy keys at all.
 *
 * @param lines - frontmatter lines, without the fences.
 * @param policy - the flags to store; an absent flag is left untouched.
 * @returns the rewritten lines.
 */
export function rewritePolicy(lines, policy) {
  const wanted = new Map()
  if (policy.modelInvocable !== undefined) wanted.set(MODEL_KEY, policy.modelInvocable)
  if (policy.userInvocable !== undefined) wanted.set(USER_KEY, policy.userInvocable)
  const output = []
  const seen = new Set()
  for (const line of lines) {
    const key = topLevelKey(line)
    if (key !== undefined && wanted.has(key)) {
      seen.add(key)
      if (wanted.get(key) === false) output.push(`${key}: ${key === MODEL_KEY ? 'true' : 'false'}`)
      continue
    }
    output.push(line)
  }
  for (const [key, value] of wanted) {
    if (seen.has(key)) continue
    if (value === false) output.push(`${key}: ${key === MODEL_KEY ? 'true' : 'false'}`)
  }
  return output
}

/** The top-level key of one frontmatter line, or undefined for a nested/blank line. */
function topLevelKey(line) {
  if (/^\s/.test(line)) return undefined
  const separator = line.indexOf(':')
  if (separator <= 0) return undefined
  return line.slice(0, separator).trim()
}

/** Absolute paths of every directory that directly holds a SKILL.md. */
async function discoverSkillDirectories(root) {
  if (await isFile(join(root, 'SKILL.md'))) return [root]
  const found = []
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const directory = join(root, entry.name)
    if (await isFile(join(directory, 'SKILL.md'))) found.push(directory)
  }
  return found
}

/**
 * Expand a ZIP archive into `destination`.
 *
 * Only the two storage methods a real archive uses are supported: stored and
 * deflate. Entries are written through a path guard, so an archive cannot escape
 * the staging directory with `..` or an absolute name.
 *
 * @param bytes - the archive.
 * @param destination - directory to write into.
 * @returns the number of files written.
 */
export async function extractZip(bytes, destination) {
  const end = findEndOfCentralDirectory(bytes)
  if (end < 0) throw new Error('the upload is not a ZIP archive')
  const count = bytes.readUInt16LE(end + 10)
  let cursor = bytes.readUInt32LE(end + 16)
  let written = 0
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length) break
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`central directory entry ${String(index)} is malformed`)
    const method = bytes.readUInt16LE(cursor + 10)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    cursor += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    const target = safeJoin(destination, name)
    if (target === undefined) continue
    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)
    let content
    if (method === 0) content = raw
    else if (method === 8) content = inflateRawSync(raw)
    else throw new Error(`entry ${name} uses unsupported compression method ${String(method)}`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    written += 1
  }
  return written
}

/** Join one archive entry onto the staging directory, refusing escapes. */
function safeJoin(root, entry) {
  const normalized = entry.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized === '' || normalized.split('/').includes('..')) return undefined
  const target = join(root, normalized)
  return inside(root, target) ? target : undefined
}

/** Offset of the ZIP end-of-central-directory record, or -1. */
function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 66_000)
  for (let index = bytes.length - 22; index >= minimum; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) return index
  }
  return -1
}

/** Whether `candidate` is the same as, or inside, `root`. */
export function inside(root, candidate) {
  const rel = relative(root, candidate)
  if (rel === '') return true
  return !rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`)
}

/** Whether a path is an existing file. */
async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Whether a path exists at all. */
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
