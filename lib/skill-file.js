/**
 * SKILL.md discovery and frontmatter parsing.
 *
 * The layout and the frontmatter grammar are deliberately identical to
 * `@deepseek-ai/dsh-skill-filesystem`, which is the built-in provider every
 * other part of the Harness reads from:
 *
 *   directory bundle   <root>/<skill-name>/SKILL.md
 *   flat markdown      <root>/<skill-name>.md
 *
 * Frontmatter keys are the canonical hyphenated spellings. The legacy camelCase
 * spellings (`disableModelInvocation`, `modelInvocable`) are rejected on
 * purpose: the built-in provider rejects them too, and silently accepting them
 * here would produce skills that behave differently depending on which provider
 * happened to win.
 *
 * @module dsh-skill-market/skill-file
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Public skill-name grammar, byte-identical to the registry's own check. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Longest skill name this plugin will write.
 *
 * The registry does not cap skill names, but a name is a directory name, a `/`
 * token and a line in the model's catalog, so the plugin applies its own bound
 * and reports it when a rename exceeds it.
 */
export const SKILL_NAME_MAX = 64

/** Is `name` a valid kebab-case skill name? */
export function isSkillName(name) {
  return typeof name === 'string' && SKILL_NAME.test(name)
}

/**
 * Frontmatter key holding every name this skill carried before the current one,
 * oldest first. Written only by a rename and never cleared by anything else.
 */
export const ALIAS_KEY = 'aliases'

/**
 * Frontmatter key holding the name the skill carried before its first rename.
 * Written once, on that first rename, and left alone afterwards.
 */
export const ORIGINAL_KEY = 'original-name'

/**
 * Frontmatter key holding the name a person reads.
 *
 * It exists because the registry's own skill-name grammar is ASCII kebab-case —
 * `name` is what `skill` and the `/` token resolve, and a Chinese value there is
 * refused outright. So the readable name lives beside it: any text, typically
 * Chinese, shown by this plugin's picker and panel and used as the label of the
 * skill's `/` menu rows. The skill keeps being *called* by its technical name.
 */
export const DISPLAY_KEY = 'display-name'

/** Longest display name this plugin will write; it has to fit one menu row. */
export const DISPLAY_NAME_MAX = 40

/** Frontmatter keys the built-in provider accepts, mapped legacy -> canonical. */
const LEGACY_INVOCATION_KEYS = new Map([
  ['disableModelInvocation', 'disable-model-invocation'],
  ['modelInvocable', 'model-invocable'],
])

/**
 * Split a `---`-fenced frontmatter block off the body.
 *
 * Kept separate from parsing so the block can be handed to a real YAML parser
 * when one is importable, and to the scalar fallback when one is not.
 *
 * @param raw - full file text.
 * @returns the raw frontmatter text and the body, or undefined when there is no block.
 */
export function splitFrontmatter(raw) {
  const text = String(raw).replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return undefined
  const firstBreak = text.indexOf('\n')
  if (firstBreak < 0) return undefined
  const end = text.indexOf('\n---', firstBreak)
  if (end < 0) return undefined
  const afterFence = text.indexOf('\n', end + 1)
  return {
    yamlText: text.slice(firstBreak + 1, end),
    body: afterFence < 0 ? '' : text.slice(afterFence + 1),
  }
}

/**
 * Parse a frontmatter block into a mapping.
 *
 * A real YAML parser is used when `yaml` resolves, because skill frontmatter is
 * allowed to use full YAML. It usually will not resolve from a profile
 * directory, so a scalar fallback covers the `key: value` shape every skill in
 * practice uses. That fallback is deliberately narrow — it refuses nested
 * structures rather than guessing at them, so a skill that genuinely needs YAML
 * gets a readable "unavailable" message instead of a silently wrong policy.
 *
 * @param yamlText - the text between the fences.
 * @returns the parsed mapping.
 */
async function parseFrontmatterText(yamlText) {
  let parse
  try {
    ;({ parse } = await import('yaml'))
  } catch {
    parse = undefined
  }
  if (typeof parse === 'function') {
    const data = parse(yamlText) ?? {}
    if (typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('frontmatter must be a mapping')
    }
    return data
  }
  return parseScalarFrontmatter(yamlText)
}

