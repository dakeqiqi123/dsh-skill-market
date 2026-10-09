#!/usr/bin/env node
/**
 * Install whole skill directories from a GitHub repository.
 *
 * The marketplace's `install` action downloads exactly one SKILL.md, which is
 * only correct for a single-file skill. A directory-bundle skill — the common
 * shape — also ships `references/`, `scripts/`, `assets/` and templates that its
 * instructions reference by relative path, so installing just the entry file
 * produces a skill that reads fine and then fails on its first `scripts/…`
 * reference. This tool moves the whole directory instead.
 *
 * It is deliberately separate from `lib/marketplace.js` for now: the tool path
 * is on the skinflint side of a restart boundary, and this was needed before a
 * restart. Fold it into `MarketOperations` when the tool is next touched.
 *
 * Usage:
 *   node tools/install-skill-dir.js <owner/repo[#ref]> <dir> [<dir> ...]
 *   node tools/install-skill-dir.js nigo81/nigo-skills audit-report-checker tianchuan-perspective
 *
 * Options:
 *   --root <dir>   install root (default: $DSH_HOME/skills)
 *   --dry-run      report what would be written, then stop
 *
 * Behaviour:
 *   - an unspecified ref resolves to the repository's real default branch
 *   - a directory whose entry file is SKILL.md or skill.md is accepted
 *   - an entry file named skill.md is rewritten to SKILL.md, because the
 *     built-in filesystem provider only discovers `SKILL.md`
 *   - frontmatter is re-emitted through the same policy parser the provider
 *     uses, so an installed skill cannot smuggle fields this project ignores
 *   - an existing skill directory is never overwritten
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isSkillName, parseFrontmatter, parseInvocationPolicy } from '../lib/skill-file.js'
import { fetchRaw, resolveDefaultBranch } from '../lib/github.js'

const API = 'https://api.github.com'
const ENTRY_NAMES = ['SKILL.md', 'skill.md']
/** Repository paths are joined to a local root; refuse anything that could escape it. */
const UNSAFE_SEGMENT = /^(?:\.\.?|)$/

function parseArgs(argv) {
  const options = { root: undefined, dryRun: false, positionals: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--root') options.root = argv[++index]
    else if (argument.startsWith('--root=')) options.root = argument.slice('--root='.length)
    else options.positionals.push(argument)
  }
  return options
}

/** Split `owner/repo[#ref]` without pulling in the marketplace's path filter. */
function parseSpec(spec) {
  const text = String(spec ?? '').trim()
  const hash = text.indexOf('#')
  const repo = hash >= 0 ? text.slice(0, hash) : text
  const ref = hash >= 0 ? text.slice(hash + 1) : ''
  const slash = repo.indexOf('/')
  if (slash <= 0 || slash === repo.length - 1) {
    throw new Error(`invalid repository spec "${spec}"; expected owner/repo[#ref]`)
  }
  return { repo, ref }
}

async function api(path, token) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-skill-market' }
  if (typeof token === 'string' && token !== '') headers.authorization = `Bearer ${token}`
  const response = await fetch(`${API}${path}`, { headers })
  if (response.ok) return await response.json()
  let detail = ''
  try {
    const body = await response.json()
    if (typeof body?.message === 'string') detail = `: ${body.message}`
  } catch {
    /* a non-JSON error body is already summarized by the status line */
  }
  throw new Error(`GitHub ${response.status} for ${path}${detail}`)
}

