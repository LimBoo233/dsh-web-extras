/**
 * 文件变更：按“轮次”聚合本会话中 write / edit / str_replace_editor 产生的
 * 文件 diff（DSH 已在 tool result 上提供 { card: 'diff', diffs }），并在
 * 会话视图环中新增「文件变更」页签。
 *
 * 每个文件卡片提供两个可独立开关的视图：
 *  - 行级差异：+ / - / 上下文行，精确显示增删了哪些行。
 *  - 高亮对比：两个 CodeBlock 展示「修改前 / 修改后」，复用平台 Shiki 高亮。
 * 两个视图可同时打开（左右并排），也可分别关闭以节省空间；
 * 任一视图关闭后，文件体顶部会出现对应的「打开…」按钮用于重新打开。
 */
import * as React from 'react'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { styles } from './styles.js'

const el = React.createElement

const STYL_KEY = 'dsh-styl-config'
const TURN_COLORS = ['#4d6bfe', '#34c759', '#ff9f0a', '#ff453a', '#bf5af2', '#64d2ff', '#ffd60a', '#ff6482']

function loadCardOpacity() {
  try {
    if (typeof localStorage === 'undefined') return 70
    const raw = localStorage.getItem(STYL_KEY)
    if (!raw) return 70
    const value = JSON.parse(raw)
    const n = Number(value && value.changesCardOpacity)
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 70
  } catch {
    return 70
  }
}

// 与 DSH tool-fs 的 langFromPath 保持一致的扩展名 -> 语言提示映射。
const LANG_BY_EXT = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp',
  cs: 'cs', kt: 'kotlin', swift: 'swift', php: 'php',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  md: 'md', markdown: 'md', mdx: 'mdx',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', xml: 'xml', lua: 'lua',
}