/**
 * Parse `key: value` frontmatter without a YAML library.
 *
 * Supported values: quoted or bare scalars, `true`/`false`, and `null`/`~`/empty.
 * Comments and blank lines are skipped. Anything else throws, because a silent
 * mis-parse of `disable-model-invocation` would change which callers can see a
 * skill.
 *
 * @param yamlText - the text between the fences.
 * @returns the parsed mapping.
 */
export function parseScalarFrontmatter(yamlText) {
  const data = {}
  const lines = String(yamlText).split(/\r?\n/)
  /** Skip a nested block's body, or the continuation of an open quoted string. */
  let skippingIndented = false
  let openQuote
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (openQuote !== undefined) {
      if (line.includes(openQuote)) openQuote = undefined
      continue
    }

    if (/^\s/.test(line)) {
      // Indented lines belong to the previous key's nested block. Nested
      // structure is not this parser's job, so it is skipped rather than
      // rejected: a real skill may carry a `metadata:` block, and refusing the
      // whole file over a field nothing here reads would be worse than ignoring
      // that field. Skipping is only safe because the keys this module reads are
      // always top-level, and a top-level key can never be indented.
      skippingIndented = true
      continue
    }
    skippingIndented = false
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue

    const separator = line.indexOf(':')
    if (separator <= 0) throw new Error(`line ${index + 1} is not "key: value"`)
    const key = line.slice(0, separator).trim()
    const rawValue = stripComment(line.slice(separator + 1)).trim()

    // A block scalar is the one indented construct this module MUST read: a
    // multi-line `description:` is literal-style (`|`) in real skills, and
    // treating it as "no value" would silently drop the text the skill menu
    // shows. Folded style (`>`) is handled too, since the two differ only in how
    // line breaks are folded.
    const header = /^([|>])([-+]?)(\d*)$/.exec(rawValue)
    if (header !== null) {
      const [, style, chomp, explicitIndent] = header
      const body = []
      let cursor = index + 1
      for (; cursor < lines.length; cursor += 1) {
        const candidate = lines[cursor]
        if (candidate.trim() === '') {
          body.push('')
          continue
        }
        if (!/^\s/.test(candidate)) break
        body.push(candidate)
      }
      index = cursor - 1
      // Explicit indentation wins when given; otherwise the first non-empty
      // line's indent defines the block.
      const indent =
        explicitIndent === ''
          ? (body.find((entry) => entry.trim() !== '')?.match(/^\s*/)?.[0].length ?? 0)
          : Number(explicitIndent)
      const text = body.map((entry) => entry.slice(indent)).join('\n')
      data[key] = chomp === '-' ? trimTrailingBlank(text) : style === '>' ? foldBlock(text) : trimTrailingBlank(text)
      continue
    }

    if ((rawValue.startsWith('"') && !hasClosingQuote(rawValue, '"')) || (rawValue.startsWith("'") && !hasClosingQuote(rawValue, "'"))) {
      data[key] = rawValue.slice(1)
      openQuote = rawValue.startsWith('"') ? '"' : "'"
      continue
    }
    data[key] = scalarValue(rawValue)
  }
  return data
}

/** Remove the trailing newlines a literal block scalar keeps by default. */
function trimTrailingBlank(text) {
  return text.replace(/\n+$/, '')
}

/**
 * Fold a `>` block scalar: one line break becomes a space, a blank line becomes
 * one newline, and a more-indented line keeps its break.
 *
 * @param text - the de-indented block body.
 * @returns the folded scalar.
 */
function foldBlock(text) {
  const lines = trimTrailingBlank(text).split('\n')
  let result = ''
  let previousIndented = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const indented = /^\s/.test(line)
    if (index === 0) {
      result = line
    } else if (line === '') {
      result += '\n'
    } else if (!indented && !previousIndented && !result.endsWith('\n')) {
      result += ` ${line}`
    } else {
      result += `${result.endsWith('\n') ? '' : '\n'}${line}`
    }
    previousIndented = indented
  }
  return result
}

/** Whether a quoted scalar starting with `quote` is closed on the same line. */
function hasClosingQuote(value, quote) {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === '\\' && quote === '"') {
      index += 1
      continue
    }
    if (value[index] === quote) return true
  }
  return false
}

/** Drop a trailing ` #` comment that is outside quotes. */
function stripComment(value) {
  let quote
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' && index > 0 && /\s/.test(value[index - 1])) return value.slice(0, index)
  }
  return value
}

