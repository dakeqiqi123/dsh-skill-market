/**
 * GitHub as a skill source.
 *
 * Two calls do the whole job: the tree API lists which SKILL.md files exist
 * without downloading any body, and the raw endpoint fetches exactly the one
 * body a user asked for. Nothing here writes to disk — installation lives in
 * `marketplace.js`, because reading a catalog and mutating the user's skill
 * directory are different trust levels.
 *
 * @module dsh-skill-market/github
 */

import { parseFrontmatter, parseInvocationPolicy, isSkillName } from './skill-file.js'

const API = 'https://api.github.com'
const RAW = 'https://raw.githubusercontent.com'

/** A skill discovered in a remote repository, before installation. */
/**
 * @typedef {object} RemoteSkill
 * @property {string} name - skill name from frontmatter.
 * @property {string} description - one-line description from frontmatter.
 * @property {string} path - repository-relative path of the SKILL.md.
 * @property {string} repo - `owner/repo`.
 * @property {string} ref - pinned ref the catalog was read at.
 */

/**
 * Parse a source spec.
 *
 * Accepted spellings:
 *   owner/repo
 *   owner/repo#ref
 *   owner/repo@ref
 *   https://github.com/owner/repo[/tree/<ref>]
 *
 * A missing ref stays empty, and discovery then resolves the repository's real
 * default branch. Defaulting to `main` looks harmless and is not: `master` is
 * still the default on plenty of repositories, and a wrong guess surfaces as a
 * 404 that reads like "the repository does not exist". `install()` reports the
 * ref it actually used, so a caller can pin it afterwards.
 *
 * @param spec - the spec text from config or UI.
 * @returns `{ repo, ref, path }`, where `ref` is '' when unspecified and `path` is a repository subdirectory filter ('' for the root).
 */
export function parseSourceSpec(spec) {
  let text = String(spec ?? '').trim()
  if (text === '') throw new Error('empty source spec')

  let path = ''
  const url = /^https?:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/.exec(text)
  if (url !== null) {
    const [, owner, repo, ref, sub] = url
    if (sub !== undefined) path = sub
    return { repo: `${owner}/${repo}`, ref: ref ?? '', path }
  }

  const at = text.indexOf('@')
  const hash = text.indexOf('#')
  let ref = ''
  if (hash >= 0) {
    ref = text.slice(hash + 1)
    text = text.slice(0, hash)
  } else if (at >= 0) {
    ref = text.slice(at + 1)
    text = text.slice(0, at)
  }
  const slash = text.indexOf('/')
  if (slash <= 0 || slash === text.length - 1) {
    throw new Error(`invalid source spec "${spec}"; expected owner/repo[#ref]`)
  }
  return { repo: text, ref, path }
}

/**
 * Resolve a repository's default branch.
 *
 * Called only when a spec names no ref, so the common case costs one extra API
 * request and the wrong-branch 404 disappears.
 *
 * @param options - repository and credentials.
 * @returns the default branch name (`main`, `master`, or whatever the repository declares).
 */
export async function resolveDefaultBranch({ repo, token, signal }) {
  const response = await request(`${API}/repos/${repo}`, { token, signal })
  const body = await response.json()
  const branch = body?.default_branch
  if (typeof branch !== 'string' || branch === '') {
    throw new Error(`${repo} did not report a default branch`)
  }
  return branch
}

/**
 * Call the GitHub API (or the raw host) with the shared headers.
 *
 * @param url - absolute URL.
 * @param options - token and cancellation.
 * @returns the response, after a status check that surfaces the API's own message.
 */
async function request(url, { token, signal, accept = 'application/vnd.github+json' }) {
  const headers = {
    accept,
    'user-agent': 'dsh-skill-market',
    'x-github-api-version': '2022-11-28',
  }
  const secret = token ?? process.env.DSH_SKILL_MARKET_TOKEN
  if (secret !== undefined && secret !== '') headers.authorization = `Bearer ${secret}`

  const response = await fetch(url, { headers, signal })
  if (response.ok) return response
  let detail = ''
  try {
    const body = await response.json()
    if (typeof body?.message === 'string') detail = `: ${body.message}`
  } catch {
    /* a non-JSON error body is already summarized by the status line */
  }
  if (response.status === 404) {
    throw new Error(`GitHub returned 404 for ${url}${detail} — check the repository name, the ref, and whether it is private`)
  }
  if (response.status === 403 || response.status === 429) {
    throw new Error(`GitHub rate limit or permission failure (${response.status})${detail} — set DSH_SKILL_MARKET_TOKEN to raise the limit`)
  }
  throw new Error(`GitHub request failed (${response.status})${detail}`)
}

/**
 * List every skill in a repository at a pinned ref.
 *
 * Only SKILL.md files are considered, using the same `**\/SKILL.md` rule the
 * built-in filesystem provider applies on disk. Frontmatter is fetched one file
 * at a time so the catalog is honest about names and descriptions: a tree entry
 * alone cannot tell whether a file is a real skill or a stray fixture.
 *
 * @param options - source, credentials, and cancellation.
 * @returns the remote skills, sorted by name.
 */
