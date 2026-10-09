#!/usr/bin/env node
/**
 * Report which third-party Python distributions the installed skills need.
 *
 * This is a **static** report: it reads the skill scripts and lists the imports
 * that are neither in the standard library nor provided by the skill itself. It
 * deliberately does not try to ask an interpreter which packages are already
 * present.
 *
 * That check was implemented four different ways and abandoned. Under this
 * environment's confined Windows sandbox a Python child process spawned from
 * Node could be made to write its answer to a file, verified by hand and in
 * isolation — and still returned an unusable answer when driven by this tool,
 * with the child's stderr unavailable for diagnosis. Rather than ship a check
 * whose results are sometimes wrong, this reports the *needs*, which are
 * derived from files and are always right, and the README shows how to ask pip
 * what is actually installed.
 *
 * Usage:
 *   node tools/check-skill-deps.js [目录 ...]
 *
 * Options:
 *   --root <dir>   skill root (default: $DSH_HOME/skills)
 *   --json         machine-readable output
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/**
 * Import name -> PyPI distribution, for the cases where they differ.
 *
 * Anything absent is assumed to be distributed under its own import name, which
 * is the common case and is what `pip install` would try first.
 */
const DISTRIBUTION = {
  docx: 'python-docx',
  fitz: 'PyMuPDF',
  yaml: 'pyyaml',
  bs4: 'beautifulsoup4',
  PIL: 'Pillow',
  pptx: 'python-pptx',
  cv2: 'opencv-python',
  sklearn: 'scikit-learn',
  skimage: 'scikit-image',
  serial: 'pyserial',
  dotenv: 'python-dotenv',
  dateutil: 'python-dateutil',
  OpenSSL: 'pyOpenSSL',
  Crypto: 'pycryptodome',
  win32com: 'pywin32',
  jwt: 'PyJWT',
  json_repair: 'json-repair',
}

/**
 * Distributions the DSH runtime already ships.
 *
 * Listed explicitly so the install command below does not ask pip for packages
 * that are already there — the report is about what is *missing*, and these are
 * never missing.
 */
const BUNDLED = new Set(['pandas', 'numpy', 'python-docx', 'python-pptx', 'openpyxl', 'Pillow', 'lxml', 'XlsxWriter'])

/**
 * Distributions heavy enough that installing them deserves a decision.
 */
const HEAVY = new Set(['torch', 'transformers', 'chromadb', 'playwright', 'akshare', 'chonkie', 'fastmcp'])

/**
 * Import names that are not distributions, so pip must never be asked for them.
 *
 * A static scan cannot know which bare names a skill resolves through a
 * `sys.path` insert it performs at runtime. Listing one of those in the printed
 * install command is not a cosmetic wart: pip fails the whole command on the
 * first name it cannot find, so a single invented package turns a working
 * command into a broken one. Every entry here was checked against PyPI and does
 * not exist there.
 *
 * `cicpa_query` is the case that proved it: it is
 * `cicpa-company-query/scripts/cicpa_query.py`, imported by a sibling script,
 * and no distribution of that name exists.
 */
const NOT_A_DISTRIBUTION = new Set(['config', 'models', 'ima_client', 'cicpa_query', 'utils', 'common', 'helpers', 'src', 'app'])

/** Common top-level imports that ship with CPython. */
const STDLIB = new Set(
  `abc aifc argparse array ast asyncio atexit base64 bdb binascii bisect builtins bz2 calendar cmath cmd code codecs
   codeop collections colorsys compileall concurrent configparser contextlib contextvars copy copyreg csv ctypes
   curses dataclasses datetime dbm decimal difflib dis doctest email encodings ensurepip enum errno faulthandler
   fcntl filecmp fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob graphlib grp gzip hashlib
   heapq hmac html http idlelib imaplib importlib inspect io ipaddress itertools json keyword linecache locale logging
   lzma mailbox marshal math mimetypes mmap modulefinder msilib msvcrt multiprocessing netrc nis nntplib numbers
   operator optparse os ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posixpath
   pprint profile pstats pty pwd py_compile pyclbr pydoc queue quopri random re readline reprlib resource rlcompleter
   runpy sched secrets select selectors shelve shlex shutil signal site smtplib socket socketserver spwd sqlite3 ssl
   stat statistics string stringprep struct subprocess symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile
   termios test textwrap threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle
   types typing unicodedata unittest urllib uuid venv warnings wave weakref webbrowser winreg winsound wsgiref xdrlib
   xml xmlrpc zipapp zipfile zipimport zlib zoneinfo _thread _socket _json _csv _collections_abc`
    .split(/\s+/)
    .filter(Boolean),
)

/** Import statements, including `import a, b` and `from a.b import c`. */
const IMPORT_PATTERN = /^[ \t]*(?:from[ \t]+([A-Za-z_][\w.]*)|import[ \t]+([A-Za-z_][\w.]*(?:[ \t]*,[ \t]*[A-Za-z_][\w.]*)*))/gm

function parseArgs(argv) {
  const options = { root: undefined, json: false, targets: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--json') options.json = true
    else if (argument === '--root') options.root = argv[++index]
    else if (argument.startsWith('--root=')) options.root = argument.slice('--root='.length)
    else options.targets.push(argument)
  }
  return options
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Every `.py` file under `directory`. */
async function pythonFiles(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '__pycache__') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await pythonFiles(path)))
    else if (entry.isFile() && entry.name.endsWith('.py')) found.push(path)
  }
  return found
}