/** Convert one scalar spelling into its JavaScript value. */
function scalarValue(raw) {
  if (raw === '' || raw === '~' || raw === 'null') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    const inner = raw.slice(1, -1)
    return raw.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'")
  }
  return raw
}

/**
 * Strip and parse a `---`-fenced YAML frontmatter block.
 * @param raw - full file text.
 * @returns the parsed frontmatter data and the trimmed body, or undefined when there is no block.
 */
export async function parseFrontmatter(raw) {
  const split = splitFrontmatter(raw)
  if (split === undefined) return undefined
  return { data: await parseFrontmatterText(split.yamlText), body: split.body }
}

/** Read a boolean frontmatter field, rejecting non-boolean values. */
function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value !== 'boolean') {
    throw new TypeError(`frontmatter field "${key}" must be a boolean`)
  }
  return value
}

/** Read an optional string frontmatter field. */
function optionalString(data, key) {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Resolve the invocation policy from frontmatter.
 *
 * Model invocation is opt-out (`disable-model-invocation: true`) because a
 * skill is advertised to the model by default; user invocation is opt-out for
 * the same reason. Both flags are always materialized, because the registry
 * validates that both are present booleans.
 *
 * @param data - parsed frontmatter.
 * @returns the resolved `{ modelInvocable, userInvocable }`.
 */
export function parseInvocationPolicy(data) {
  for (const [legacy, canonical] of LEGACY_INVOCATION_KEYS) {
    if (Object.hasOwn(data, legacy)) {
      throw new Error(`frontmatter field "${legacy}" is unsupported; use "${canonical}"`)
    }
  }
  const disableModelInvocation = frontmatterBoolean(data, 'disable-model-invocation')
  const userInvocable = frontmatterBoolean(data, 'user-invocable')
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

/**
 * Read a frontmatter value that holds zero or more skill names.
 *
 * Three shapes have to work: a real YAML sequence (when the `yaml` package
 * resolves), a flow-style list written on one line (`[a, b]`, which is what this
 * plugin writes and what the scalar fallback hands back as a string), and a bare
 * scalar (`aliases: a`). Skill names cannot contain commas, so splitting a flow
 * list on `,` needs no quoting rules.
 *
 * @param value - the raw frontmatter value.
 * @returns the deduplicated names, in the order given.
 */
export function parseNameList(value) {
  if (value === undefined || value === null) return []
  const entries = Array.isArray(value) ? value : splitFlowList(value)
  const names = []
  for (const entry of entries) {
    const name = String(entry ?? '').trim().replace(/^["']|["']$/g, '')
    if (name === '' || names.includes(name)) continue
    names.push(name)
  }
  return names
}

/** One flow list's items, or the single scalar it actually is. */
function splitFlowList(value) {
  const text = String(value).trim()
  if (text.startsWith('[') && text.endsWith(']')) return text.slice(1, -1).split(',')
  return [text]
}

/**
 * Every name one skill carried before its current ones, oldest first.
 *
 * Both kinds of name count: the technical name a rename moves aside, and the
 * readable display name it replaces. Neither the current technical name nor the
 * current display name is listed as its own alias.
 *
 * @param record - `{ name, displayName?, aliases?, originalName? }` as read from frontmatter.
 * @returns the previous names, deduplicated.
 */
export function previousNamesOf(record) {
  const seen = new Set([record?.name])
  if (typeof record?.displayName === 'string' && record.displayName !== '') seen.add(record.displayName)
  const previous = []
  for (const candidate of [record?.originalName, ...(record?.aliases ?? [])]) {
    if (typeof candidate !== 'string' || candidate === '' || seen.has(candidate)) continue
    seen.add(candidate)
    previous.push(candidate)
  }
  return previous
}

/** The top-level key of one frontmatter line, or undefined for a nested/blank line. */
export function topLevelKey(line) {
  if (/^\s/.test(line)) return undefined
  const separator = line.indexOf(':')
  if (separator <= 0) return undefined
  return line.slice(0, separator).trim()
}

/**
 * Rewrite a skill's technical name, its readable name, and its rename record in
 * one frontmatter block.
 *
 * Only these keys are touched, and the order of everything else is preserved, so
 * a hand-written `description: |` block or a `metadata:` tree survives intact.
 * Values are written in the plainest YAML that both this plugin's scalar reader
 * and a real YAML parser read the same way.
 *
 * @param lines - frontmatter lines, without the fences.
 * @param record - `{ name, displayName?, originalName?, aliases? }` to store; an
 *   empty alias list or an empty display name removes that key. An absent display
 *   name key in `record` means "leave whatever is there".
 * @returns the rewritten lines.
 */
export function rewriteNameAndAliases(lines, record) {
  const wanted = new Map([['name', record.name]])
  if (typeof record.originalName === 'string' && record.originalName !== '') {
    wanted.set(ORIGINAL_KEY, record.originalName)
  }
  if (typeof record.displayName === 'string' && record.displayName !== '') {
    wanted.set(DISPLAY_KEY, record.displayName)
  }
  const aliases = Array.isArray(record.aliases) ? record.aliases.filter((entry) => typeof entry === 'string' && entry !== '') : []
  if (aliases.length > 0) wanted.set(ALIAS_KEY, `[${aliases.join(', ')}]`)
  const output = []
  const seen = new Set()
  for (const line of lines) {
    const key = topLevelKey(line)
    if (key !== undefined && wanted.has(key)) {
      seen.add(key)
      output.push(`${key}: ${wanted.get(key)}`)
      continue
    }
    // Reaching here with one of these keys means it is being cleared. The original
    // name is never dropped: it is only rewritten above when one is given.
    if (key === ALIAS_KEY || (key === DISPLAY_KEY && record.displayName !== undefined)) continue
    output.push(line)
  }
  for (const [key, value] of wanted) {
    if (seen.has(key)) continue
    output.push(`${key}: ${value}`)
  }
  return output
}

/**
 * Parse one skill file into the definition shape the registry validates.
 *
 * Returns `undefined` (never throws) for a file that is not a usable skill, so
 * one malformed file cannot fail a whole directory listing. The caller reports
 * the reason; discovery stays isolated per file.
 *
 * @param path - absolute path to `SKILL.md` or to a flat `<name>.md`.
 * @returns the parsed definition, or undefined with `reason` set.
 */
export async function parseSkillFile(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') return undefined
    throw error
  }
  let parsed
  try {
    parsed = await parseFrontmatter(raw)
  } catch (error) {
    return { reason: `invalid YAML frontmatter: ${message(error)}` }
  }
  if (parsed === undefined) return { reason: 'missing YAML frontmatter' }

  const name = optionalString(parsed.data, 'name')
  const description = optionalString(parsed.data, 'description')
  if (name === undefined || description === undefined) {
    return { reason: 'frontmatter requires name and description' }
  }
  if (!isSkillName(name)) return { reason: `invalid skill name "${name}"` }

  let invocation
  try {
    invocation = parseInvocationPolicy(parsed.data)
  } catch (error) {
    return { reason: `invalid invocation frontmatter: ${message(error)}` }
  }

  const whenToUse = optionalString(parsed.data, 'whenToUse')
  // The readable name and the rename record, when there are any. A skill that was
  // never renamed and never given a display name carries none of these keys, so
  // every field stays absent and the panel shows nothing extra.
  const displayName = optionalString(parsed.data, DISPLAY_KEY)
  const aliases = parseNameList(parsed.data[ALIAS_KEY]).filter((entry) => entry !== name)
  const originalName = optionalString(parsed.data, ORIGINAL_KEY)
  return {
    name,
    description,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    invocation,
    path,
    content: parsed.body.trim(),
    ...(displayName === undefined ? {} : { displayName }),
    ...(aliases.length === 0 ? {} : { aliases }),
    ...(originalName === undefined ? {} : { originalName }),
  }
}

/**
 * Enumerate skill files under one root.
 *
 * Both layouts are supported in the same root; a directory entry named
 * `<name>/SKILL.md` and a file entry named `<name>.md` are peers. Unreadable
 * roots yield no entries rather than an error, so a configured directory that
 * does not exist yet is not a failure.
 *
 * @param root - absolute directory to scan.
 * @returns absolute paths of candidate skill files.
 */
export async function listSkillFiles(root) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
    throw error
  }
  const files = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(join(path, 'SKILL.md'))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(path)
  }
  return files
}

/** Whether a path is an existing regular file. */
export async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Message of an unknown thrown value. */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
