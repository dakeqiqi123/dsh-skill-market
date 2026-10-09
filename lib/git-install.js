/**
 * Install whole skill directories from a repository.
 *
 * **Two transports, and the REST one is preferred.** The API route costs one
 * request per *shared parent* rather than one per skill, so a repository that
 * keeps its skills side by side needs a handful of requests instead of one per
 * directory — and it needs no subprocess at all. The git route is the fallback
 * for the shapes the API cannot reach cheaply (deeply nested skills, no common
 * parent) and for a repository so large that its tree API answer is truncated.
 *
 * The git route also has a narrower operating envelope worth knowing about: a
 * confined Windows sandbox lets `git` spawn but denies its TLS credentials
 * (`schannel: AcquireCredentialsHandle failed`), so it only works in an
 * unconfined run. The API route works in both.
 *
 * @module dsh-skill-market/lib/git-install
 */

import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { isSkillName, parseFrontmatter, parseInvocationPolicy } from './skill-file.js'

/** Entry file names a skill directory may use; the built-in provider only reads the first. */
export const ENTRY_NAMES = ['SKILL.md', 'skill.md']

/**
 * Run one git command with **no captured stdio**.
 *
 * Not a style choice. A confined Windows sandbox denies a process the right to
 * hand a child's piped stdio to itself, and the denial surfaces as `EPERM` on
 * spawn — the same boundary that broke an earlier version of the dependency
 * probe. `ignore` and `inherit` both work; `'pipe'` does not. Git's own
 * diagnostics therefore go to the caller's stderr rather than into a string.
 *
 * @param args - git arguments.
 * @param options - optional working directory.
 */
function runGit(args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('git', args, { stdio: ['ignore', 'ignore', 'inherit'], ...options })
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code === 0) resolvePromise(undefined)
      else rejectPromise(new Error(`git ${args.join(' ')} exited ${code}`))
    })
  })
}

/** Whether a local path exists. */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a repository's default branch.
 *
 * One REST call is enough and costs one unit of a 60/hour budget, which is
 * nothing next to the per-directory listing this module exists to avoid. `git
 * ls-remote` looked like the quota-free alternative and is not usable here: it
 * has no `--output` (so its answer needs a pipe, which this sandbox denies) and
 * routing it through `cmd.exe`'s `>` breaks on this workspace's non-ASCII path.
 *
 * @param repo - `owner/repo`.
 * @returns the branch name.
 * @throws when neither route can answer.
 */
export async function resolveDefaultBranchViaGit(repo) {
  try {
    const { resolveDefaultBranch } = await import('./github.js')
    return await resolveDefaultBranch({ repo })
  } catch (error) {
    throw new Error(
      `could not resolve the default branch of ${repo}: ${error instanceof Error ? error.message : String(error)}\n` +
        '        pass an explicit ref (owner/repo#branch) to skip this lookup',
    )
  }
}

/**
 * Re-emit one entry file through the shared frontmatter policy.
 *
 * Frontmatter is parsed and rewritten rather than passed through, for the same
 * reason the marketplace does it: an installed skill must carry only the fields
 * this project understands, and a remote file must not be able to inject a
 * policy the loader silently ignores.
 *
 * @param text - the downloaded file.
 * @param label - human-readable source, for failure messages.
 * @returns the normalized name, description, and file text.
 */
export async function normalizeEntry(text, label) {
  const parsed = await parseFrontmatter(text)
  if (parsed === undefined) throw new Error(`${label} has no YAML frontmatter`)
  const { name, description } = parsed.data ?? {}
  if (typeof name !== 'string' || !isSkillName(name)) {
    throw new Error(`${label} declares an invalid skill name ${JSON.stringify(name)}`)
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`${label} declares no description`)
  }
  const invocation = parseInvocationPolicy(parsed.data)
  const lines = ['---', `name: ${name}`, `description: ${JSON.stringify(description)}`]
  if (typeof parsed.data.whenToUse === 'string' && parsed.data.whenToUse.trim() !== '') {
    lines.push(`whenToUse: ${JSON.stringify(parsed.data.whenToUse)}`)
  }
  if (invocation.modelInvocable === false) lines.push('disable-model-invocation: true')
  if (invocation.userInvocable === false) lines.push('user-invocable: false')
  lines.push('---', '', parsed.body.trim(), '')
  return { name, description, text: lines.join('\n') }
}