/**
 * Third-party import names used by one skill.
 *
 * A skill's scripts routinely do `sys.path.insert(0, <这里>)` and then import
 * their own siblings (`import apply_manifest`, `from flk_api import ...`). Those
 * are not distributions, and listing them buries the two or three names that
 * really are absent. So each import is resolved against the directory of the
 * file that made it, plus the skill root and every ancestor of that file: a
 * name that exists as `<dir>/<name>.py` or `<dir>/<name>/` is the skill's own
 * module and is dropped.
 *
 * @param skillDirectory - one installed skill.
 * @returns the external import names, sorted.
 */
async function importsOf(skillDirectory) {
  const files = await pythonFiles(skillDirectory)
  /** Directory -> the module names that directory provides. */
  const provided = new Map()
  for (const file of files) {
    const directory = dirname(file)
    const set = provided.get(directory) ?? new Set()
    set.add(basename(file).replace(/\.py$/, ''))
    provided.set(directory, set)
  }
  // `__init__.py` makes a directory itself importable by name, so a package
  // folder is a provided module for its parent.
  for (const [directory, names] of [...provided]) {
    if (names.has('__init__')) {
      const parent = dirname(directory)
      const set = provided.get(parent) ?? new Set()
      set.add(basename(directory))
      provided.set(parent, set)
    }
  }

  /**
   * Whether the skill provides `name` at all.
   *
   * The directory chain comes first because that is what a bare `python
   * script.py` sees through `sys.path[0]`. The whole-skill pass then covers the
   * common layout where `scripts/x.py` does `sys.path.insert(0, <skill>/lib)`
   * and imports `flk_api` — a module the skill owns, just not a sibling.
   */
  const providedBySkill = (file, name) => {
    let directory = dirname(file)
    while (directory.length >= skillDirectory.length) {
      if ((provided.get(directory) ?? new Set()).has(name)) return true
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    for (const names of provided.values()) if (names.has(name)) return true
    return false
  }

  const external = new Set()
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    IMPORT_PATTERN.lastIndex = 0
    let match
    while ((match = IMPORT_PATTERN.exec(text)) !== null) {
      const names = (match[1] ?? match[2] ?? '')
        .split(',')
        .map((part) => part.trim().split('.')[0])
        .filter(Boolean)
      for (const name of names) {
        if (STDLIB.has(name) || name.startsWith('_')) continue
        if (providedBySkill(file, name)) continue
        external.add(name)
      }
    }
  }
  return [...external].sort()
}

const options = parseArgs(process.argv.slice(2))
const root = resolve(options.root ?? process.env.DSH_SKILL_MARKET_ROOT ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'skills'))
const targets =
  options.targets.length > 0
    ? options.targets.map((target) => resolve(target))
    : (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))

const report = []
for (const target of targets) {
  if (!(await isDirectory(target))) continue
  const imports = await importsOf(target)
  if (imports.length === 0) continue
  report.push({ skill: target.split(/[\\/]/).pop(), imports })
}

const needed = new Set()
for (const entry of report) {
  for (const name of entry.imports) {
    const distribution = DISTRIBUTION[name] ?? name
    if (BUNDLED.has(distribution) || NOT_A_DISTRIBUTION.has(name)) continue
    needed.add(distribution)
  }
}
const installable = [...needed].filter((name) => !HEAVY.has(name)).sort()
const heavy = [...needed].filter((name) => HEAVY.has(name)).sort()

if (options.json) {
  console.log(JSON.stringify({ root, skills: report, installable, heavy }, null, 2))
} else if (report.length === 0) {
  console.log('no Python scripts with third-party imports found')
} else {
  console.log(`root    ${root}`)
  console.log(`${report.length} skill(s) with Python scripts; imports below exclude the standard library and the`)
  console.log('skill\'s own modules, and omit what the DSH runtime already ships')
  console.log(`(${[...BUNDLED].join(', ')})\n`)
  for (const entry of report) {
    console.log(`  ${entry.skill}`)
    console.log(`      imports  ${entry.imports.join(', ')}`)
    const missing = entry.imports
      .filter((name) => !NOT_A_DISTRIBUTION.has(name))
      .map((name) => DISTRIBUTION[name] ?? name)
      .filter((name) => !BUNDLED.has(name))
    if (missing.length > 0) console.log(`      install  ${missing.join(', ')}`)
  }
  if (installable.length > 0) {
    console.log('\nlightweight set (safe default):\n')
    console.log(`  python -m pip install ${installable.join(' ')}`)
  }
  if (heavy.length > 0) {
    console.log('\nheavy / optional — decide deliberately, they are hundreds of MB or need a browser download:\n')
    console.log(`  python -m pip install ${heavy.join(' ')}`)
    console.log('\n  torch + transformers are only used by local-rag\'s offline reranker, which its own')
    console.log('  requirements.txt marks optional; playwright additionally needs `playwright install chromium`.')
  }
  console.log('\nto see what is actually installed already:\n')
  console.log('  python -m pip list --format=freeze')
}
