/**
 * Smoke test for the parts of the plugin that do not need a live Harness.
 *
 * It exercises the whole discovery path — directory scan, frontmatter parsing
 * (both the scalar fallback and, when resolvable, the real YAML parser),
 * candidate shape, and `get()` — against `test/fixtures`, and asserts the
 * specific behaviours a silent regression would break.
 *
 * Run with any Node 18+:
 *   node test/smoke.js
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

import { buildRoots, MarketSkillProvider, PROVIDER_NAME } from '../lib/provider.js'
import { isSkillName, parseScalarFrontmatter, splitFrontmatter } from '../lib/skill-file.js'
import { parseSourceSpec } from '../lib/github.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures')

let failures = 0
async function test(title, body) {
  try {
    await body()
    console.log(`ok   ${title}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${title}\n     ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** A context with only what the provider touches. */
function stubCtx() {
  const warnings = []
  return {
    warnings,
    logger: {
      warn: (line) => warnings.push(line),
      info: () => {},
    },
  }
}

await test('skill-name grammar matches the registry', () => {
  assert.equal(isSkillName('audit-report-review'), true)
  assert.equal(isSkillName('excel-helper'), true)
  assert.equal(isSkillName('Excel-Helper'), false)
  assert.equal(isSkillName('excel_helper'), false)
  assert.equal(isSkillName('-excel'), false)
  assert.equal(isSkillName('excel-'), false)
})

await test('splitFrontmatter separates the block from the body', () => {
  const split = splitFrontmatter('---\nname: a-b\ndescription: c\n---\n\n# Body\n')
  assert.equal(split.yamlText.trim(), 'name: a-b\ndescription: c')
  assert.equal(split.body.trim(), '# Body')
  assert.equal(splitFrontmatter('# no frontmatter\n'), undefined)
  assert.equal(splitFrontmatter('---\nname: a-b\n'), undefined)
})

await test('scalar frontmatter fallback parses the fields skills use', () => {
  const data = parseScalarFrontmatter(
    ['# a comment', 'name: audit-report-review', 'description: "带引号的描述 # 不是注释"', 'disable-model-invocation: true', 'notes:'].join('\n'),
  )
  assert.equal(data.name, 'audit-report-review')
  assert.equal(data.description, '带引号的描述 # 不是注释')
  assert.equal(data['disable-model-invocation'], true)
  assert.equal(data.notes, null)
})

await test('scalar frontmatter fallback skips nested blocks but keeps top-level keys', () => {
  // A real skill carries `metadata:` with an indented body. Nothing here reads
  // that field, so it is ignored instead of failing the whole file — but the
  // top-level keys must survive it.
  const nested = parseScalarFrontmatter(
    [
      'name: dsh-plugin-development',
      'description: Develop DSH plugins',
      'metadata:',
      '  version: "3.1.1"',
      '  date: "2026-09-06"',
      'disable-model-invocation: false',
    ].join('\n'),
  )
  assert.equal(nested.name, 'dsh-plugin-development')
  assert.equal(nested.description, 'Develop DSH plugins')
  assert.equal(nested['disable-model-invocation'], false)
  assert.equal(nested.version, undefined, 'an indented key is not a top-level key')

  assert.throws(() => parseScalarFrontmatter('not a mapping'), /key: value/)
})

await test('block scalars are read, because real descriptions use them', () => {
  // Literal style keeps its line breaks. `nigo81/nigo-skills` ships a skill whose
  // multi-line description is written this way; treating the marker as "no
  // value" silently dropped the text the skill menu shows.
  const literal = parseScalarFrontmatter(
    ['name: tianchuan-perspective', 'description: |', '  第一行', '  第二行', 'user-invocable: true'].join('\n'),
  )
  assert.equal(literal.name, 'tianchuan-perspective')
  assert.equal(literal.description, '第一行\n第二行')
  assert.equal(literal['user-invocable'], true)

  // Folded style joins a single break into a space and keeps a blank line.
  const folded = parseScalarFrontmatter('description: >\n  one\n  two\n\n  three\n')
  assert.equal(folded.description, 'one two\nthree')

  // Strip chomping (`|-`) and the default both end without a trailing newline.
  assert.equal(parseScalarFrontmatter('a: |-\n  x\n').a, 'x')
  assert.equal(parseScalarFrontmatter('a: |\n  x\n').a, 'x')

  // A blank line inside a literal body is part of the value, not the end of the
  // block, and it stays a line break rather than being folded. The next key's
  // scalar comes back as a string: this parser never coerces a bare number,
  // because the fields it reads are strings and booleans.
  const withBlank = parseScalarFrontmatter('a: |\n  x\n\n  y\nb: keep\n')
  assert.equal(withBlank.a, 'x\n\ny')
  assert.equal(withBlank.b, 'keep')

  // A deeper-indented body (2 spaces under a 2-space parent) still de-indents.
  assert.equal(parseScalarFrontmatter('a: |2\n    deep\n').a, '  deep')
})