/**
 * Clone a repository shallowly and sparsely into a temporary directory.
 *
 * @param options - repository, ref, and the top-level directories to materialize.
 * @returns the working directory (caller removes it).
 */
export async function sparseClone({ repo, ref, directories }) {
  const working = await mkdtemp(join(tmpdir(), 'dsh-skill-clone-'))
  const url = `https://github.com/${repo}.git`
  await runGit(['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', '--branch', ref, url, working])
  await runGit(['-C', working, 'sparse-checkout', 'init', '--no-cone'])
  await runGit(['-C', working, 'sparse-checkout', 'set', ...(directories.length > 0 ? directories : ['.'])])
  await runGit(['-C', working, 'checkout', '--quiet'])
  return working
}

/**
 * Every top-level directory of a working tree that looks like a skill.
 *
 * @param working - a checked-out clone.
 * @returns `{ directory, entry }` pairs, sorted.
 */
export async function listSkillDirectories(working) {
  const found = []
  for (const entry of await readdir(working, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    for (const name of ENTRY_NAMES) {
      if (await exists(join(working, entry.name, name))) {
        found.push({ directory: entry.name, entry: name })
        break
      }
    }
  }
  return found
}

/**
 * Discover the skill directories of a repository, over the REST API.
 *
 * A repository is scanned at its root and then one level deeper under
 * `skills/`, which covers the layouts in practice. Directories that were named
 * explicitly are taken at their word, so a caller can install a skill the scan
 * would not reach.
 *
 * @param options - repository, ref, and the explicitly requested directories.
 * @returns `{ directory, entryName }` pairs.
 */
export async function discoverSkillDirectories({ repo, ref, requested = [], token, signal }) {
  const { listTreePaths } = await import('./github.js')
  if (requested.length > 0) return requested.map((directory) => ({ directory, entryName: undefined }))
  for (const scope of ['', 'skills']) {
    const files = await listTreePaths({ repo, ref, path: scope, token, signal })
    const found = new Map()
    for (const file of files) {
      const name = file.slice(file.lastIndexOf('/') + 1)
      if (!ENTRY_NAMES.includes(name)) continue
      const directory = file.slice(0, file.lastIndexOf('/'))
      if (directory === '' || directory.includes('/')) continue
      if (found.has(directory)) continue
      found.set(directory, { directory, entryName: name })
    }
    if (found.size > 0) return [...found.values()]
  }
  return []
}

/**
 * Write already-fetched skill directories into the install root.
 *
 * Shared by both transports so the guard rails cannot diverge: an existing target
 * is never overwritten, a failure removes the directory it created, and every
 * install is read back through the real parser before it is reported as done.
 *
 * The entry file is written **once**, under its final name. Writing the payload
 * first and then overwriting `SKILL.md` looks equivalent and is not: a skill
 * whose entry arrived as `skill.md` leaves a file that is the same name on a
 * case-insensitive filesystem, and the sandbox's path resolution then fails the
 * capitalized write with `ENOENT` — the directory exists, the name does not
 * resolve. Renaming the payload entry before the write removes the second write
 * entirely.
 *
 * @param options - destination, prepared items, and result collectors.
 * @returns nothing; the collectors are appended to.
 */
async function writePrepared({ installRoot, prepared, installed, skipped, failed }) {
  for (const item of prepared) {
    const target = join(installRoot, item.name)
    if (await exists(target)) {
      skipped.push({ name: item.name, reason: 'already installed' })
      continue
    }
    try {
      await mkdir(target, { recursive: false }).catch((error) => {
        if (error?.code === 'EEXIST') throw new Error(`${target} appeared while installing`)
        throw error
      })
      for (const file of item.files) {
        const relativePath = file.relativePath === item.entryName ? 'SKILL.md' : file.relativePath
        const body = file.relativePath === item.entryName ? item.entry.text : file.body
        const destination = join(target, relativePath)
        if (!destination.startsWith(target + sep)) throw new Error(`${relativePath} escapes ${target}`)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, body, { encoding: 'utf8', flag: 'wx' })
      }

      // An install is not done until the file the provider will discover reads
      // back as the skill that was requested.
      const parsed = await parseFrontmatter(await readFile(join(target, 'SKILL.md'), 'utf8'))
      if (parsed?.data?.name !== item.name) {
        throw new Error(`read-back of ${target}/SKILL.md did not parse back to ${item.name}`)
      }
      installed.push({ name: item.name, directory: item.directory, path: target })
    } catch (error) {
      await rm(target, { recursive: true, force: true }).catch(() => {})
      failed.push({ directory: item.directory, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/**
 * Install skill directories through the REST API.
 *
 * One tree request per shared parent, then one raw fetch per file. For a
 * repository whose skills sit side by side that is a handful of requests for any
 * number of skills, and it needs no subprocess — so it also works under a
 * sandbox that denies `git` its TLS credentials.
 *
 * @param options - wiring plus the resolved ref and requested directories.
 * @returns `{ installed, skipped, failed }` collectors.
 */
async function installViaTree({ repo, ref, installRoot, token, signal, requested, provider, ctx }) {
  const { listTreePaths, fetchDirectoryFiles } = await import('./github.js')

  let directories = await discoverSkillDirectories({ repo, ref, requested, token, signal })
  if (directories.length === 0) {
    throw new Error(`${repo} has no top-level or skills/ directory containing ${ENTRY_NAMES.join(' or ')}`)
  }

  // One tree request covers every sibling; group by parent to keep it that way.
  const byParent = new Map()
  for (const item of directories) {
    const parent = item.directory.includes('/') ? item.directory.slice(0, item.directory.lastIndexOf('/')) : ''
    const list = byParent.get(parent) ?? []
    list.push(item)
    byParent.set(parent, list)
  }
  const treeCache = new Map()
  const filesOf = async (parent) => {
    if (!treeCache.has(parent)) treeCache.set(parent, await listTreePaths({ repo, ref, path: parent, token, signal }))
    return treeCache.get(parent)
  }

  const prepared = []
  for (const [parent, items] of byParent) {
    const files = await filesOf(parent)
    for (const item of items) {
      const prefix = `${item.directory}/`
      const entryFile = ENTRY_NAMES.map((name) => `${prefix}${name}`).find((candidate) => files.includes(candidate))
      if (entryFile === undefined) {
        ctx.logger.warn(`skill-market: ${item.directory} has no ${ENTRY_NAMES.join(' or ')}; skipped`)
        continue
      }
      const payload = await fetchDirectoryFiles({ repo, ref, directory: item.directory, files, token, signal })
      const entryName = entryFile.slice(prefix.length)
      const raw = payload.find((file) => file.relativePath === entryName)
      const entry = await normalizeEntry(raw.body, `${repo}/${entryFile}`)
      prepared.push({ ...item, entryName, entry, name: entry.name, files: payload })
    }
  }

  const installed = []
  const skipped = []
  const failed = []
  await writePrepared({ installRoot, prepared, installed, skipped, failed })
  if (installed.length > 0) provider.invalidate()
  return { installed, skipped, failed }
}

/**
 * Install one or more skill directories from a repository.
 *
 * The REST route is tried first and the git route is the fallback, because the
 * two fail in different environments: the API route needs quota but no
 * subprocess, while the git route needs no quota but a sandbox that lets `git`
 * reach the network.
 *
 * @param options - wiring.
 * @param options.ctx - host context, for logging.
 * @param options.provider - invalidated once after a successful batch.
 * @param options.installRoot - destination root.
 * @param options.repo - `owner/repo`.
 * @param options.ref - branch, tag, or commit; the default branch when omitted.
 * @param options.directories - directories to install; every skill directory when omitted.
 * @param options.token - optional GitHub token.
 * @param options.signal - cancellation.
 * @returns `{ repo, ref, transport, installed, skipped, failed }`.
 */
export async function installSkillDirectories({ ctx, provider, installRoot, repo, ref, directories, token, signal }) {
  const resolvedRef = ref ?? (await resolveDefaultBranchViaGit(repo))
  const requested = Array.isArray(directories) ? directories.filter((name) => typeof name === 'string' && name !== '') : []

  let result
  let transport = 'tree'
  try {
    result = await installViaTree({ repo, ref: resolvedRef, installRoot, token, signal, requested, provider, ctx })
  } catch (error) {
    ctx.logger.warn(
      `skill-market: API install of ${repo} failed (${error instanceof Error ? error.message : String(error)}); trying git`,
    )
    transport = 'git'
    result = await installViaGit({ repo, ref: resolvedRef, installRoot, requested, provider, ctx })
  }

  ctx.logger.info(
    `skill-market: ${repo}@${resolvedRef} via ${transport} -> installed ${result.installed.length}, ` +
      `skipped ${result.skipped.length}, failed ${result.failed.length}`,
  )
  return { repo, ref: resolvedRef, transport, ...result }
}

/**
 * Install skill directories by cloning the repository.
 *
 * The fallback transport. It materializes the requested paths only, so a
 * docs-heavy repository stays cheap, and it accepts a shared parent as well as
 * individual directories.
 *
 * @param options - wiring plus the resolved ref and requested directories.
 * @returns `{ installed, skipped, failed }` collectors.
 */
async function installViaGit({ repo, ref, installRoot, requested, provider, ctx }) {
  const working = await sparseClone({ repo, ref, directories: requested })
  const installed = []
  const skipped = []
  const failed = []
  try {
    const available = await listSkillDirectories(working)
    const chosen = requested.length > 0 ? available.filter((candidate) => requested.includes(candidate.directory)) : available
    if (chosen.length === 0) {
      const names = available.map((candidate) => candidate.directory)
      throw new Error(
        names.length === 0
          ? `${repo} has no directory containing ${ENTRY_NAMES.join(' or ')}`
          : `${repo} has no skill directory named ${requested.join(', ')}; it offers: ${names.join(', ')}`,
      )
    }
    const prepared = []
    for (const candidate of chosen) {
      const source = join(working, candidate.directory)
      const entry = await normalizeEntry(
        await readFile(join(source, candidate.entry), 'utf8'),
        `${repo}/${candidate.directory}/${candidate.entry}`,
      )
      prepared.push({
        ...candidate,
        entryName: candidate.entry,
        entry,
        name: entry.name,
        files: await readDirectoryFiles(source),
      })
    }
    await writePrepared({ installRoot, prepared, installed, skipped, failed })
  } finally {
    await rm(working, { recursive: true, force: true }).catch(() => {})
  }
  if (installed.length > 0) provider.invalidate()
  return { installed, skipped, failed }
}

/** Every file of a cloned skill directory, as `{ relativePath, body }` pairs. */
async function readDirectoryFiles(root) {
  const payload = []
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.isFile()) continue
      payload.push({ relativePath: relative(root, path).split(sep).join('/'), body: await readFile(path, 'utf8') })
    }
  }
  await walk(root)
  return payload
}

/** Re-exported so callers can resolve a skill's own entry file without duplicating the rule. */
export function entryNameOf(name) {
  return ENTRY_NAMES.includes(name) ? name : ENTRY_NAMES[0]
}

/** Path helpers the panel needs when it reports where a skill came from. */
export { basename, dirname, relative, sep }