/** Every blob under one repository directory, as repository-relative paths. */
async function listDirectory({ repo, ref, path, token }) {
  const tree = await api(`/repos/${repo}/git/trees/${encodeURIComponent(ref)}:${path}?recursive=1`, token)
  const prefix = path.replace(/\/+$/, '')
  return (Array.isArray(tree?.tree) ? tree.tree : [])
    .filter((entry) => entry?.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => `${prefix}/${entry.path}`)
    .sort()
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
 * Rewrite one downloaded SKILL.md.
 *
 * Frontmatter is parsed and re-emitted rather than passed through, for the same
 * reason the marketplace does it: an installed skill must carry only the fields
 * this project understands, and a remote file should not be able to inject a
 * policy the loader silently ignores.
 */
async function normalizeEntry(text, label) {
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

const options = parseArgs(process.argv.slice(2))
const [spec, ...directories] = options.positionals
if (spec === undefined || directories.length === 0) {
  console.error('usage: node tools/install-skill-dir.js <owner/repo[#ref]> <dir> [<dir> ...] [--root <dir>] [--dry-run]')
  process.exit(2)
}

const { repo, ref: specRef } = parseSpec(spec)
const token = process.env.DSH_SKILL_MARKET_TOKEN
const ref = specRef === '' ? await resolveDefaultBranch({ repo, token }) : specRef
const installRoot = resolve(options.root ?? process.env.DSH_SKILL_MARKET_ROOT ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'skills'))

console.log(`repo   ${repo}`)
console.log(`ref    ${ref}`)
console.log(`root   ${installRoot}`)
console.log(`files  ${directories.length} skill director${directories.length === 1 ? 'y' : 'ies'}${options.dryRun ? '  (dry run)' : ''}\n`)

let failures = 0

for (const directory of directories) {
  const label = `${repo}/${directory}`
  try {
    const files = await listDirectory({ repo, ref, path: directory, token })
    const entryPath = files.find((file) => ENTRY_NAMES.includes(file.slice(file.lastIndexOf('/') + 1)))
    if (entryPath === undefined) {
      throw new Error(`no ${ENTRY_NAMES.join(' or ')} found under ${directory}`)
    }

    const entry = await normalizeEntry(await fetchRaw({ repo, ref, path: entryPath, token }), `${repo}/${entryPath}`)
    const target = join(installRoot, entry.name)
    if (await exists(target)) throw new Error(`${target} already exists; remove it first to reinstall`)

    console.log(`${entry.name}`)
    console.log(`  from   ${directory}  (${files.length} file${files.length === 1 ? '' : 's'})`)
    console.log(`  entry  ${entryPath}${entryPath.endsWith('/skill.md') ? '  -> rewritten as SKILL.md' : ''}`)
    console.log(`  desc   ${entry.description}`)
    if (options.dryRun) {
      for (const file of files.slice(0, 8)) console.log(`  would write  ${relative(directory, file) || file}`)
      if (files.length > 8) console.log(`  ... ${files.length - 8} more`)
      console.log('')
      continue
    }

    // Download everything before writing anything, so a failure mid-listing
    // cannot leave a half-populated skill directory behind.
    const payload = []
    for (const file of files) {
      const relativePath = file.slice(directory.replace(/\/+$/, '').length + 1)
      const segments = relativePath.split('/')
      if (segments.some((segment) => UNSAFE_SEGMENT.test(segment))) {
        throw new Error(`${file} resolves outside the skill directory`)
      }
      const isEntry = file === entryPath
      payload.push({
        relativePath: isEntry ? 'SKILL.md' : relativePath,
        body: isEntry ? entry.text : await fetchRaw({ repo, ref, path: file, token }),
      })
    }

    await mkdir(target, { recursive: false }).catch((error) => {
      if (error?.code === 'EEXIST') throw new Error(`${target} appeared while installing; giving up`)
      throw error
    })
    try {
      for (const item of payload) {
        const destination = join(target, item.relativePath)
        if (!destination.startsWith(target + sep)) throw new Error(`${item.relativePath} escapes ${target}`)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, item.body, { encoding: 'utf8', flag: 'wx' })
      }
    } catch (error) {
      await rm(target, { recursive: true, force: true })
      throw error
    }

    // Read back the entry through the real parser: an install is not done until
    // the file the provider will discover parses as a skill.
    const parsed = await parseFrontmatter(await readFile(join(target, 'SKILL.md'), 'utf8'))
    if (parsed?.data?.name !== entry.name) throw new Error(`read-back of ${target}/SKILL.md did not parse back to ${entry.name}`)
    console.log(`  wrote  ${payload.length} file${payload.length === 1 ? '' : 's'} into ${target}`)
    console.log('')
  } catch (error) {
    failures += 1
    console.log(`${label}\n  FAILED  ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

console.log(failures === 0 ? 'done' : `${failures} director${failures === 1 ? 'y' : 'ies'} failed`)
process.exit(failures === 0 ? 0 : 1)