export async function listRemoteSkills({ spec, token, signal, onProgress }) {
  const parsed = parseSourceSpec(spec)
  const { repo, path } = parsed
  // An empty ref means "the repository's default branch", resolved rather than
  // guessed. Every skill carries the ref actually read, so `install` can reuse
  // exactly the revision the catalog showed.
  const ref = parsed.ref === '' ? await resolveDefaultBranch({ repo, token, signal }) : parsed.ref
  const treeResponse = await request(`${API}/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { token, signal })
  const tree = await treeResponse.json()
  if (tree?.truncated === true) {
    onProgress?.(`${repo}: GitHub truncated the tree listing; only part of the repository was searched`)
  }
  const prefix = path === '' ? '' : `${path.replace(/\/+$/, '')}/`
  const files = (Array.isArray(tree?.tree) ? tree.tree : [])
    .filter((entry) => entry?.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => entry.path)
    .filter((candidate) => candidate.endsWith('SKILL.md'))
    .filter((candidate) => prefix === '' || candidate.startsWith(prefix))
    // Bound the walk so a monorepo's fixtures and vendored copies do not flood
    // the catalog. A skill's resource files live beside its SKILL.md, so a real
    // skill is never much deeper than this.
    .filter((candidate) => candidate.split('/').length <= 6)

  const skills = []
  for (const file of files) {
    signal?.throwIfAborted()
    const body = await fetchRaw({ repo, ref, path: file, token, signal })
    const parsed = await parseFrontmatter(body)
    const name = parsed?.data?.name
    const description = parsed?.data?.description
    if (typeof name !== 'string' || typeof description !== 'string') {
      onProgress?.(`${repo}: ${file} skipped — frontmatter requires name and description`)
      continue
    }
    skills.push({ name, description, path: file, repo, ref })
  }
  skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return dedupeByName(skills, repo, onProgress)
}

/**
 * Collapse mirror copies of one skill into a single entry.
 *
 * Repositories that publish both `.dsh/skills/<name>/` and `skills/<name>/`
 * carry two byte-identical SKILL.md files, and installation is keyed by skill
 * name — so a duplicate row would offer an install that is guaranteed to fail
 * with "already installed". The first path in sorted order wins, which is
 * deterministic; the loser is reported rather than dropped silently.
 *
 * @param skills - sorted remote skills.
 * @param repo - repository label for the progress line.
 * @param onProgress - optional progress sink.
 * @returns the deduplicated list.
 */
function dedupeByName(skills, repo, onProgress) {
  const seen = new Map()
  const unique = []
  for (const skill of skills) {
    const first = seen.get(skill.name)
    if (first !== undefined) {
      onProgress?.(`${repo}: ${skill.path} skipped — "${skill.name}" is already offered from ${first}`)
      continue
    }
    seen.set(skill.name, skill.path)
    unique.push(skill)
  }
  return unique
}

/**
 * Fetch one file's text from the raw host.
 * @param options - repository coordinates and credentials.
 * @returns the file text.
 */
export async function fetchRaw({ repo, ref, path, token, signal }) {
  const url = `${RAW}/${repo}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`
  const response = await request(url, { token, signal, accept: 'text/plain' })
  return await response.text()
}

/**
 * List every blob at or under one repository path, using one tree request.
 *
 * `?recursive=1` on a tree that names a directory returns that directory's
 * entries **without** the requested prefix, so the caller-visible paths are
 * rebuilt here. Requesting a shared parent once is what keeps a whole-directory
 * install affordable: one request then covers every sibling skill, instead of
 * one request per skill.
 *
 * @param options - repository, pinned ref, and directory ('' for the root).
 * @returns repository-relative blob paths, sorted.
 */
export async function listTreePaths({ repo, ref, path = '', token, signal }) {
  const clean = path.replace(/^\/+|\/+$/g, '')
  const suffix = clean === '' ? '' : `:${clean}`
  const response = await request(`${API}/repos/${repo}/git/trees/${encodeURIComponent(ref)}${suffix}?recursive=1`, { token, signal })
  const tree = await response.json()
  const prefix = clean === '' ? '' : `${clean}/`
  return (Array.isArray(tree?.tree) ? tree.tree : [])
    .filter((entry) => entry?.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => `${prefix}${entry.path}`)
    .sort()
}

/**
 * Fetch every file of one skill directory.
 *
 * The whole set is returned before any of it is written, so a failure part way
 * cannot leave a half-populated skill on disk.
 *
 * @param options - repository, ref, skill directory, and the tree paths that cover it.
 * @returns `{ relativePath, body }` pairs.
 */
export async function fetchDirectoryFiles({ repo, ref, directory, files, token, signal }) {
  const prefix = `${directory.replace(/^\/+|\/+$/g, '')}/`
  const payload = []
  for (const file of files) {
    if (!file.startsWith(prefix)) continue
    signal?.throwIfAborted()
    const relativePath = file.slice(prefix.length)
    if (relativePath === '' || relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`${file} resolves outside the skill directory`)
    }
    payload.push({ relativePath, body: await fetchRaw({ repo, ref, path: file, token, signal }) })
  }
  return payload
}

/**
 * Fetch one skill body by repository path, validating it as a skill.
 *
 * @param options - repository coordinates and credentials.
 * @returns the parsed definition input (`{ name, description, content, path }`) plus the source label.
 */
export async function fetchRemoteSkill({ repo, ref, path, token, signal }) {
  const branch = ref === undefined || ref === '' ? await resolveDefaultBranch({ repo, token, signal }) : ref
  const body = await fetchRaw({ repo, ref: branch, path, token, signal })
  const parsed = await parseFrontmatter(body)
  if (parsed === undefined) throw new Error(`${repo}/${path} has no YAML frontmatter`)
  const name = parsed.data?.name
  const description = parsed.data?.description
  if (typeof name !== 'string' || !isSkillName(name)) throw new Error(`${repo}/${path} has an invalid skill name`)
  if (typeof description !== 'string' || description === '') throw new Error(`${repo}/${path} has no description`)
  const content = parsed.body.trim()
  if (content === '') throw new Error(`${repo}/${path} has an empty body`)
  return {
    name,
    description,
    content,
    invocation: parseInvocationPolicy(parsed.data),
    path,
    repo,
    // The resolved branch, not the empty input: `install()` reports this back so
    // the caller can pin the exact revision the catalog showed.
    ref: branch,
  }
}
