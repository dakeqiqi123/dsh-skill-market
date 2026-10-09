#!/usr/bin/env node
/**
 * Install whole skill directories from a GitHub repository, from the command line.
 *
 * Thin argument parser over `lib/git-install.js`, which the management panel also
 * calls. Both therefore accept the same layouts, apply the same frontmatter
 * policy, and give the same refusals — a second implementation would drift and
 * only one of them would keep the path guards right.
 *
 * The git route exists because the REST API's unauthenticated limit (60
 * requests/hour per IP) runs out after listing a handful of directories, and the
 * failure looks like "the repository does not exist".
 *
 * Usage:
 *   node tools/install-skill-dir-git.js <owner/repo[#ref]> <dir> [<dir> ...]
 *   node tools/install-skill-dir-git.js <owner/repo> --list        # list its skill directories
 *   node tools/install-skill-dir-git.js <owner/repo> --all         # install every skill directory
 *
 * Options:
 *   --root <dir>   install root (default: $DSH_HOME/skills)
 *   --dry-run      report what would be installed, then stop
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { installSkillDirectories, listSkillDirectories, resolveDefaultBranchViaGit, sparseClone } from '../lib/git-install.js'
import { rm } from 'node:fs/promises'

function parseArgs(argv) {
  const options = { root: undefined, dryRun: false, list: false, all: false, positionals: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--list') options.list = true
    else if (argument === '--all') options.all = true
    else if (argument === '--root') options.root = argv[++index]
    else if (argument.startsWith('--root=')) options.root = argument.slice('--root='.length)
    else options.positionals.push(argument)
  }
  return options
}

/** Split `owner/repo[#ref]`. */
function parseSpec(spec) {
  const text = String(spec ?? '').trim()
  const hash = text.indexOf('#')
  const repo = hash >= 0 ? text.slice(0, hash) : text
  const ref = hash >= 0 ? text.slice(hash + 1) : ''
  if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error(`invalid repository spec "${spec}"; expected owner/repo[#ref]`)
  return { repo, ref }
}

const quietLogger = { info: () => {}, warn: (line) => console.log(`  warn: ${line}`) }

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [spec, ...directories] = options.positionals
  if (spec === undefined || (directories.length === 0 && !options.list && !options.all)) {
    console.error('usage: node tools/install-skill-dir-git.js <owner/repo[#ref]> <dir> [<dir> ...]')
    console.error('       node tools/install-skill-dir-git.js <owner/repo> --list | --all')
    console.error('options: --root <dir>  --dry-run')
    process.exit(2)
  }

  const { repo, ref: specRef } = parseSpec(spec)
  const installRoot = resolve(
    options.root ?? process.env.DSH_SKILL_MARKET_ROOT ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'skills'),
  )
  const ref = specRef === '' ? await resolveDefaultBranchViaGit(repo) : specRef

  console.log(`repo   ${repo}`)
  console.log(`ref    ${ref}`)
  console.log(`root   ${installRoot}`)
  console.log('method REST tree (one request per shared parent; git clone is the fallback)\n')

  if (options.list || options.dryRun) {
    // Discovery prefers the API route: it needs no subprocess, and a confined
    // sandbox denies `git` the TLS credentials it would need here.
    let available
    try {
      const { discoverSkillDirectories } = await import('../lib/git-install.js')
      available = await discoverSkillDirectories({
        repo,
        ref,
        requested: options.all || directories.length === 0 ? [] : directories,
      })
    } catch (error) {
      console.log(`  API discovery failed (${error instanceof Error ? error.message : String(error)}); trying git`)
      const working = await sparseClone({ repo, ref, directories: options.all || directories.length === 0 ? [] : directories })
      try {
        available = await listSkillDirectories(working)
      } finally {
        await rm(working, { recursive: true, force: true }).catch(() => {})
      }
    }
    if (available.length === 0) {
      console.log(`no directory under ${repo} contains SKILL.md or skill.md`)
    } else {
      for (const entry of available) { const name = entry.entry ?? entry.entryName; console.log(`  ${entry.directory.padEnd(34)}${name === undefined ? "" : ` entry=${name}`}`) }
      console.log(`\n${available.length} skill director${available.length === 1 ? 'y' : 'ies'}`)
    }
    if (options.list) return 0
    console.log('\n(dry run: nothing was written)')
    return 0
  }

  // A stand-in provider: the CLI has no registry to invalidate.
  const provider = { invalidate: () => {} }
  const result = await installSkillDirectories({
    ctx: { logger: quietLogger },
    provider,
    installRoot,
    repo,
    ref,
    directories: options.all ? undefined : directories,
  })

  for (const item of result.installed) console.log(`  installed  ${item.name}  <- ${item.directory}`)
  for (const item of result.skipped) console.log(`  skipped    ${item.name}  (${item.reason})`)
  for (const item of result.failed) console.log(`  FAILED     ${item.directory}  ${item.error}`)

  const total = result.installed.length + result.skipped.length + result.failed.length
  console.log(
    `\n${result.installed.length} installed, ${result.skipped.length} skipped, ${result.failed.length} failed (of ${total})`,
  )
  return result.failed.length === 0 ? 0 : 1
}

process.exit(await main())
