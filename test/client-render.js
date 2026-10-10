// Render the client half headless: load the bundle with small stubs, run
// `apply()`, then render every registered component once — the picker with the
// shortlist, a name query, a tag query and a query that matches nothing, and the
// panel likewise.
//
// Why this exists: a profile treats "client entry did not activate" as fatal, and
// a React defect in a UI contribution takes the whole product down with it. This
// exercises the render paths that smoke.js cannot reach, without a browser.
//
//   node test/client-render.js
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail === '' ? '' : `  ${detail}`}`)
  if (!ok) failures += 1
}

// --- a React small enough to render one element tree -------------------------
// `plan` feeds chosen values to the hook slots a component reads in order, so a
// stateless stub can still render the view under test.
let plan = []
let planIndex = 0
const React = {
  useState: (initial) => {
    const index = planIndex
    planIndex += 1
    if (plan[index] !== undefined) return [plan[index], () => {}]
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  useSyncExternalStore: () => null,
  createElement: (type, props, ...children) => ({ type, props, children }),
  Component: class {},
}

// --- load the bundle ---------------------------------------------------------
let captured
new Function('window', source)({ __ModuleLoader__: { load: (module) => { captured = module } } })
if (captured === undefined) throw new Error('client.js never registered a module')
const plugin = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})

const translate = (key, params) => (params === undefined ? key : `${key}(${JSON.stringify(params)})`)
const registrations = []
const ctx = {
  effect: (fn) => {
    const disposer = fn()
    if (typeof disposer !== 'function') throw new Error('an effect returned no disposer')
  },
  on: () => {},
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  locale: { register: () => () => {}, bind: () => translate },
  slots: {
    inject: (slot, build) => {
      const entry = build()
      if (entry !== undefined) registrations.push(entry)
    },
    register: (declaration, component) => {
      const entry = { ...declaration, component }
      registrations.push(entry)
      return entry
    },
  },
  inputTriggers: {
    registerSource: (source) => {
      registrations.push({ id: source.name, source })
      return () => {}
    },
    sessionOf: () => ({
      launcher: { getSnapshot: () => null, subscribe: () => () => {} },
      dismiss: () => {},
    }),
  },
  sessions: { scope: () => ({}), binding: () => undefined, using: async () => [] },
  remote: { skills: {}, commands: {} },
  get: () => undefined,
}

plugin.apply(ctx)
console.log(`  ok    apply() registered ${registrations.length} contribution(s)`)

const component = (id) => registrations.find((entry) => entry?.id === id)?.component
for (const id of ['skill-market.picker', 'skill-market.panel', 'skill-market']) {
  check(`the ${id} seat is registered`, typeof component(id) === 'function')
}
check('the composer source is registered', registrations.some((entry) => entry.id === 'market-skill'))

// --- fixtures ----------------------------------------------------------------
const skills = [
  { name: 'office-docx', description: 'Read and write Word documents', source: 'market-install', path: 'C:/skills/office-docx/SKILL.md', installed: true, writable: true, userInvocable: true, modelInvocable: true, installedAt: 10, lastUsedAt: 5, previousNames: ['old-name'] },
  { name: 'grill-me', description: 'A relentless interview', source: 'builtin', userInvocable: true, modelInvocable: false, writable: false, installedAt: 1, lastUsedAt: 20 },
  { name: 'chenyiwei-bbs', description: '陈版主实务问答检索', source: 'local-dir', path: 'D:/skills/chenyiwei-bbs/SKILL.md', installed: false, writable: true, userInvocable: false, modelInvocable: true, previousNames: ['legacy-bbs'], displayName: '陈版主问答检索' },
]

const render = (id, statePlan) => {
  plan = statePlan
  planIndex = 0
  return component(id)({
    t: translate,
    useOpen: () => true,
    onClose: () => {},
    menu: { getSnapshot: () => null, subscribe: () => () => {} },
    capture: () => {},
    open: () => {},
  })
}

/** Flatten an element tree into { className, text, title, placeholder } records. */
const collect = (tree) => {
  const records = []
  const textOf = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (typeof node !== 'object') return ''
    const own = node.props?.children
    const children = [...(node.children ?? []), ...(own === undefined ? [] : Array.isArray(own) ? own : [own])]
    return children.map(textOf).join('')
  }
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node === null || typeof node !== 'object') return
    records.push({
      className: node.props?.className ?? '',
      text: textOf(node),
      title: node.props?.title,
      placeholder: node.props?.placeholder,
      disabled: node.props?.disabled,
    })
    const own = node.props?.children
    const children = [...(node.children ?? []), ...(own === undefined ? [] : Array.isArray(own) ? own : [own])]
    children.forEach(walk)
  }
  walk(tree)
  return records
}

const names = (records, klass) =>
  records
    .filter((node) => node.className.split(/\s+/).includes(klass))
    .map((node) => node.text)
    .filter((text) => !text.startsWith('menu.'))
const pickerNames = (records) => names(records, 'dshSkillPicker_name')
const panelNames = (records) => names(records, 'dshSkillPanel_name')

// --- the picker --------------------------------------------------------------
let nodes = collect(render('skill-market.picker', [skills, '']))
check(
  'an empty query keeps the recency shortlist',
  JSON.stringify(pickerNames(nodes)) === JSON.stringify(['grill-me', 'office-docx', '陈版主问答检索']),
  pickerNames(nodes).join(','),
)
check('the two action rows follow the shortlist', nodes.some((node) => node.text === 'menu.add') && nodes.some((node) => node.text === 'menu.manage'))
check('a user-only row keeps its annotation', nodes.some((node) => node.text === 'menu.userOnly · A relentless interview'))
check('the search box sits at the top', nodes.find((node) => node.placeholder !== undefined)?.placeholder === 'picker.search')
check('the footer reports the catalogue', nodes.some((node) => node.text === 'picker.count({"count":3})'))

nodes = collect(render('skill-market.picker', [skills, 'chen']))
check('a name query narrows the list', JSON.stringify(pickerNames(nodes)) === JSON.stringify(['陈版主问答检索']), pickerNames(nodes).join(','))
check(
  'a row with a display name still shows the token',
  nodes.some((node) => node.text === '/chenyiwei-bbs' && node.className.split(/\s+/).includes('dshSkillPicker_tech')),
  nodes.filter((node) => node.text === '/chenyiwei-bbs').map((node) => node.className).join('|'),
)
check('a query drops the action rows', !nodes.some((node) => node.text === 'menu.add'))

nodes = collect(render('skill-market.picker', [skills, '陈版主']))
check('a Chinese display name is searchable', JSON.stringify(pickerNames(nodes)) === JSON.stringify(['陈版主问答检索']), pickerNames(nodes).join(','))

nodes = collect(render('skill-market.picker', [skills, 'Word']))
check('a description query matches', JSON.stringify(pickerNames(nodes)) === JSON.stringify(['office-docx']), pickerNames(nodes).join(','))

nodes = collect(render('skill-market.picker', [skills, 'tag.readonly']))
check('a tag query matches', JSON.stringify(pickerNames(nodes)) === JSON.stringify(['grill-me']), pickerNames(nodes).join(','))
nodes = collect(render('skill-market.picker', [skills, 'tag.menuOff']))
check('an availability tag matches', JSON.stringify(pickerNames(nodes)) === JSON.stringify(['陈版主问答检索']), pickerNames(nodes).join(','))
nodes = collect(render('skill-market.picker', [skills, 'market-install']))
check('a source matches too', JSON.stringify(pickerNames(nodes)) === JSON.stringify(['office-docx']), pickerNames(nodes).join(','))

nodes = collect(render('skill-market.picker', [skills, 'old-name']))
check('a previous name matches in the picker', JSON.stringify(pickerNames(nodes)) === JSON.stringify(['office-docx']), pickerNames(nodes).join(','))
nodes = collect(render('skill-market.picker', [skills, '']))
check('a renamed skill wears its original name', nodes.some((node) => node.text === 'panel.formerName({"name":"old-name"})'))
check(
  'only renamed skills wear that chip',
  nodes.filter((node) => node.text.startsWith('panel.formerName(')).length === 2,
  nodes.filter((node) => node.text.startsWith('panel.formerName(')).map((node) => node.text).join(' | '),
)

nodes = collect(render('skill-market.picker', [skills, 'zzzz']))
check('no match renders the empty state', nodes.some((node) => node.className.split(/\s+/).includes('dshSkillPicker_emptyTitle')))
check('the empty state echoes the query', nodes.some((node) => node.text === 'picker.emptyQuery({"query":"zzzz"})'))
check('the empty state offers a hint and a way out', nodes.some((node) => node.text === 'picker.emptyHint') && nodes.some((node) => node.text === 'picker.clear'))
check('the empty state shows no rows', pickerNames(nodes).length === 0)

// --- the panel ---------------------------------------------------------------
const panelState = { phase: 'ready', skills, installRoot: 'C:/skills', error: undefined }
nodes = collect(render('skill-market.panel', [true, panelState, 'grill']))
check('the panel narrows the same way', JSON.stringify(panelNames(nodes)) === JSON.stringify(['grill-me']), panelNames(nodes).join(','))
check('the panel keeps its search box', nodes.some((node) => node.placeholder === 'panel.search'))
nodes = collect(render('skill-market.panel', [true, panelState, 'tag.readonly']))
check('the panel searches tags too', JSON.stringify(panelNames(nodes)) === JSON.stringify(['grill-me']), panelNames(nodes).join(','))
nodes = collect(render('skill-market.panel', [true, panelState, 'zzzz']))
check('the panel empty state echoes the query', nodes.some((node) => node.text === 'panel.emptyQuery({"query":"zzzz"})'))
check('the panel empty state offers clearing', nodes.some((node) => node.text === 'panel.clearSearch'))
nodes = collect(render('skill-market.panel', [true, panelState, '']))
check('an empty query shows every skill', panelNames(nodes).length === 3, panelNames(nodes).join(','))
check('the panel keeps its chips', nodes.some((node) => node.text === 'panel.filter.all') && nodes.some((node) => node.text === 'panel.filter.writable'))
check('the refresh control stays', nodes.some((node) => node.text === 'panel.refresh'))

// --- renaming from the panel -------------------------------------------------
const officeDocx = skills[0]
/** Render the panel with the rename form open on one skill, holding both fields. */
const renameForm = (value, display) =>
  collect(
    render('skill-market.panel', [
      true,
      panelState,
      '',
      'all',
      false,
      undefined,
      undefined,
      'rename',
      '',
      '',
      '',
      0,
      officeDocx,
      value,
      display,
    ]),
  )
const save = (records) => records.find((node) => node.text === 'panel.renameSave')

nodes = renameForm('')
check('the form names the skill being renamed', nodes.some((node) => node.text === 'panel.renameCurrent({"name":"office-docx"})'))
check('an empty box is the opening state, not an error', !nodes.some((node) => node.className.split(/\s+/).includes('dshSkillPanel_err')))
check('saving is refused while the box is empty', save(nodes)?.disabled === true)

nodes = renameForm('Bad_Name')
check('a non-kebab name is refused', nodes.some((node) => node.className.split(/\s+/).includes('dshSkillPanel_err') && node.text === 'panel.renameInvalid'))
check('saving is refused while the name is invalid', save(nodes)?.disabled === true)

nodes = renameForm('office-docx')
check('the current name is refused', nodes.some((node) => node.text === 'panel.renameSame'))

nodes = renameForm('chenyiwei-bbs')
check('a name another skill holds is refused', nodes.some((node) => node.text === 'panel.renameTaken({"name":"chenyiwei-bbs"})'))

nodes = renameForm('legacy-bbs')
check('another skill’s previous name is refused', nodes.some((node) => node.text === 'panel.renameAliasTaken({"name":"legacy-bbs"})'))

nodes = renameForm('brand-new-name')
check('a free name passes validation', !nodes.some((node) => node.className.split(/\s+/).includes('dshSkillPanel_err')))
check('saving is allowed then', save(nodes)?.disabled === false)

// The Chinese side of the form: a display name alone is a complete change.
nodes = renameForm('', '审计报告复核')
check('a display name alone is enough to save', save(nodes)?.disabled === false)
check('a valid display name shows no error', !nodes.some((node) => node.className.split(/\s+/).includes('dshSkillPanel_err')))
check('the form offers both fields', nodes.some((node) => node.placeholder === 'panel.displayLabel') && nodes.some((node) => String(node.placeholder).startsWith('panel.techLabel')))

nodes = renameForm('', '显'.repeat(41))
check('a too long display name is refused', nodes.some((node) => node.text === 'panel.displayTooLong({"max":40})'))
check('saving is refused then', save(nodes)?.disabled === true)

nodes = renameForm('', '陈版主问答检索')
check('a display name another skill shows is refused', nodes.some((node) => node.text === 'panel.displayTaken({"name":"陈版主问答检索"})'))

nodes = renameForm('', '')
check('an untouched form cannot be saved', save(nodes)?.disabled === true)

nodes = collect(render('skill-market.panel', [true, panelState, '陈版主']))
check('a Chinese display name narrows the panel', JSON.stringify(panelNames(nodes)) === JSON.stringify(['陈版主问答检索']), panelNames(nodes).join(','))
check(
  'the panel row shows the token beside the Chinese name',
  nodes.some((node) => node.text === '/chenyiwei-bbs' && node.className.split(/\s+/).includes('dshSkillPanel_tech')),
)

nodes = collect(render('skill-market.panel', [true, panelState, 'grill']))
check('a read-only skill offers no rename', !nodes.some((node) => node.text === 'panel.rename'))
nodes = collect(render('skill-market.panel', [true, panelState, 'office']))
check('a writable skill offers rename and remove', nodes.some((node) => node.text === 'panel.rename') && nodes.some((node) => node.text === 'panel.remove'))
check('the row carries its previous name', nodes.some((node) => node.text === 'panel.formerName({"name":"old-name"})'))
nodes = collect(render('skill-market.panel', [true, panelState, 'old-name']))
check('a previous name matches in the panel too', JSON.stringify(panelNames(nodes)) === JSON.stringify(['office-docx']), panelNames(nodes).join(','))

// --- the composer button -----------------------------------------------------
nodes = collect(render('skill-market', []))
check('the button renders its label', nodes.some((node) => node.text === 'button.label'))

console.log(failures === 0 ? '\nclient render checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
