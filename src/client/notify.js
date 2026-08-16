/**
 * 完成/审批/提问提醒：会话完成、会话中的工具申请权限（等待审批）、
 * 或 AI 向你提问（等待回答）时，播放对应提示音（可开关/试听）并弹出立绘图片。
 * 立绘支持上传/替换/移除、拖动缩放、水平翻转、遮罩裁剪（高分辨率输出），
 * 图片内容持久化在 IndexedDB，开关状态持久化在 localStorage。
 */
import * as React from 'react'
import { styles } from './styles.js'

const KEY = 'dsh-ntfy-config'
const CROP = 240
const PAD = 28

/** 三种事件各自的提示音（频率 Hz, 延迟秒）。完成=上行双音；审批=急促三连；提问=下行双音。 */
const SOUNDS = {
  done: [[880, 0], [1318.5, 0.18]],
  approval: [[987.77, 0], [987.77, 0.25], [1174.66, 0.5]],
  question: [[1174.66, 0], [880, 0.22]],
}
/** 三种事件各自的弹窗文案后缀。 */
const KIND_TEXT = { done: '已完成', approval: '正在申请权限', question: '正在向你提问' }

export function applyNotify(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  const state = { sound: true, showImage: true, approvalSound: true, approvalImage: true, questionSound: true, questionImage: true, objUrl: null }

  const load = () => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        const c = JSON.parse(raw)
        if (typeof c.sound === 'boolean') state.sound = c.sound
        if (typeof c.showImage === 'boolean') state.showImage = c.showImage
        if (typeof c.approvalSound === 'boolean') state.approvalSound = c.approvalSound
        if (typeof c.approvalImage === 'boolean') state.approvalImage = c.approvalImage
        if (typeof c.questionSound === 'boolean') state.questionSound = c.questionSound
        if (typeof c.questionImage === 'boolean') state.questionImage = c.questionImage
      } else {
        const old = localStorage.getItem('dsh-ntfy-sound')
        if (old !== null) state.sound = old === '1' || old === 'true'
      }
    } catch { /* storage unavailable */ }
  }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ sound: state.sound, showImage: state.showImage, approvalSound: state.approvalSound, approvalImage: state.approvalImage, questionSound: state.questionSound, questionImage: state.questionImage })) } catch { /* storage unavailable */ }
  }
  load()

  const openDb = () => new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('dsh-ntfy-store', 1)
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('portraits')) req.result.createObjectStore('portraits') }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
  const storePortrait = async (blob) => {
    try {
      const db = await openDb()
      await new Promise((res, rej) => {
        const tx = db.transaction('portraits', 'readwrite')
        tx.objectStore('portraits').put(blob, 'portrait')
        tx.oncomplete = res
        tx.onerror = () => rej(tx.error)
      })
      db.close()
    } catch { /* storage unavailable */ }
  }
  const deletePortrait = async () => {
    try {
      const db = await openDb()
      await new Promise((res, rej) => {
        const tx = db.transaction('portraits', 'readwrite')
        tx.objectStore('portraits').delete('portrait')
        tx.oncomplete = res
        tx.onerror = () => rej(tx.error)
      })
      db.close()
    } catch { /* ignore */ }
  }
  const restorePortrait = async () => {
    try {
      const db = await openDb()
      const blob = await new Promise((res) => {
        const tx = db.transaction('portraits', 'readonly')
        const req = tx.objectStore('portraits').get('portrait')
        req.onsuccess = () => res(req.result || null)
        req.onerror = () => res(null)
      })
      db.close()
      if (blob) state.objUrl = URL.createObjectURL(blob)
    } catch { /* ignore */ }
  }

  ctx.effect(() => () => {
    if (state.objUrl) { try { URL.revokeObjectURL(state.objUrl) } catch {} }
  })

  styles.insert(`
.dsh-ntfy-section { display: flex; flex-direction: column; gap: 14px; }
.dsh-ntfy-group { display: flex; flex-direction: column; gap: 10px; }
.dsh-ntfy-group-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-ntfy-card { display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 12px 14px; }
.dsh-ntfy-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.dsh-ntfy-card-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-ntfy-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dsh-ntfy-dot.done { background: #34c759; }
.dsh-ntfy-dot.approval { background: #ff9f0a; }
.dsh-ntfy-dot.question { background: #4d6bfe; }
.dsh-ntfy-card-toggles { display: flex; gap: 18px; flex-wrap: wrap; }
.dsh-ntfy-row { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--dsw-alias-label-primary); cursor: pointer; user-select: none; }
.dsh-ntfy-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: #4d6bfe; cursor: pointer; }
.dsh-ntfy-test { align-self: flex-start; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 6px 14px; cursor: pointer; }
.dsh-ntfy-test:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-ntfy-test:disabled { opacity: 0.5; cursor: not-allowed; }
.dsh-ntfy-test.small { padding: 3px 10px; font-size: 12px; }
.dsh-ntfy-test.on { border-color: #4d6bfe; color: #4d6bfe; }
.dsh-ntfy-test.strong { font-weight: 700; border-color: #4d6bfe; color: #4d6bfe; }
.dsh-ntfy-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin-bottom: 8px; }
.dsh-ntfy-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 18px; }
.dsh-ntfy-preview img { width: 96px; height: 96px; object-fit: contain; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
.dsh-ntfy-crop-wrap { display: flex; flex-direction: column; gap: 10px; }
.dsh-ntfy-stage { position: relative; width: 296px; height: 296px; }
.dsh-ntfy-crop { position: absolute; left: 28px; top: 28px; width: 240px; height: 240px; overflow: hidden; cursor: move; touch-action: none; }
.dsh-ntfy-crop img { position: absolute; left: 0; top: 0; transform-origin: 0 0; user-select: none; pointer-events: none; }
.dsh-ntfy-mask { position: absolute; background: rgb(0 0 0 / 0.5); pointer-events: none; }
.dsh-ntfy-mask-t { left: 0; top: 0; width: 296px; height: 28px; }
.dsh-ntfy-mask-b { left: 0; top: 268px; width: 296px; height: 28px; }
.dsh-ntfy-mask-l { left: 0; top: 28px; width: 28px; height: 240px; }
.dsh-ntfy-mask-r { left: 268px; top: 28px; width: 28px; height: 240px; }
.dsh-ntfy-crop-ctl { display: flex; align-items: center; gap: 10px; }
.dsh-ntfy-crop-ctl input[type="range"] { flex: 1; accent-color: #4d6bfe; }
.dsh-ntfy-scale { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dsh-ntfy-crop-actions { display: flex; gap: 8px; }
.dsh-ntfy-toast { position: fixed; right: 20px; bottom: 20px; z-index: 100; display: flex; flex-direction: column; gap: 14px; align-items: flex-end; pointer-events: none; }
.dsh-ntfy-pop { pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 0; cursor: pointer; animation: dsh-ntfy-pop-in 0.32s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes dsh-ntfy-pop-in { 0% { opacity: 0; transform: translateY(16px) scale(0.6); } 100% { opacity: 1; transform: none; } }
.dsh-ntfy-pop-img { width: 160px; max-height: 240px; object-fit: contain; }
.dsh-ntfy-toast-item { background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 8px 14px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.18); font-size: 13px; color: var(--dsw-alias-label-primary); line-height: 18px; }
`)

  const chime = (notes) => {
    try {
      const AC = typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext)
      if (!AC) return
      const ac = new AC()
      const now = ac.currentTime
      notes.forEach(([freq, delay]) => {
        const osc = ac.createOscillator()
        const gain = ac.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, now + delay)
        gain.gain.exponentialRampToValueAtTime(0.25, now + delay + 0.03)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.7)
        osc.connect(gain)
        gain.connect(ac.destination)
        osc.start(now + delay)
        osc.stop(now + delay + 0.75)
      })
      ctx.timeout(() => { try { ac.close() } catch { /* already closed */ } }, 1500)
    } catch { /* audio unavailable */ }
  }

  function NotifyLayer(props) {
    const byId = props.useSessions((s) => s.byId)
    const [toasts, setToasts] = React.useState([])
    const prevRunning = React.useRef({})
    const prevPending = React.useRef({})
    const seq = React.useRef(0)
    React.useEffect(() => {
      for (const id of Object.keys(byId)) {
        const row = byId[id]
        if (!row || row.blank) continue
        if (prevRunning.current[id] === true && !row.running) {
          if (state.sound) chime(SOUNDS.done)
          if (state.showImage) {
            seq.current += 1
            const tid = seq.current
            const title = row.displayTitle || row.id
            setToasts((list) => [...list, { id: tid, kind: 'done', title }])
            ctx.timeout(() => setToasts((list) => list.filter((t) => t.id !== tid)), 6000)
          }
        }
        const pend = row.pendingInteraction || null
        const prevPend = prevPending.current[id]
        if ((pend === 'approval' || pend === 'question') && prevPend !== undefined && prevPend !== pend) {
          const soundKey = pend === 'approval' ? 'approvalSound' : 'questionSound'
          const imageKey = pend === 'approval' ? 'approvalImage' : 'questionImage'
          if (state[soundKey]) chime(SOUNDS[pend])
          if (state[imageKey]) {
            seq.current += 1
            const tid = seq.current
            const title = row.displayTitle || row.id
            setToasts((list) => [...list, { id: tid, kind: pend, title }])
            ctx.timeout(() => setToasts((list) => list.filter((t) => t.id !== tid)), 10000)
          }
        }
        prevPending.current[id] = pend
        prevRunning.current[id] = !!row.running
      }
    }, [byId])
    if (toasts.length === 0) return null
    return React.createElement('div', { className: 'dsh-ntfy-toast' },
      toasts.map((t) => React.createElement('div', {
        key: t.id,
        className: 'dsh-ntfy-pop',
        onClick: () => setToasts((list) => list.filter((x) => x.id !== t.id)),
      },
        state.objUrl
          ? React.createElement('img', { className: 'dsh-ntfy-pop-img', src: state.objUrl, alt: '立绘' })
          : null,
        React.createElement('div', { className: 'dsh-ntfy-toast-item' },
          t.title + ' ' + (KIND_TEXT[t.kind] || '')),
      )),
    )
  }

  function CropEditor(props) {
    const src = props.src
    const [nat, setNat] = React.useState(null)
    const [scale, setScale] = React.useState(1)
    const [pos, setPos] = React.useState({ x: 0, y: 0 })
    const [flip, setFlip] = React.useState(false)
    const drag = React.useRef(null)

    React.useEffect(() => {
      let alive = true
      setFlip(false)
      const im = new Image()
      im.onload = () => {
        if (!alive) return
        const cover = Math.max(CROP / im.naturalWidth, CROP / im.naturalHeight)
        setNat({ w: im.naturalWidth, h: im.naturalHeight })
        setScale(cover)
        setPos({ x: (CROP - im.naturalWidth * cover) / 2, y: (CROP - im.naturalHeight * cover) / 2 })
      }
      im.src = src
      return () => { alive = false }
    }, [src])

    const contain = nat ? Math.min(CROP / nat.w, CROP / nat.h) : 0.1
    const cover = nat ? Math.max(CROP / nat.w, CROP / nat.h) : 1
    const minS = contain
    const maxS = Math.max(cover * 5, contain)

    const down = (e) => {
      drag.current = { sx: e.clientX, sy: e.clientY, bx: pos.x, by: pos.y }
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    }
    const move = (e) => {
      if (!drag.current) return
      setPos({ x: drag.current.bx + (e.clientX - drag.current.sx), y: drag.current.by + (e.clientY - drag.current.sy) })
    }
    const up = () => { drag.current = null }

    const crop = () => {
      if (!nat) return
      const im = new Image()
      im.onload = () => {
        const srcSize = CROP / scale
        const out = Math.max(240, Math.min(1024, Math.round(srcSize)))
        let sx = -pos.x / scale
        if (flip) sx = pos.x / scale + nat.w - srcSize
        const sy = -pos.y / scale
        const canvas = document.createElement('canvas')
        canvas.width = out
        canvas.height = out
        const cx = canvas.getContext('2d')
        if (!cx) return
        cx.clearRect(0, 0, out, out)
        if (flip) {
          cx.translate(out, 0)
          cx.scale(-1, 1)
        }
        cx.drawImage(im, sx, sy, srcSize, srcSize, 0, 0, out, out)
        canvas.toBlob((blob) => { if (blob) props.onCrop(blob) }, 'image/png')
      }
      im.src = src
    }

    const W = nat ? nat.w * scale : 0
    return React.createElement('div', { className: 'dsh-ntfy-crop-wrap' },
      React.createElement('div', { className: 'dsh-ntfy-stage' },
        React.createElement('div', { className: 'dsh-ntfy-crop', onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up },
          nat && React.createElement('img', { src: src, draggable: false, alt: '', style: { width: nat.w * scale, height: nat.h * scale, transform: 'translate(' + (pos.x + (flip ? W : 0)) + 'px, ' + pos.y + 'px) scaleX(' + (flip ? -1 : 1) + ')' } }),
        ),
        React.createElement('div', { className: 'dsh-ntfy-mask dsh-ntfy-mask-t' }),
        React.createElement('div', { className: 'dsh-ntfy-mask dsh-ntfy-mask-b' }),
        React.createElement('div', { className: 'dsh-ntfy-mask dsh-ntfy-mask-l' }),
        React.createElement('div', { className: 'dsh-ntfy-mask dsh-ntfy-mask-r' }),
      ),
      React.createElement('div', { className: 'dsh-ntfy-crop-ctl' },
        React.createElement('span', { className: 'dsh-ntfy-scale' }, '缩放 ' + Math.round(scale * 100) + '%'),
        React.createElement('input', { type: 'range', min: minS, max: maxS, step: 0.01, value: scale, disabled: !nat, onChange: (e) => setScale(Number(e.target.value)) }),
      ),
      React.createElement('div', { className: 'dsh-ntfy-crop-actions' },
        React.createElement('button', { className: 'dsh-ntfy-test' + (flip ? ' on' : ''), type: 'button', disabled: !nat, onClick: () => setFlip((f) => !f) }, '⇄ 水平翻转'),
        React.createElement('button', { className: 'dsh-ntfy-test strong', type: 'button', disabled: !nat, onClick: crop }, '裁剪并保存'),
      ),
    )
  }

  function SoundSettings() {
    const force = React.useReducer((x) => x + 1, 0)[1]
    const fileRef = React.useRef(null)
    React.useEffect(() => {
      let mounted = true
      restorePortrait().then(() => { if (mounted) force() })
      return () => { mounted = false }
    }, [])

    const onFile = (e) => {
      const file = e.target.files && e.target.files[0]
      if (!file) return
      if (state.objUrl) { try { URL.revokeObjectURL(state.objUrl) } catch {} }
      state.objUrl = URL.createObjectURL(file)
      storePortrait(file)
      force()
      e.target.value = ''
    }

    const onCrop = (blob) => {
      if (state.objUrl) { try { URL.revokeObjectURL(state.objUrl) } catch {} }
      state.objUrl = URL.createObjectURL(blob)
      storePortrait(blob)
      force()
    }

    const remove = () => {
      if (state.objUrl) { try { URL.revokeObjectURL(state.objUrl) } catch {} }
      state.objUrl = null
      deletePortrait()
      force()
    }

    const eventCard = (kind, title, soundKey, imageKey) => React.createElement('div', { className: 'dsh-ntfy-card' },
      React.createElement('div', { className: 'dsh-ntfy-card-head' },
        React.createElement('span', { className: 'dsh-ntfy-card-title' },
          React.createElement('span', { className: 'dsh-ntfy-dot ' + kind }),
          title,
        ),
        React.createElement('button', { className: 'dsh-ntfy-test small', type: 'button', onClick: () => chime(SOUNDS[kind]) }, '▶ 试听'),
      ),
      React.createElement('div', { className: 'dsh-ntfy-card-toggles' },
        React.createElement('label', { className: 'dsh-ntfy-row' },
          React.createElement('input', { type: 'checkbox', defaultChecked: state[soundKey], onChange: (e) => { state[soundKey] = e.target.checked; save() } }),
          React.createElement('span', null, '播放提示音'),
        ),
        React.createElement('label', { className: 'dsh-ntfy-row' },
          React.createElement('input', { type: 'checkbox', defaultChecked: state[imageKey], onChange: (e) => { state[imageKey] = e.target.checked; save() } }),
          React.createElement('span', null, '弹出立绘图片'),
        ),
      ),
    )

    return React.createElement('div', { className: 'dsh-ntfy-section' },
      React.createElement('div', { className: 'dsh-ntfy-group' },
        React.createElement('div', { className: 'dsh-ntfy-group-label' }, '提醒事件'),
        eventCard('done', '会话完成', 'sound', 'showImage'),
        eventCard('approval', '申请权限', 'approvalSound', 'approvalImage'),
        eventCard('question', '向你提问', 'questionSound', 'questionImage'),
      ),
      React.createElement('div', { className: 'dsh-ntfy-group' },
        React.createElement('div', { className: 'dsh-ntfy-group-label' }, '提醒立绘'),
        React.createElement('div', { className: 'dsh-ntfy-card' },
          state.objUrl
            ? React.createElement('div', { className: 'dsh-ntfy-preview' }, React.createElement('img', { src: state.objUrl, alt: '立绘预览' }))
            : React.createElement('div', { className: 'dsh-ntfy-hint' }, '尚未上传图片，提醒时仅显示文字提示'),
          React.createElement('div', { className: 'dsh-ntfy-crop-actions' },
            React.createElement('button', { className: 'dsh-ntfy-test', type: 'button', onClick: () => { if (fileRef.current) fileRef.current.click() } }, state.objUrl ? '替换图片' : '上传图片'),
            state.objUrl ? React.createElement('button', { className: 'dsh-ntfy-test', type: 'button', onClick: remove }, '移除图片') : null,
          ),
          React.createElement('input', { ref: fileRef, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: onFile }),
          state.objUrl ? React.createElement(CropEditor, { src: state.objUrl, onCrop: onCrop }) : null,
        ),
      ),
      React.createElement('div', { className: 'dsh-ntfy-hint' }, '提示音由浏览器 Web Audio 实时合成，三种事件音效各不相同；上传的立绘可拖动、缩放、水平翻转并裁剪中间方框，裁剪结果以高分辨率保存到本地（IndexedDB）并自动记住。会话完成、工具申请权限、AI 向你提问时都会弹出提醒。'),
    )
  }

  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'ntfy-sound', order: 90 },
    (props) => React.createElement(NotifyLayer, props),
  ))

  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'notify-settings', order: 28, label: '提醒设置' },
    () => React.createElement(SoundSettings),
  ))
}