await test('provider discovers both layouts and fills the candidate contract', async () => {
  const ctx = stubCtx()
  const provider = new MarketSkillProvider({ ctx, roots: [{ path: fixtures, source: 'market-local', rank: 350 }] })
  const candidates = await provider.list({})
  assert.equal(Array.isArray(candidates), true)
  assert.equal(candidates.length, 2, `expected 2 skills, got ${candidates.map((c) => c.name).join(', ')}`)

  const audit = candidates.find((candidate) => candidate.name === 'audit-report-review')
  assert.ok(audit, 'directory-bundle skill missing')
  assert.equal(audit.provider, PROVIDER_NAME)
  assert.equal(audit.source, 'market-local')
  assert.equal(audit.rank, 350)
  assert.equal(audit.invocation.modelInvocable, true)
  assert.equal(audit.invocation.userInvocable, true)
  assert.equal(audit.whenToUse, '当你拿到一份审计报告需要做一致性核对时')
  assert.match(audit.path, /audit-report-review[\\/]SKILL\.md$/)

  const excel = candidates.find((candidate) => candidate.name === 'excel-helper')
  assert.ok(excel, 'flat-markdown skill missing')
  assert.match(excel.path, /excel-helper\.md$/)
})

await test('provider loads a body and keeps the name stable', async () => {
  const ctx = stubCtx()
  const provider = new MarketSkillProvider({ ctx, roots: [{ path: fixtures, source: 'market-local', rank: 350 }] })
  const candidates = await provider.list({})
  const audit = candidates.find((candidate) => candidate.name === 'audit-report-review')
  const definition = await provider.get(audit, {})
  assert.equal(definition.name, audit.name)
  assert.equal(definition.provider, PROVIDER_NAME)
  assert.equal(definition.resourceBase.kind, 'directory')
  assert.equal(definition.content.startsWith('# 审计报告复核'), true)
  assert.equal(definition.content.includes('---'), false, 'frontmatter must not leak into the body')
})

await test('a broken file is skipped and reported, not fatal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-skill-market-smoke-'))
  try {
    await mkdir(join(dir, 'good'), { recursive: true })
    await writeFile(join(dir, 'good', 'SKILL.md'), '---\nname: good-skill\ndescription: fine\n---\n\nbody\n', 'utf8')
    await mkdir(join(dir, 'broken'), { recursive: true })
    await writeFile(join(dir, 'broken', 'SKILL.md'), '---\nname: Bad_Name\ndescription: nope\n---\n\nbody\n', 'utf8')
    await mkdir(join(dir, 'nofront'), { recursive: true })
    await writeFile(join(dir, 'nofront', 'SKILL.md'), '# just markdown\n', 'utf8')

    const ctx = stubCtx()
    const provider = new MarketSkillProvider({ ctx, roots: [{ path: dir, source: 'market-local', rank: 350 }] })
    const candidates = await provider.list({})
    assert.deepEqual(candidates.map((c) => c.name), ['good-skill'])
    assert.equal(ctx.warnings.length, 2, `expected 2 warnings, got ${JSON.stringify(ctx.warnings)}`)
    assert.match(ctx.warnings.join('\n'), /invalid skill name/)
    assert.match(ctx.warnings.join('\n'), /missing YAML frontmatter/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('a duplicate name resolves to the lowest-rank root', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-skill-market-dup-'))
  try {
    for (const [sub, description] of [['high', 'from rank 100'], ['low', 'from rank 400']]) {
      await mkdir(join(dir, sub, 'dup-skill'), { recursive: true })
      await writeFile(join(dir, sub, 'dup-skill', 'SKILL.md'), `---\nname: dup-skill\ndescription: ${description}\n---\n\nbody\n`, 'utf8')
    }
    const roots = buildRoots({ localDirs: [join(dir, 'low'), join(dir, 'high')], installRoot: join(dir, 'install'), rank: 350 })
    assert.deepEqual(roots.map((root) => root.rank), [350, 351, 352])
    const provider = new MarketSkillProvider({ ctx: stubCtx(), roots })
    const candidates = await provider.list({})
    const dup = candidates.filter((candidate) => candidate.name === 'dup-skill')
    assert.equal(dup.length, 1)
    assert.equal(dup[0].rank, 350, 'the lower rank must win')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('a missing root is empty, not an error', async () => {
  const ctx = stubCtx()
  const provider = new MarketSkillProvider({
    ctx,
    roots: [{ path: join(tmpdir(), 'dsh-skill-market-does-not-exist'), source: 'market-install', rank: 400 }],
  })
  assert.deepEqual(await provider.list({}), [])
  assert.equal(ctx.warnings.length, 0)
})

await test('source specs leave an unspecified ref empty so discovery can resolve it', () => {
  assert.deepEqual(parseSourceSpec('zimodzh/dsh-plugin-dev-skills'), { repo: 'zimodzh/dsh-plugin-dev-skills', ref: '', path: '' })
  assert.deepEqual(parseSourceSpec('owner/repo#v1.2.3'), { repo: 'owner/repo', ref: 'v1.2.3', path: '' })
  assert.deepEqual(parseSourceSpec('owner/repo@abc123'), { repo: 'owner/repo', ref: 'abc123', path: '' })
  assert.deepEqual(parseSourceSpec('https://github.com/owner/repo'), { repo: 'owner/repo', ref: '', path: '' })
  assert.deepEqual(parseSourceSpec('https://github.com/owner/repo/tree/v2/skills'), { repo: 'owner/repo', ref: 'v2', path: 'skills' })
  assert.throws(() => parseSourceSpec(''), /empty/)
  assert.throws(() => parseSourceSpec('no-slash-here'), /invalid source spec/)
})

console.log(failures === 0 ? '\nall smoke checks passed' : `\n${failures} smoke check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