function langFromPath(path) {
  const base = String(path).slice(Math.max(String(path).lastIndexOf('/'), String(path).lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  const ext = base.slice(dot + 1).toLowerCase()
  return Object.prototype.hasOwnProperty.call(LANG_BY_EXT, ext) ? LANG_BY_EXT[ext] : undefined
}

function shortenPath(path, cwd) {
  if (!cwd) return path
  const normCwd = cwd.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  const normPath = String(path).replace(/\\/g, '/')
  if (normPath === normCwd) return '.'
  if (normPath.startsWith(normCwd + '/')) return normPath.slice(normCwd.length + 1)
  return path
}

function splitLines(text) {
  if (typeof text !== 'string' || text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

function narrowHunk(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const path = raw.path
  const oldText = raw.oldText
  const newText = raw.newText
  if (typeof path !== 'string') return null
  if (oldText !== null && typeof oldText !== 'string') return null
  if (typeof newText !== 'string') return null
  return { path, oldText, newText }
}

function diffHunksOf(block) {
  if (!block) return null
  const views = []
  if ('kind' in block) {
    // 已结算的 tool result：优先使用 resultView（applied diff），
    // 否则回退到 callView（例如 str_replace_editor 主要提供 call view）。
    views.push(block.resultView, block.callView)
  } else {
    views.push(block.callView)
  }
  for (const view of views) {
    if (!view || view.card !== 'diff' || !Array.isArray(view.diffs)) continue
    const hunks = []
    for (const raw of view.diffs) {
      const hunk = narrowHunk(raw)
      if (hunk) hunks.push(hunk)
    }
    if (hunks.length > 0) return hunks
  }
  return null
}

// 单 hunk 的行级差异。oldText / newText 可能带上下文；去掉公共前后缀后，
// 中间旧行是删除、中间新行是新增，公共前后缀是上下文。这样统计到的
// added / removed 是真正的增删行数，不会把上下文重复计入。
function diffRowsForHunk(hunk) {
  if (hunk.oldText === null) {
    return splitLines(hunk.newText).map((text) => ({ kind: 'add', text }))
  }
  const oldLines = splitLines(hunk.oldText)
  const newLines = splitLines(hunk.newText)
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1

  const rows = []
  for (let i = 0; i < prefix; i += 1) rows.push({ kind: 'ctx', text: oldLines[i] })
  for (let i = prefix; i < oldLines.length - suffix; i += 1) rows.push({ kind: 'del', text: oldLines[i] })
  for (let i = prefix; i < newLines.length - suffix; i += 1) rows.push({ kind: 'add', text: newLines[i] })
  for (let i = oldLines.length - suffix; i < oldLines.length; i += 1) rows.push({ kind: 'ctx', text: oldLines[i] })
  return rows
}

function buildTurnIndex(turnEnds) {
  const map = turnEnds instanceof Map ? turnEnds : new Map()
  return [...map.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([turn, endSeq]) => ({ turn, endSeq }))
}

function turnForSeq(seq, index, running) {
  let lo = 0
  let hi = index.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (index[mid].endSeq >= seq) {
      ans = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  if (ans >= 0) return { kind: 'turn', turn: index[ans].turn }
  if (running) return { kind: 'running' }
  return { kind: 'unknown' }
}

function formatTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return undefined
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return undefined
  }
}

function groupTitle(group, turnTimings) {
  if (group.kind === 'turn') {
    const timing = turnTimings instanceof Map ? turnTimings.get(group.turn) : undefined
    const time = formatTime(timing && timing.startTime)
    return '第 ' + group.turn + ' 轮' + (time ? ' · ' + time : '')
  }
  if (group.kind === 'running') return '进行中'
  return '未分轮'
}

function tagForGroup(group) {
  if (group.kind === 'turn') return TURN_COLORS[(group.turn - 1 + TURN_COLORS.length) % TURN_COLORS.length]
  if (group.kind === 'running') return '#ff9f0a'
  return '#8e8e93'
}

function textOfUserNode(node) {
  if (!node || !Array.isArray(node.content)) return ''
  const texts = []
  let images = 0
  for (const part of node.content) {
    if (!part) continue
    if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text)
    else if (part.type === 'image') images += 1
  }
  if (images > 0) texts.push(images === 1 ? '[图片]' : '[' + images + ' 张图片]')
  return texts.join(' ').replace(/\s+/g, ' ').trim()
}

function collectModel(session) {
  if (!session) return { groups: [], totalFiles: 0, totalAdded: 0, totalRemoved: 0 }
  const index = buildTurnIndex(session.turnEnds)
  const userNodes = (session.nodes || [])
    .filter((node) => node && node.kind === 'user')
    .sort((left, right) => left.seq - right.seq)
  const lastUser = userNodes[userNodes.length - 1]
  const groups = new Map()

  const ensureGroup = (key, kind, turn, order) => {
    let group = groups.get(key)
    if (!group) {
      group = { key, kind, turn, order, entries: [] }
      groups.set(key, group)
    }
    return group
  }

  const addBlock = (block, fallbackSeq, running) => {
    const hunks = diffHunksOf(block)
    if (!hunks) return
    const seq = 'kind' in block && typeof block.seq === 'number' ? block.seq : fallbackSeq
    const callId = typeof block.callId === 'string' ? block.callId : ''
    const target = turnForSeq(seq, index, running)
    let group
    if (target.kind === 'turn') {
      group = ensureGroup('turn:' + target.turn, 'turn', target.turn, target.turn)
    } else if (target.kind === 'running') {
      group = ensureGroup('running', 'running', undefined, Number.MAX_SAFE_INTEGER - 1)
    } else {
      group = ensureGroup('unknown', 'unknown', undefined, Number.MAX_SAFE_INTEGER)
    }
    for (const hunk of hunks) {
      group.entries.push({ path: hunk.path, hunk, seq, callId })
    }
    for (const child of block.subCalls || []) addBlock(child, seq, running)
  }

  for (const node of session.nodes || []) {
    if (node && node.kind === 'tool-result') addBlock(node, node.seq, session.running === true)
  }
  for (const call of session.runningCalls || []) addBlock(call, Number.MAX_SAFE_INTEGER, true)

  const promptForTurn = (turn) => {
    const at = index.findIndex((entry) => entry.turn === turn)
    if (at < 0) return lastUser
    const prevEnd = at > 0 ? index[at - 1].endSeq : 0
    const currentEnd = index[at].endSeq
    const matches = userNodes.filter((node) => node.seq > prevEnd && node.seq <= currentEnd)
    return matches[matches.length - 1] || lastUser
  }

  const result = [...groups.values()]
    .map((group) => {
      const byPath = new Map()
      for (const entry of group.entries) {
        let item = byPath.get(entry.path)
        if (!item) {
          item = { path: entry.path, hunks: [], minSeq: entry.seq, rows: [], added: 0, removed: 0 }
          byPath.set(entry.path, item)
        }
        item.hunks.push(entry.hunk)
        if (entry.seq < item.minSeq) item.minSeq = entry.seq
      }
      const items = [...byPath.values()].sort((left, right) => left.minSeq - right.minSeq || left.path.localeCompare(right.path))
      let added = 0
      let removed = 0
      for (const item of items) {
        const rows = []
        item.hunks.forEach((hunk, hunkIndex) => {
          if (hunkIndex > 0) rows.push({ kind: 'sep', text: '' })
          rows.push(...diffRowsForHunk(hunk))
        })
        item.rows = rows
        item.added = rows.filter((row) => row.kind === 'add').length
        item.removed = rows.filter((row) => row.kind === 'del').length
        added += item.added
        removed += item.removed
      }
      const promptNode = group.kind === 'turn' ? promptForTurn(group.turn) : lastUser
      const tag = tagForGroup(group)
      const sortValue = group.kind === 'running'
        ? -1
        : group.kind === 'turn'
          ? 1000000 - group.turn
          : 1000001
      return {
        key: group.key,
        kind: group.kind,
        turn: group.turn,
        sortValue,
        tag,
        title: groupTitle(group, session.turnTimings),
        prompt: textOfUserNode(promptNode),
        items,
        added,
        removed,
      }
    })
    .sort((left, right) => left.sortValue - right.sortValue)

  const totalFiles = new Set(result.flatMap((group) => group.items.map((item) => item.path))).size
  const totalAdded = result.reduce((sum, group) => sum + group.added, 0)
  const totalRemoved = result.reduce((sum, group) => sum + group.removed, 0)
  return { groups: result, totalFiles, totalAdded, totalRemoved }
}

function DiffRows(props) {
  const rows = props.rows || []
  if (rows.length === 0) {
    return el('div', { className: 'dsh-chg-empty' }, '没有可显示的行级差异')
  }
  return el('div', { className: 'dsh-chg-diff' },
    rows.map((row, index) => {
      if (row.kind === 'sep') {
        return el('div', { className: 'dsh-chg-diff-sep', key: 'sep-' + index }, '⋯')
      }
      const mark = row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : ' '
      return el('div', { className: 'dsh-chg-diff-row ' + row.kind, key: index },
        el('span', { className: 'dsh-chg-diff-mark' }, mark),
        el('span', { className: 'dsh-chg-diff-text' }, row.text),
      )
    }),
  )
}

function CodeCompare(props) {
  const hunks = props.hunks || []
  const lang = props.lang
  const beforeParts = []
  const afterParts = []
  for (const hunk of hunks) {
    if (hunk.oldText !== null) beforeParts.push(hunk.oldText)
    afterParts.push(hunk.newText)
  }
  const beforeText = beforeParts.join('\n⋯\n')
  const afterText = afterParts.join('\n⋯\n')
  const hasBefore = beforeText.trim() !== ''
  const hasAfter = afterText.trim() !== ''

  return el('div', { className: 'dsh-chg-codegrid' },
    el('div', { className: 'dsh-chg-code-side' },
      el('div', { className: 'dsh-chg-code-label' }, '修改前'),
      hasBefore
        ? el(CodeBlock, { code: beforeText, lang, className: 'dsh-chg-codeblock' })
        : el('div', { className: 'dsh-chg-empty' }, '新文件，无修改前内容'),
    ),
    el('div', { className: 'dsh-chg-code-side' },
      el('div', { className: 'dsh-chg-code-label' }, '修改后'),
      hasAfter
        ? el(CodeBlock, { code: afterText, lang, className: 'dsh-chg-codeblock' })
        : el('div', { className: 'dsh-chg-empty' }, '内容已清空'),
    ),
  )
}

function ViewCard(props) {
  return el('div', { className: 'dsh-chg-view' },
    el('div', { className: 'dsh-chg-view-head' },
      el('span', { className: 'dsh-chg-view-title' }, props.title),
      el('button', {
        type: 'button',
        className: 'dsh-chg-view-close',
        onClick: props.onClose,
      }, '关闭'),
    ),
    el('div', { className: 'dsh-chg-view-body' }, props.children),
  )
}

function FileCard(props) {
  const item = props.item
  const cwd = props.cwd
  const tag = props.tag
  const [open, setOpen] = React.useState(false)
  const [diffOpen, setDiffOpen] = React.useState(true)
  const [codeOpen, setCodeOpen] = React.useState(true)
  const displayPath = shortenPath(item.path, cwd)
  const lang = langFromPath(item.path)
  const viewCount = (diffOpen ? 1 : 0) + (codeOpen ? 1 : 0)

  return el('div', { className: 'dsh-chg-file' },
    el('button', {
      type: 'button',
      className: 'dsh-chg-file-head',
      onClick: () => setOpen((value) => !value),
      'aria-expanded': open ? 'true' : 'false',
    },
      tag ? el('span', { className: 'dsh-chg-file-tag', style: { background: tag } }) : null,
      el('span', { className: 'dsh-chg-file-path' }, displayPath),
      el('span', { className: 'dsh-chg-file-stats' },
        el('span', { className: 'dsh-chg-add' }, '+' + item.added),
        el('span', { className: 'dsh-chg-del' }, '-' + item.removed),
      ),
    ),
    open
      ? el('div', { className: 'dsh-chg-file-body' },
          viewCount < 2
            ? el('div', { className: 'dsh-chg-reopen' },
                !diffOpen
                  ? el('button', { type: 'button', className: 'dsh-chg-reopen-btn', onClick: () => setDiffOpen(true) }, '打开行级差异')
                  : null,
                !codeOpen
                  ? el('button', { type: 'button', className: 'dsh-chg-reopen-btn', onClick: () => setCodeOpen(true) }, '打开高亮对比')
                  : null,
              )
            : null,
          viewCount > 0
            ? el('div', { className: 'dsh-chg-views' + (viewCount === 2 ? ' two' : '') },
                diffOpen
                  ? el(ViewCard, { title: '行级差异', onClose: () => setDiffOpen(false) },
                      el(DiffRows, { rows: item.rows }))
                  : null,
                codeOpen
                  ? el(ViewCard, { title: '高亮对比', onClose: () => setCodeOpen(false) },
                      el(CodeCompare, { hunks: item.hunks, lang }))
                  : null,
              )
            : null,
        )
      : null,
  )
}

function TurnGroup(props) {
  const group = props.group
  const cwd = props.cwd
  const [open, setOpen] = React.useState(true)
  const [promptOpen, setPromptOpen] = React.useState(false)
  return el('div', { className: 'dsh-chg-turn' + (open ? ' open' : '') },
    el('button', {
      type: 'button',
      className: 'dsh-chg-turn-head',
      onClick: () => setOpen((value) => !value),
      'aria-expanded': open ? 'true' : 'false',
    },
      el('span', { className: 'dsh-chg-turn-title' },
        el('span', { className: 'dsh-chg-turn-tag', style: { background: group.tag } }, group.title),
      ),
      el('span', { className: 'dsh-chg-turn-stats' },
        group.items.length + ' 个文件 · +' + group.added + ' -' + group.removed,
      ),
    ),
    open
      ? el('div', { className: 'dsh-chg-turn-body' },
          group.prompt
            ? el('div', {
                className: 'dsh-chg-prompt' + (promptOpen ? ' open' : ''),
                onClick: () => setPromptOpen((value) => !value),
                title: promptOpen ? '点击收起' : '点击展开',
              },
                el('span', { className: 'dsh-chg-prompt-label' }, '用户：'),
                el('span', { className: 'dsh-chg-prompt-text' }, group.prompt),
                el('span', { className: 'dsh-chg-prompt-toggle' }, promptOpen ? '收起' : '展开'),
              )
            : null,
          group.items.map((item) => el(FileCard, { key: item.path + ':' + item.minSeq, item, cwd, tag: group.tag })),
        )
      : null,
  )
}

function ChangesView(props) {
  const { useSession, useSessions, sessionId } = props
  const session = useSession((value) => value)
  const cwd = useSessions((list) => (sessionId === undefined ? undefined : list.byId[sessionId]?.cwd))
  const model = React.useMemo(() => collectModel(session), [session])
  const [cardOpacity, setCardOpacity] = React.useState(loadCardOpacity)

  React.useEffect(() => {
    const onOpacityChange = (event) => {
      const value = Number(event && event.detail)
      if (Number.isFinite(value)) setCardOpacity(Math.min(100, Math.max(0, Math.round(value))))
    }
    try { window.addEventListener('dsh-chg-opacity-change', onOpacityChange) } catch { /* event unavailable */ }
    return () => {
      try { window.removeEventListener('dsh-chg-opacity-change', onOpacityChange) } catch { /* event unavailable */ }
    }
  }, [])

  return el('div', { className: 'dsh-chg-page', style: { '--dsh-chg-opacity': cardOpacity + '%' } },
    el('div', { className: 'dsh-chg-summary' },
      el('span', { className: 'dsh-chg-summary-title' }, '文件变更'),
      el('span', { className: 'dsh-chg-summary-nums' },
        model.groups.length + ' 轮 · ' + model.totalFiles + ' 个文件 · +' + model.totalAdded + ' -' + model.totalRemoved,
      ),
    ),
    model.groups.length === 0
      ? el('div', { className: 'dsh-chg-empty' },
          '暂无文件变更。AI 使用 write / edit / str_replace_editor 修改文件后，这里会按轮次列出修改内容与增删行。')
      : model.groups.map((group) => el(TurnGroup, { key: group.key, group, cwd })),
  )
}

const CSS = `
.dsh-chg-page { --dsh-chg-opacity: 70%; display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 24px; }
.dsh-chg-summary { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 2px 2px 0; }
.dsh-chg-summary-title { font-size: 14px; font-weight: 700; color: var(--dsw-alias-label-primary); }
.dsh-chg-summary-nums { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-chg-turn { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) var(--dsh-chg-opacity), transparent); overflow: hidden; }
.dsh-chg-turn-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) var(--dsh-chg-opacity), transparent); border: 0; color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; text-align: left; }
.dsh-chg-turn-head:hover { background: var(--dsw-alias-bg-overlay); }
.dsh-chg-turn-title { font-size: 13px; font-weight: 600; }
.dsh-chg-turn-stats { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dsh-chg-turn-body { display: flex; flex-direction: column; gap: 10px; padding: 10px; }
.dsh-chg-file { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) var(--dsh-chg-opacity), transparent); overflow: hidden; }
.dsh-chg-file-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px; background: transparent; border: 0; color: inherit; cursor: pointer; font: inherit; text-align: left; }
.dsh-chg-file-head:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-chg-file-path { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace); font-size: 12px; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-chg-file-stats { display: flex; gap: 10px; font-size: 12px; font-variant-numeric: tabular-nums; }
.dsh-chg-add { color: #34c759; }
.dsh-chg-del { color: #ff453a; }
.dsh-chg-file-body { min-width: 0; }
.dsh-chg-views { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 10px; }
.dsh-chg-views.two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
@media (max-width: 900px) { .dsh-chg-views.two { grid-template-columns: minmax(0, 1fr); } }
.dsh-chg-view { min-width: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) var(--dsh-chg-opacity), transparent); overflow: hidden; }
.dsh-chg-view-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) var(--dsh-chg-opacity), transparent); border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-chg-view-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-chg-view-close { background: transparent; border: 0; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: 6px; }
.dsh-chg-view-close:hover { background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); }
.dsh-chg-view-body { min-width: 0; }
.dsh-chg-diff { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace); font-size: 12px; line-height: 20px; max-height: 520px; overflow: auto; }
.dsh-chg-diff-row { display: flex; min-width: max-content; padding: 0 10px; }
.dsh-chg-diff-row.del { background: rgb(255 69 58 / 0.13); }
.dsh-chg-diff-row.add { background: rgb(52 199 89 / 0.13); }
.dsh-chg-diff-mark { width: 18px; flex: none; text-align: center; user-select: none; color: var(--dsw-alias-label-secondary); }
.dsh-chg-diff-row.del .dsh-chg-diff-mark { color: #ff453a; }
.dsh-chg-diff-row.add .dsh-chg-diff-mark { color: #34c759; }
.dsh-chg-diff-text { white-space: pre; }
.dsh-chg-diff-sep { padding: 2px 10px; color: var(--dsw-alias-label-secondary); font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace); font-size: 12px; }
.dsh-chg-codegrid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 10px; }
.dsh-chg-code-side { min-width: 0; }
.dsh-chg-code-label { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; }
.dsh-chg-code-side .md-code-block { margin: 0; }
.dsh-chg-controls { display: flex; align-items: center; gap: 10px; padding: 2px 2px 0; }
.dsh-chg-controls-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-chg-controls-num { font-size: 12px; color: var(--dsw-alias-label-secondary); min-width: 40px; text-align: right; }
.dsh-chg-range { flex: 1; min-width: 120px; accent-color: #4d6bfe; }
.dsh-chg-turn-tag { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 700; line-height: 18px; color: #fff; }
.dsh-chg-file-tag { flex: none; width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dsh-chg-prompt { display: flex; align-items: flex-start; gap: 6px; padding: 4px 2px 2px; cursor: pointer; opacity: 0.55; transition: opacity 0.15s ease; }
.dsh-chg-prompt:hover { opacity: 0.9; }
.dsh-chg-prompt-label { flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-chg-prompt-text { flex: 1; min-width: 0; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-chg-prompt.open .dsh-chg-prompt-text { white-space: pre-wrap; overflow: visible; text-overflow: clip; }
.dsh-chg-prompt-toggle { flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-chg-empty { padding: 20px 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; }
.dsh-chg-reopen { display: flex; gap: 8px; justify-content: center; padding: 10px; }
.dsh-chg-reopen + .dsh-chg-views { border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-chg-reopen-btn { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.dsh-chg-reopen-btn:hover { background: var(--dsw-alias-bg-overlay); }
`

export function applyChanges(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  styles.insert(CSS)

  slots.inject('conversation.view', () => slots.register(
    { name: 'conversation.view', id: 'changes', order: 20, label: '文件变更' },
    ChangesView,
  ))
}