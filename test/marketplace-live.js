/**
 * Live check of the marketplace over the real network.
 *
 * The tool wrapper cannot be exercised without the Harness running, but every
 * operation underneath it can: this drives `MarketOperations` directly against
 * a real public repository and a temporary install root, so the GitHub path is
 * proven before anyone restarts the app to load the tool.
 *
 * Writes only under a throwaway temp directory.
 *
 * Run: node test/marketplace-live.js [owner/repo]
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

import { MarketOperations } from '../lib/marketplace.js'
import { MarketSkillProvider } from '../lib/provider.js'

const spec = process.argv[2] ?? 'zimodzh/dsh-plugin-dev-skills'
const ctx = { logger: { info: () => {}, warn: (line) => console.log(`  warn: ${line}`) } }

const root = await mkdtemp(join(tmpdir(), 'dsh-skill-market-live-'))
const provider = new MarketSkillProvider({
  ctx,
  roots: [{ path: root, source: 'market-install', rank: 352 }],
})
const market = new MarketOperations({ ctx, provider, installRoot: root, sources: [spec], token: undefined })

let failures = 0
const step = async (title, body) => {
  try {
    await body()
    console.log(`ok   ${title}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${title}\n     ${error instanceof Error ? error.message : String(error)}`)
  }
}

try {
  console.log(`source: ${spec}\nroot:   ${root}\n`)

  let installed = null

  await step('catalog reads the repository tree and its frontmatter', async () => {
    const catalog = await market.catalog({ onProgress: (line) => console.log(`  ${line}`) })
    assert.equal(catalog.sources.length, 1)
    const source = catalog.sources[0]
    assert.equal(source.ok, true, `source failed: ${source.error}`)
    assert.ok(source.skills.length > 0, 'no SKILL.md found in the repository')
    console.log(`     repo=${source.repo} ref=${source.ref} skills=${source.skills.length}`)
    for (const skill of source.skills.slice(0, 5)) console.log(`     - ${skill.name}  (${skill.path})`)
    installed = source.skills[0]
    assert.match(installed.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  await step('search filters by name and description', async () => {
    const needle = 'plugin'
    const { matches } = await market.search({ query: needle })
    assert.ok(matches.length > 0, `no match for "${needle}"`)
    assert.ok(matches.every((m) => `${m.name} ${m.description}`.toLowerCase().includes(needle)))
    console.log(`     ${matches.length} match(es) for "${needle}"`)
  })

  await step('install writes SKILL.md into the install root', async () => {
    assert.ok(installed, 'catalog produced no skill to install')
    const result = await market.install({ repo: installed.repo, ref: installed.ref, path: installed.path })
    assert.equal(result.installed, true)
    assert.equal(result.name, installed.name)
    const text = await readFile(result.path, 'utf8')
    assert.ok(text.startsWith('---\n'), 'installed file must keep frontmatter')
    assert.ok(text.includes(`name: ${installed.name}`), 'installed frontmatter must name the skill')
    console.log(`     wrote ${result.path} (${text.length} bytes)`)
  })

  await step('the provider discovers the installed skill', async () => {
    const candidates = await provider.list({})
    const list = Array.isArray(candidates) ? candidates : candidates.candidates
    assert.ok(
      list.some((candidate) => candidate.name === installed.name),
      `provider did not see ${installed.name}; got ${list.map((c) => c.name).join(', ') || '(none)'}`,
    )
    console.log(`     discovered: ${list.map((c) => c.name).join(', ')}`)
  })

  await step('install refuses to overwrite an existing skill', async () => {
    await assert.rejects(
      () => market.install({ repo: installed.repo, ref: installed.ref, path: installed.path }),
      /already installed/,
    )
  })

  await step('remove refuses to delete a skill it did not install', async () => {
    const foreign = await market.remove({ name: 'not-installed-by-us' })
    assert.equal(foreign.removed, false)
    assert.ok(foreign.reason, 'a refusal must carry a reason')
    console.log(`     refused: ${foreign.reason}`)
  })

  await step('remove deletes the skill it installed', async () => {
    const result = await market.remove({ name: installed.name })
    assert.equal(result.removed, true)
    await assert.rejects(() => stat(join(root, installed.name)), /ENOENT/)
  })

  await step('a bad spec fails with a readable message', async () => {
    await assert.rejects(() => market.install({ repo: 'no-slash', path: 'a/SKILL.md' }), /owner\/repo/)
    await assert.rejects(() => market.install({ repo: 'owner/repo-does-not-exist-xyz', path: 'a/SKILL.md' }), /404/)
  })
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nlive marketplace checks passed' : `\n${failures} live check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
