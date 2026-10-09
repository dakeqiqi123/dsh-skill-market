// Exercise the host command handler's logic directly: the panel's list payload,
// hidden toggling, and the install path, all without the Harness running.
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const { MarketSkillProvider } = await import('../lib/provider.js')
const { installSkillDirectories } = await import('../lib/git-install.js')

const installRoot = join(homedir(), '.dsh', 'skills')
const localDirs = []
const hidden = { names: [] }
const provider = new MarketSkillProvider({
  ctx: { logger: { info: () => {}, warn: (line) => console.log(`  warn: ${line}`) } },
  roots: [{ path: installRoot, source: 'market-install', rank: 352 }],
  hidden,
})

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail === '' ? '' : `  ${detail}`}`)
  if (!ok) failures += 1
}

// list payload shape, as the command builds it
const discovered = await provider.list({})
const candidates = Array.isArray(discovered) ? discovered : discovered.candidates
const payload = candidates.map((candidate) => ({
  name: candidate.name,
  description: candidate.description,
  source: candidate.source,
  hidden: hidden.names.includes(candidate.name),
  installed: typeof candidate.path === 'string' && candidate.path.startsWith(installRoot),
}))
check('list returns skills', payload.length > 0, `${payload.length} skills`)
check('every entry has a name and description', payload.every((item) => item.name && item.description))
check('every entry is annotated', payload.every((item) => typeof item.hidden === 'boolean' && typeof item.installed === 'boolean'))
check('entries come from the install root', payload.every((item) => item.source === 'market-install'))

// hidden toggling behaves as a discovery filter
const victim = payload[0].name
hidden.names = [victim]
provider.invalidate()
const afterHide = (await provider.list({})).map((item) => item.name)
check('hiding removes it from discovery', !afterHide.includes(victim), `${afterHide.length} skills`)
hidden.names = []
provider.invalidate()
const afterShow = (await provider.list({})).map((item) => item.name)
check('unhiding restores it', afterShow.includes(victim), `${afterShow.length} skills`)

// the install path into a throwaway root, exercising the tree transport
const scratch = await mkdtemp(join(tmpdir(), 'dsh-panel-install-'))
try {
  const scratchProvider = new MarketSkillProvider({
    ctx: { logger: { info: () => {}, warn: () => {} } },
    roots: [{ path: scratch, source: 'market-install', rank: 352 }],
    hidden,
  })
  const result = await installSkillDirectories({
    ctx: { logger: { info: () => {}, warn: (line) => console.log(`  warn: ${line}`) } },
    provider: scratchProvider,
    installRoot: scratch,
    repo: 'nigo81/nigo-skills',
    directories: ['chenyiwei-bbs'],
  })
  check('install wrote the skill', result.installed.length === 1, `transport=${result.transport}`)
  check('install reported no failures', result.failed.length === 0, JSON.stringify(result.failed))
  const seen = await scratchProvider.list({})
  check('provider discovers the fresh install', seen.some((item) => item.name === 'chenyiwei-bbs'))
} finally {
  await rm(scratch, { recursive: true, force: true })
}

console.log(failures === 0 ? '\npanel logic checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
