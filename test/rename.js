// Rename behaviour, exercised against a throwaway install root: the physical move,
// the record the skill keeps in its own frontmatter, the validation, the usage
// migration, and the alias entry that keeps the old name resolvable.
//
//   node test/rename.js
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillManager } from '../lib/manage.js'
import { buildRoots, MarketSkillProvider } from '../lib/provider.js'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail === '' ? '' : `  ${detail}`}`)
  if (!ok) failures += 1
}

const skillText = (name, description = 'A skill used by the rename test') =>
  ['---', `name: ${name}`, `description: ${description}`, 'whenToUse: 当需要测试重命名时', '---', '', `Body of ${name}.`, ''].join('\n')

const scratch = await mkdtemp(join(tmpdir(), 'dsh-skill-rename-'))
const installRoot = join(scratch, 'skills')
const logger = { info: () => {}, warn: (line) => console.log(`  warn: ${line}`), error: () => {} }
const provider = new MarketSkillProvider({
  ctx: { logger },
  roots: buildRoots({ localDirs: [], installRoot, rank: 350 }),
})
const manager = new SkillManager({
  ctx: { logger, get: () => undefined },
  provider,
  installRoot,
  localDirs: [],
  dataDir: join(scratch, 'skill-market'),
})

/** The frontmatter of one skill file, as text. */
const frontmatterOf = async (path) => {
  const text = await readFile(path, 'utf8')
  return text.slice(0, text.indexOf('\n---', 3))
}

/** Run one rename and return the failure message, or undefined on success. */
const refusal = async (path, name) => {
  try {
    await manager.renameSkill({ path, name })
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Run one display-name change and return the failure message, or undefined. */
const displayRefusal = async (path, displayName) => {
  try {
    await manager.renameSkill({ path, displayName })
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

try {
  await mkdir(join(installRoot, 'demo-skill'), { recursive: true })
  await writeFile(join(installRoot, 'demo-skill', 'SKILL.md'), skillText('demo-skill'), 'utf8')
  await mkdir(join(installRoot, 'other-skill'), { recursive: true })
  await writeFile(join(installRoot, 'other-skill', 'SKILL.md'), skillText('other-skill'), 'utf8')
  await writeFile(join(installRoot, 'flat-skill.md'), skillText('flat-skill'), 'utf8')

  // --- the physical move ------------------------------------------------------
  const first = await manager.renameSkill({ path: join(installRoot, 'demo-skill', 'SKILL.md'), name: 'demo-renamed' })
  check('the directory follows the new name', first.path === join(installRoot, 'demo-renamed', 'SKILL.md'), first.path)
  let front = await frontmatterOf(first.path)
  check('the frontmatter carries the new name', /^name: demo-renamed$/m.test(front))
  check('the first name is recorded as the original', /^original-name: demo-skill$/m.test(front))
  check('the alias list holds the abandoned name', /^aliases: \[demo-skill\]$/m.test(front))
  check('the body survives the rewrite', (await readFile(first.path, 'utf8')).includes('Body of demo-skill.'))
  check('the report names both sides', first.from === 'demo-skill' && first.name === 'demo-renamed', JSON.stringify(first.previousNames))

  // --- a second rename appends instead of overwriting -------------------------
  const second = await manager.renameSkill({ path: first.path, name: 'demo-third' })
  front = await frontmatterOf(second.path)
  check('a second rename keeps the first name too', /^aliases: \[demo-skill, demo-renamed\]$/m.test(front), front.split('\n').join(' | '))
  check('the original name never moves', /^original-name: demo-skill$/m.test(front))

  // --- renaming back to the original ------------------------------------------
  const back = await manager.renameSkill({ path: second.path, name: 'demo-skill' })
  front = await frontmatterOf(back.path)
  check('renaming back takes the current name out of the alias list', /^aliases: \[demo-renamed, demo-third\]$/m.test(front), front.split('\n').join(' | '))
  check('the original name is still recorded', /^original-name: demo-skill$/m.test(front))
  check('the directory came back', back.path === join(installRoot, 'demo-skill', 'SKILL.md'), back.path)

  // --- the flat layout ---------------------------------------------------------
  const flat = await manager.renameSkill({ path: join(installRoot, 'flat-skill.md'), name: 'flat-renamed' })
  check('a flat skill file follows the new name', flat.path === join(installRoot, 'flat-renamed.md'), flat.path)
  check('the flat file keeps a body', (await readFile(flat.path, 'utf8')).includes('Body of flat-skill.'))

  // --- validation --------------------------------------------------------------
  const target = join(installRoot, 'demo-skill', 'SKILL.md')
  check('an empty name is refused', /must not be empty/.test(await refusal(target, '   ')))
  check('a non-kebab name is refused', /not a skill name/.test(await refusal(target, 'Demo_Skill')))
  check('a too long name is refused', /limit is 64/.test(await refusal(target, 'a'.repeat(65))))
  check('the current name is refused', /nothing to change/.test(await refusal(target, 'demo-skill')))
  check('a name in use is refused', /already used by the skill at/.test(await refusal(target, 'other-skill')))
  check(
    'another skill’s previous name is refused',
    /carried before and is kept for it/.test(await refusal(join(installRoot, 'other-skill', 'SKILL.md'), 'demo-renamed')),
  )
  check(
    'a file outside the writable roots is refused',
    /outside the directories this plugin may modify/.test(await refusal(join(scratch, 'loose.md'), 'loose-renamed')),
  )

  // --- usage history follows the skill -----------------------------------------
  await manager.recordUse({ name: 'other-skill' })
  const moved = await manager.renameSkill({ path: join(installRoot, 'other-skill', 'SKILL.md'), name: 'other-renamed' })
  const usage = await manager.readUsage()
  check('usage moves to the new name', usage.used['other-renamed'] !== undefined && usage.used['other-skill'] === undefined, JSON.stringify(usage.used))
  check('the rename reports the new path', moved.path === join(installRoot, 'other-renamed', 'SKILL.md'), moved.path)

  // --- the alias entry the provider publishes -----------------------------------
  const listed = await provider.list({})
  const candidates = Array.isArray(listed) ? listed : listed.candidates
  const alias = candidates.find((entry) => entry.name === 'demo-renamed')
  check('the provider publishes the previous name', alias !== undefined)
  check('the alias points at its skill', alias?.aliasOf === 'demo-skill', String(alias?.aliasOf))
  check('the alias sits in the bottom rank band', alias?.rank === 900, String(alias?.rank))
  check('the alias says where it comes from', typeof alias?.description === 'string' && alias.description.startsWith('曾用名 demo-skill'), String(alias?.description))
  const loaded = await provider.get(alias)
  check('the alias loads under the name it was asked for', loaded?.name === 'demo-renamed', String(loaded?.name))
  check('the alias serves the real body', typeof loaded?.content === 'string' && loaded.content.includes('Body of demo-skill.'))
  check('a current name is still listed normally', candidates.some((entry) => entry.name === 'demo-skill' && entry.aliasOf === undefined))

  // --- the panel listing: no duplicate rows, previous names attached ------------
  const listing = await manager.list()
  const names = listing.skills.map((entry) => entry.name)
  check('the listing has no alias rows', !names.includes('demo-renamed') && !names.includes('demo-third'), names.join(','))
  const owner = listing.skills.find((entry) => entry.name === 'demo-skill')
  check('the owner carries its previous names', JSON.stringify(owner?.previousNames) === JSON.stringify(['demo-renamed', 'demo-third']), JSON.stringify(owner?.previousNames))
  const clean = listing.skills.find((entry) => entry.name === 'flat-renamed')
  check('a skill renamed once reports one previous name', JSON.stringify(clean?.previousNames) === JSON.stringify(['flat-skill']), JSON.stringify(clean?.previousNames))
  check('every row carries the fields the panel needs', listing.skills.every((entry) => typeof entry.writable === 'boolean' && typeof entry.installed === 'boolean'))

  // --- the display name: Chinese, leading the row, keeping the token ------------
  const displayTarget = join(installRoot, 'demo-skill', 'SKILL.md')
  const named = await manager.renameSkill({ path: displayTarget, displayName: '审计报告复核' })
  check('a display name does not move the skill', named.path === displayTarget, named.path)
  check('the report carries both names', named.name === 'demo-skill' && named.displayName === '审计报告复核', JSON.stringify(named))
  front = await frontmatterOf(displayTarget)
  check('the technical name is untouched', /^name: demo-skill$/m.test(front))
  check('the display name is written beside it', /^display-name: 审计报告复核$/m.test(front), front.split('\n').join(' | '))
  check('a display name alone rewrites no alias list', /^aliases: \[demo-renamed, demo-third\]$/m.test(front), front.split('\n').join(' | '))
  check('the body is still there', (await readFile(displayTarget, 'utf8')).includes('Body of demo-skill.'))

  const renamedDisplay = await manager.renameSkill({ path: displayTarget, displayName: '财报复核' })
  front = await frontmatterOf(displayTarget)
  check(
    'a replaced display name joins the record',
    /^display-name: 财报复核$/m.test(front) && /^aliases: \[demo-renamed, demo-third, 审计报告复核\]$/m.test(front),
    front.split('\n').join(' | '),
  )
  check(
    'the previous display name is reported',
    JSON.stringify(renamedDisplay.previousNames) === JSON.stringify(['demo-renamed', 'demo-third', '审计报告复核']),
    JSON.stringify(renamedDisplay.previousNames),
  )

  const bothAtOnce = await manager.renameSkill({ path: displayTarget, name: 'audit-review', displayName: '审计复核' })
  front = await frontmatterOf(bothAtOnce.path)
  check('one call can change both names', /^name: audit-review$/m.test(front) && /^display-name: 审计复核$/m.test(front), front.split('\n').join(' | '))
  check('the directory followed the technical name', bothAtOnce.path === join(installRoot, 'audit-review', 'SKILL.md'), bothAtOnce.path)
  check(
    'both abandoned names are kept',
    JSON.stringify(bothAtOnce.previousNames) === JSON.stringify(['demo-renamed', 'demo-third', '审计报告复核', 'demo-skill', '财报复核']),
    JSON.stringify(bothAtOnce.previousNames),
  )

  // Another skill takes a display name of its own, so the collision rule has something to hit.
  await manager.renameSkill({ path: join(installRoot, 'other-renamed', 'SKILL.md'), displayName: '问答检索' })

  // --- display-name validation --------------------------------------------------
  check('a too long display name is refused', /at most 40/.test(await displayRefusal(bothAtOnce.path, '显'.repeat(41))))
  check('a multi-line display name is refused', /one line without control characters/.test(await displayRefusal(bothAtOnce.path, '第一行\n第二行')))
  check('a display name another skill shows is refused', /already the display name of/.test(await displayRefusal(bothAtOnce.path, '问答检索')))
  check('a Chinese name on the technical side is refused', /not a skill name/.test(await refusal(bothAtOnce.path, '中文名')))

  // --- what the provider publishes ----------------------------------------------
  const listedAfter = await provider.list({})
  const after = Array.isArray(listedAfter) ? listedAfter : listedAfter.candidates
  const ownerAfter = after.find((entry) => entry.name === 'audit-review')
  check('the candidate carries the display name', ownerAfter?.displayName === '审计复核', String(ownerAfter?.displayName))
  check(
    'a Chinese display name is never published as an entry',
    after.every((entry) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)),
    after.map((entry) => entry.name).join(','),
  )
  check('a previous technical name stays published', after.some((entry) => entry.name === 'demo-skill' && entry.aliasOf === 'audit-review'))

  const finalListing = await manager.list()
  const finalRow = finalListing.skills.find((entry) => entry.name === 'audit-review')
  check('the panel row carries both names', finalRow?.displayName === '审计复核' && finalRow?.name === 'audit-review', JSON.stringify(finalRow?.displayName))
  check('the panel row carries the Chinese previous name', (finalRow?.previousNames ?? []).includes('审计报告复核'), JSON.stringify(finalRow?.previousNames))

  const cleared = await manager.renameSkill({ path: bothAtOnce.path, displayName: '' })
  front = await frontmatterOf(bothAtOnce.path)
  check('an empty display name clears the key', !/^display-name:/m.test(front), front.split('\n').join(' | '))
  check('the cleared name is still recorded', JSON.stringify(cleared.previousNames).includes('审计复核'), JSON.stringify(cleared.previousNames))
} finally {
  await rm(scratch, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nrename checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
