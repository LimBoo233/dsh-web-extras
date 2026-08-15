/**
 * 外观定制：背景图（URL / 本地图片，支持水平翻转、预览、缩放、位置、透明度）、
 * 侧边栏/气泡/输入区/代码块透明度、输入区失焦折叠。
 * 配置持久化在 localStorage，本地图片内容持久化在 IndexedDB。
 */
import * as React from 'react'

// 输入区折叠 CSS：焦点不在输入卡时把文本区压到 N 行（保留余量）。
// 不隐藏工具行（模型/访问模式/发送按钮保持可用），也不压缩内边距（文字与边框保持默认距离）。
const buildFoldCss = (lines) => `
:root [data-composer-card]:not(:focus-within) [data-input-scroll] { max-height: ${lines * 24}px !important; }
`

export function applyAppearance(ctx) {
  const theme = ctx.get('theme')
  const slots = ctx.get('slots')
  if (theme === undefined || slots === undefined) return

  styles.insert(`
.dsh-styl-page { display: flex; flex-direction: column; gap: 16px; }
.dsh-styl-group { display: flex; flex-direction: column; gap: 8px; }
.dsh-styl-lbl { font-size: 12px; color: var(--dsw-alias-label-secondary); font-weight: 600; }
.dsh-styl-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsh-styl-btn { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.dsh-styl-btn:hover { background: var(--dsw-alias-bg-overlay); }
.dsh-styl-btn.active { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.dsh-styl-btn:disabled { opacity: 0.4; cursor: default; }
.dsh-styl-input { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 5px 10px; font-size: 12px; flex: 1; min-width: 200px; }
.dsh-styl-range { flex: 1; min-width: 120px; }
.dsh-styl-range:disabled { opacity: 0.4; }
.dsh-styl-num { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 4px 6px; font-size: 12px; width: 60px; }
.dsh-styl-num:disabled { opacity: 0.4; }
.dsh-styl-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); opacity: 0.8; }
.dsh-styl-preview { position: relative; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-layer-2); display: grid; place-items: center; max-width: 100%; cursor: grab; touch-action: none; }
.dsh-styl-preview.dragging { cursor: grabbing; }
.dsh-styl-preview-tag { position: absolute; top: 8px; left: 10px; font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 2px 8px; z-index: 1; }
.dsh-styl-preview-hint { position: absolute; bottom: 8px; left: 10px; font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 2px 8px; }
`)

  // ---- 本地图片持久化：IndexedDB 保存图片内容本身 ----
  // 浏览器安全模型禁止网页读取本地文件路径，所以「记住路径」不可行；
  // 改为把选中的图片 Blob 存入 IndexedDB，刷新后读回并重建 object URL，效果等同免重选。
  const DB_NAME = 'dsh-styl-store'
  const DB_VERSION = 1
  const DB_STORE = 'images'
  const DB_IMG_KEY = 'background'

  const dbOpen = () => new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    } catch (e) { reject(e) }
  })
  const dbPutImage = async (blob) => {
    try {
      const db = await dbOpen()
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite')
        tx.objectStore(DB_STORE).put(blob, DB_IMG_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    } catch { /* storage unavailable */ }
  }
  const dbGetImage = async () => {
    try {
      const db = await dbOpen()
      const blob = await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly')
        const req = tx.objectStore(DB_STORE).get(DB_IMG_KEY)
        req.onsuccess = () => resolve(req.result || null)
        req.onerror = () => reject(req.error)
      })
      db.close()
      return blob
    } catch { return null }
  }
  const dbClearImage = async () => {
    try {
      const db = await dbOpen()
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite')
        tx.objectStore(DB_STORE).delete(DB_IMG_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    } catch { /* storage unavailable */ }
  }

  // ---- 配置持久化：localStorage ----
  // 默认配置（仅对新用户生效）：背景图透明度 20、侧边栏 70、气泡 80、输入区 96、代码块 85、折叠开启 3 行。
  // 已保存过配置的用户升级后保留其全部设置（不做强制覆盖）。
  const STORAGE_KEY = 'dsh-styl-config'
  const loadPersisted = (target) => {
    try {
      if (typeof localStorage === 'undefined') return
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (typeof saved !== 'object' || saved === null) return
      for (const key of Object.keys(target)) {
        if (key in saved && typeof saved[key] === typeof target[key]) {
          target[key] = saved[key]
        }
      }
      if (typeof target.bgUrl === 'string' && target.bgUrl.startsWith('blob:')) {
        // 本地图片临时地址已失效：清掉背景图，由 IndexedDB 重建
        target.appliedBg = ''
        target.bgUrl = ''
        target.imgRatio = null
      }
    } catch { /* storage unavailable - settings stay in-memory */ }
  }
  const persist = () => {
    try {
      if (typeof localStorage === 'undefined') return
      const saved = {}
      for (const key of Object.keys(ui)) {
        if (key === 'objUrl' || key === 'imgRatio' || key === 'flipUrl') continue
        saved[key] = ui[key]
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    } catch { /* storage unavailable - settings stay in-memory */ }
  }

  // 插件级 UI 状态与覆盖层：设置面板关闭（组件卸载）不会清理它们，
  // 只有插件本身停止时才还原主题。
  const ui = {
    bgUrl: '',
    appliedBg: '',
    opacity: 20, // 背景图透明度（默认配置）
    posX: 50,
    posY: 50,
    scaleMode: 'cover',
    scalePct: 100,
    sidebarOpacity: 70, // 侧边栏底色不透明度（默认配置）
    bubbleOpacity: 80, // 右侧用户气泡不透明度（默认配置）
    inputOpacity: 96, // 下方输入卡不透明度（默认配置）
    codeOpacity: 85, // Markdown 代码块背景不透明度（默认配置）
    foldComposer: true, // 输入区失焦折叠（默认开启）
    foldLines: 3, // 折叠时保留的行数（默认配置）
    flipBg: false, // 背景图水平翻转（镜像）
    flipUrl: null, // 翻转结果的临时 object URL（不持久化）
    flipFailed: false, // 翻转生成失败（远程图跨域）标记
    objUrl: null,
    imgRatio: null,
  }
  loadPersisted(ui)

  let disposer = null
  let foldDisposer = null
  let dragging = false

  const escUrl = (u) => u.replace(/\\/g, '/').replace(/"/g, '%22')
  const clamp = (v, min, max) => {
    const n = Number(v)
    if (Number.isNaN(n)) return min
    return Math.min(max, Math.max(min, n))
  }
  const mixLayer = (token, alpha) =>
    'linear-gradient(color-mix(in srgb, var(' + token + ') ' + Math.round(alpha * 100) + '%, transparent), color-mix(in srgb, var(' + token + ') ' + Math.round(alpha * 100) + '%, transparent))'
  const alphaColor = (token, pct) => 'color-mix(in srgb, var(' + token + ') ' + Math.round(pct) + '%, transparent)'

  // 生成当前配置的 background 简写（light/dark 两套）。
  // fixed 用于真实页面（背景相对视口）；预览框必须用 scroll，否则图片会相对视口定位而跑出预览框。
  const buildBg = (fixed) => {
    const alpha = (100 - ui.opacity) / 100
    const size = ui.scaleMode === 'cover' ? 'cover' : ui.scaleMode === 'contain' ? 'contain' : 'auto ' + ui.scalePct + '%'
    const attach = fixed ? 'fixed' : 'scroll'
    const img = 'url("' + escUrl(ui.appliedBg) + '") ' + ui.posX + '% ' + ui.posY + '% / ' + size + ' no-repeat ' + attach
    if (alpha <= 0.001) return { light: img, dark: img }
    return {
      light: mixLayer('--dsw-static-neutral-bluish-00', alpha) + ', ' + img,
      dark: mixLayer('--dsw-static-neutral-bluish-950', alpha) + ', ' + img,
    }
  }

  // 同步折叠 CSS：行数或开关变化时重建
  const syncFoldCss = () => {
    if (foldDisposer) { foldDisposer(); foldDisposer = null }
    if (ui.foldComposer) {
      foldDisposer = styles.insert(buildFoldCss(ui.foldLines))
    }
  }

  const apply = () => {
    const tokens = {}
    if (ui.appliedBg) {
      tokens['--dsw-alias-bg-base'] = buildBg(true)
    }
    // 侧边栏透明度：100% 保持默认不透明；越低背景图透出越多（半透明主题底色）
    if (ui.sidebarOpacity < 100) {
      const pct = Math.max(1, Math.round(ui.sidebarOpacity))
      tokens['--dsw-specific-sidebar-fill'] = {
        light: alphaColor('--dsw-static-neutral-bluish-00', pct),
        dark: alphaColor('--dsw-static-neutral-bluish-950', pct),
      }
    }
    // 右侧用户气泡透明度（亮色底是 deepseek 蓝，暗色底是 bluish-850）
    if (ui.bubbleOpacity < 100) {
      const pct = Math.max(1, Math.round(ui.bubbleOpacity))
      tokens['--dsw-specific-bubble'] = {
        light: alphaColor('--dsw-static-deepseek-50', pct),
        dark: alphaColor('--dsw-static-neutral-bluish-850', pct),
      }
    }
    // 下方输入卡透明度
    if (ui.inputOpacity < 100) {
      const pct = Math.max(1, Math.round(ui.inputOpacity))
      tokens['--dsw-specific-input-major'] = {
        light: alphaColor('--dsw-static-neutral-bluish-00', pct),
        dark: alphaColor('--dsw-static-neutral-bluish-850', pct),
      }
    }
    // Markdown 代码块透明度（主体 + 标题栏，shiki 高亮背景跟随主体 token）
    if (ui.codeOpacity < 100) {
      const pct = Math.max(1, Math.round(ui.codeOpacity))
      tokens['--dsw-alias-markdown-code-block'] = {
        light: alphaColor('--dsw-static-neutral-bluish-50', pct),
        dark: alphaColor('--dsw-static-neutral-bluish-900', pct),
      }
      tokens['--dsw-alias-markdown-code-block-banner'] = {
        light: alphaColor('--dsw-static-neutral-bluish-50', pct),
        dark: alphaColor('--dsw-static-neutral-bluish-850', pct),
      }
    }
    if (disposer) { disposer(); disposer = null }
    if (Object.keys(tokens).length > 0) {
      disposer = theme.overrideTokens('dsh-styl', tokens)
    }
    syncFoldCss()
    persist()
  }

  // ---- 水平翻转 ----
  // 背景图无法用纯 CSS 镜像（background 不支持 transform/filter），
  // 因此用 canvas 把源图水平翻转后生成新图（object URL）作为实际显示图。
  // 远程图片需服务器允许跨域（CORS），否则生成失败并降级回原图。
  const buildFlip = (cb) => {
    const src = ui.bgUrl
    if (!src) { cb(null); return }
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const w = img.naturalWidth
          const h = img.naturalHeight
          if (!w || !h) { cb(null); return }
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const cx = canvas.getContext('2d')
          if (!cx) { cb(null); return }
          cx.translate(w, 0)
          cx.scale(-1, 1)
          cx.drawImage(img, 0, 0)
          canvas.toBlob((blob) => {
            if (!blob) { cb(null); return }
            try { cb(URL.createObjectURL(blob)) } catch { cb(null) }
          }, 'image/png')
        } catch { cb(null) }
      }
      img.onerror = () => cb(null)
      img.src = src
    } catch { cb(null) }
  }

  // 依据源图与翻转开关同步实际背景图；翻转图为异步生成，生成期间先显示原图，
  // 生成完成后无缝切换到翻转图。预览框与页面共用 appliedBg，因此自动同步。
  const refreshBg = () => {
    if (ui.flipUrl) {
      try { URL.revokeObjectURL(ui.flipUrl) } catch { /* url already revoked */ }
      ui.flipUrl = null
    }
    if (ui.flipBg && ui.bgUrl) {
      ui.appliedBg = ui.bgUrl
      ui.flipFailed = false
      buildFlip((url) => {
        if (url) {
          ui.flipUrl = url
          ui.appliedBg = url
          ui.flipFailed = false
        } else {
          ui.flipFailed = true
        }
        apply()
      })
    } else {
      ui.flipFailed = false
      ui.appliedBg = ui.bgUrl
    }
  }

  // 启动恢复：若配置无背景图但 IndexedDB 存有本地图片，读回并重建 object URL
  const restoreStoredImage = async () => {
    if (ui.appliedBg) return
    const blob = await dbGetImage()
    if (!blob) return
    try {
      const url = URL.createObjectURL(blob)
      ui.objUrl = url
      ui.bgUrl = url
      ui.appliedBg = url
      loadRatio(url)
      refreshBg()
      apply()
    } catch { /* object URL unavailable - keep current background */ }
  }

  // 插件启动即插入折叠样式 + 同步背景（含翻转）+ 尝试恢复本地图片，不依赖用户先操作设置项
  syncFoldCss()
  refreshBg()
  restoreStoredImage()

  // 插件停止 / 更新时移除覆盖层与折叠样式，并释放本地文件与翻转图临时 URL
  ctx.effect(() => () => {
    if (disposer) { disposer(); disposer = null }
    if (foldDisposer) { foldDisposer(); foldDisposer = null }
    if (ui.objUrl) {
      try { URL.revokeObjectURL(ui.objUrl) } catch { /* url already revoked */ }
      ui.objUrl = null
    }
    if (ui.flipUrl) {
      try { URL.revokeObjectURL(ui.flipUrl) } catch { /* url already revoked */ }
      ui.flipUrl = null
    }
  })

  const releaseObjUrl = (except) => {
    if (ui.objUrl && ui.objUrl !== except) {
      try { URL.revokeObjectURL(ui.objUrl) } catch { /* url already revoked */ }
      ui.objUrl = null
    }
  }

  const loadRatio = (url) => {
    ui.imgRatio = null
    try {
      const img = new Image()
      img.onload = () => { ui.imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight) }
      img.onerror = () => { ui.imgRatio = null }
      img.src = url
    } catch { /* Image unavailable - dragging stays disabled */ }
  }

  // 图片在预览框中的显示尺寸（宽高比已归一化：宽 = scale，高 = scale / ratio）
  const displaySize = (rectW, rectH, ratio) => {
    if (ui.scaleMode === 'contain') {
      const scale = Math.min(rectW, rectH * ratio)
      return { w: scale, h: scale / ratio }
    }
    if (ui.scaleMode === 'custom') {
      const h = (rectH * ui.scalePct) / 100
      return { w: h * ratio, h }
    }
    const scale = Math.max(rectW, rectH * ratio)
    return { w: scale, h: scale / ratio }
  }

  const currentScheme = () => {
    try {
      const snap = theme.getTheme()
      if (snap && snap.active && snap.active.colorScheme === 'dark') return 'dark'
    } catch { /* fall back to light */ }
    return 'light'
  }

  function StylSection(props) {
    const [bgUrl, setBgUrl] = React.useState(ui.bgUrl)
    const [opacity, setOpacity] = React.useState(ui.opacity)
    const [posX, setPosX] = React.useState(ui.posX)
    const [posY, setPosY] = React.useState(ui.posY)
    const [scaleMode, setScaleMode] = React.useState(ui.scaleMode)
    const [scalePct, setScalePct] = React.useState(ui.scalePct)
    const [sidebarOpacity, setSidebarOpacity] = React.useState(ui.sidebarOpacity)
    const [bubbleOpacity, setBubbleOpacity] = React.useState(ui.bubbleOpacity)
    const [inputOpacity, setInputOpacity] = React.useState(ui.inputOpacity)
    const [codeOpacity, setCodeOpacity] = React.useState(ui.codeOpacity)
    const [foldComposer, setFoldComposer] = React.useState(ui.foldComposer)
    const [foldLines, setFoldLines] = React.useState(ui.foldLines)
    const [flipBg, setFlipBg] = React.useState(ui.flipBg)
    const [showAdvanced, setShowAdvanced] = React.useState(false)
    const [ratioReady, setRatioReady] = React.useState(false)
    // 预览框宽高比跟随真实窗口；主题切换时刷新预览
    const [ratio, setRatio] = React.useState(() => {
      try { return window.innerWidth / Math.max(1, window.innerHeight) } catch { return 1.6 }
    })
    const [, setThemeTick] = React.useState(0)

    React.useEffect(() => {
      const update = () => setRatio(window.innerWidth / Math.max(1, window.innerHeight))
      try { window.addEventListener('resize', update) } catch { /* window unavailable */ }
      const offTheme = ctx.on('theme/change', () => setThemeTick((t) => t + 1))
      return () => {
        try { window.removeEventListener('resize', update) } catch { /* window unavailable */ }
        offTheme()
      }
    }, [])

    const refreshRatio = () => {
      setRatioReady(ui.imgRatio !== null && !!ui.appliedBg)
    }

    // 一键恢复默认：透明度/折叠/位置缩放回默认值；背景图（URL/本地图片）与翻转原样保留
    const resetDefaults = () => {
      ui.opacity = 20
      ui.posX = 50
      ui.posY = 50
      ui.scaleMode = 'cover'
      ui.scalePct = 100
      ui.sidebarOpacity = 70
      ui.bubbleOpacity = 80
      ui.inputOpacity = 96
      ui.codeOpacity = 85
      ui.foldComposer = true
      ui.foldLines = 3
      setOpacity(20)
      setPosX(50)
      setPosY(50)
      setScaleMode('cover')
      setScalePct(100)
      setSidebarOpacity(70)
      setBubbleOpacity(80)
      setInputOpacity(96)
      setCodeOpacity(85)
      setFoldComposer(true)
      setFoldLines(3)
      apply()
    }

    // 全部变回不透明：侧边栏/气泡/输入区/代码块透明度全部 100%（不动背景图与其透明度）
    const makeOpaque = () => {
      ui.sidebarOpacity = 100
      ui.bubbleOpacity = 100
      ui.inputOpacity = 100
      ui.codeOpacity = 100
      setSidebarOpacity(100)
      setBubbleOpacity(100)
      setInputOpacity(100)
      setCodeOpacity(100)
      apply()
    }

    const applyBg = () => {
      ui.bgUrl = bgUrl
      releaseObjUrl(bgUrl)
      loadRatio(bgUrl)
      refreshBg()
      apply()
    }
    const clearBg = () => {
      ui.bgUrl = ''
      setBgUrl('')
      releaseObjUrl(null)
      ui.imgRatio = null
      setRatioReady(false)
      dbClearImage()
      refreshBg()
      apply()
    }
    const pickFile = (e) => {
      const file = e.target.files && e.target.files[0]
      if (!file) return
      try {
        const url = URL.createObjectURL(file)
        releaseObjUrl(url)
        ui.objUrl = url
        ui.bgUrl = url
        setBgUrl(url)
        loadRatio(url)
        refreshBg()
        dbPutImage(file)
        apply()
      } catch { /* object URL unavailable - keep current background */ }
    }
    const changeOpacity = (v) => { ui.opacity = v; setOpacity(v); apply() }
    const changePosX = (v) => { ui.posX = v; setPosX(v); apply() }
    const changePosY = (v) => { ui.posY = v; setPosY(v); apply() }
    const centerPos = () => { ui.posX = 50; ui.posY = 50; setPosX(50); setPosY(50); apply() }
    const pickScaleMode = (m) => { ui.scaleMode = m; setScaleMode(m); apply() }
    const changeScalePct = (v) => { ui.scalePct = v; setScalePct(v); apply() }
    const changeSidebarOpacity = (v) => { ui.sidebarOpacity = v; setSidebarOpacity(v); apply() }
    const changeBubbleOpacity = (v) => { ui.bubbleOpacity = v; setBubbleOpacity(v); apply() }
    const changeInputOpacity = (v) => { ui.inputOpacity = v; setInputOpacity(v); apply() }
    const changeCodeOpacity = (v) => { ui.codeOpacity = v; setCodeOpacity(v); apply() }
    const toggleFold = (v) => { ui.foldComposer = v; setFoldComposer(v); apply() }
    const changeFoldLines = (v) => { ui.foldLines = v; setFoldLines(v); apply() }
    const toggleFlip = (v) => { ui.flipBg = v; setFlipBg(v); refreshBg(); apply() }

    // 预览框内拖动图片调整位置：像素位移换算为背景位置百分比
    const startDrag = (e) => {
      if (dragging) return
      if (ui.scaleMode === 'cover' || !ui.appliedBg || !ui.imgRatio) return
      e.preventDefault()
      dragging = true
      const rect = e.currentTarget.getBoundingClientRect()
      const disp = displaySize(rect.width, rect.height, ui.imgRatio)
      const baseX = ui.posX
      const baseY = ui.posY
      const startX = e.clientX
      const startY = e.clientY
      const roomX = rect.width - disp.w
      const roomY = rect.height - disp.h
      const move = (ev) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        const nx = Math.abs(roomX) > 0.5 ? clamp(baseX + (dx / roomX) * 100, 0, 100) : baseX
        const ny = Math.abs(roomY) > 0.5 ? clamp(baseY + (dy / roomY) * 100, 0, 100) : baseY
        ui.posX = nx
        ui.posY = ny
        setPosX(nx)
        setPosY(ny)
        apply()
      }
      const up = () => {
        dragging = false
        try {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
        } catch { /* window unavailable */ }
      }
      try {
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      } catch { /* window unavailable - drag disabled */ }
    }

    // 预览框内滚轮缩放：从任意模式进入自定义高度模式，步进 5%
    const onWheel = (e) => {
      if (!ui.appliedBg || !ui.imgRatio) return
      e.preventDefault()
      let pct = ui.scalePct
      if (ui.scaleMode !== 'custom') {
        const rect = e.currentTarget.getBoundingClientRect()
        const disp = displaySize(rect.width, rect.height, ui.imgRatio)
        pct = clamp(Math.round((disp.h / Math.max(1, rect.height)) * 100), 20, 200)
        ui.scaleMode = 'custom'
        setScaleMode('custom')
      }
      const step = e.deltaY < 0 ? 5 : -5
      pct = clamp(pct + step, 20, 200)
      ui.scalePct = pct
      setScalePct(pct)
      apply()
    }

    const preview = ui.appliedBg ? buildBg(false)[currentScheme()] : null
    const canDrag = !!ui.appliedBg && !!ui.imgRatio && ui.scaleMode !== 'cover'

    const numField = (value, min, max, onChange, disabled) => React.createElement('input', {
      className: 'dsh-styl-num',
      type: 'number',
      min,
      max,
      value,
      disabled,
      onChange: (e) => onChange(clamp(e.target.value, min, max)),
    })
    const sliderRow = (label, value, min, max, onChange, disabled, suffix) => React.createElement('div', { className: 'dsh-styl-row' },
      React.createElement('span', { className: 'dsh-styl-hint' }, label),
      React.createElement('input', {
        className: 'dsh-styl-range',
        type: 'range',
        min,
        max,
        value,
        disabled,
        onChange: (e) => onChange(Number(e.target.value)),
      }),
      numField(value, min, max, onChange, disabled),
      React.createElement('span', { className: 'dsh-styl-hint' }, suffix || '%'),
    )

    const advancedGroups = React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'dsh-styl-group' },
        React.createElement('div', { className: 'dsh-styl-lbl' }, '侧边栏透明度（100% 不透明，0% 完全透明显示背景图）'),
        sliderRow('', sidebarOpacity, 0, 100, changeSidebarOpacity, false),
        React.createElement('div', { className: 'dsh-styl-hint' }, '中间值即半透明效果：背景图透出但被主题底色压暗，保证文字可读。'),
      ),
      React.createElement('div', { className: 'dsh-styl-group' },
        React.createElement('div', { className: 'dsh-styl-lbl' }, '右侧对话框（用户气泡）透明度'),
        sliderRow('', bubbleOpacity, 0, 100, changeBubbleOpacity, false),
      ),
      React.createElement('div', { className: 'dsh-styl-group' },
        React.createElement('div', { className: 'dsh-styl-lbl' }, '下方对话框（输入区）透明度'),
        sliderRow('', inputOpacity, 0, 100, changeInputOpacity, false),
      ),
      React.createElement('div', { className: 'dsh-styl-group' },
        React.createElement('div', { className: 'dsh-styl-lbl' }, 'Markdown 代码块透明度'),
        sliderRow('', codeOpacity, 0, 100, changeCodeOpacity, false),
        React.createElement('div', { className: 'dsh-styl-hint' }, '控制回复中代码块主体与标题栏的背景不透明度（含语法高亮底色），100% 为默认。'),
      ),
      React.createElement('div', { className: 'dsh-styl-group' },
        React.createElement('div', { className: 'dsh-styl-lbl' }, '输入区折叠'),
        React.createElement('div', { className: 'dsh-styl-row' },
          React.createElement('button', { className: 'dsh-styl-btn' + (foldComposer ? ' active' : ''), onClick: () => toggleFold(true) }, '开启'),
          React.createElement('button', { className: 'dsh-styl-btn' + (!foldComposer ? ' active' : ''), onClick: () => toggleFold(false) }, '关闭'),
        ),
        foldComposer
          ? sliderRow('折叠高度', foldLines, 1, 6, changeFoldLines, false, '行')
          : null,
        React.createElement('div', { className: 'dsh-styl-hint' }, '开启后：焦点不在输入区时文本区压缩为 N 行（保留余量），工具行（模型/访问模式/发送）保持显示，点击输入区展开全部。'),
      ),
    )

    return React.createElement('div', { className: 'dsh-styl-page' },
      React.createElement('div', { className: 'dsh-styl-row' },
        React.createElement('button', { className: 'dsh-styl-btn', onClick: resetDefaults }, '恢复默认设置'),
        React.createElement('button', { className: 'dsh-styl-btn', onClick: makeOpaque }, '全部不透明'),
        React.createElement('span', { className: 'dsh-styl-hint' }, '两者均不影响背景图。'),
      ),
      React.createElement('div', { className: 'dsh-styl-group' },
        React.createElement('div', { className: 'dsh-styl-lbl' }, '背景图'),
        React.createElement('div', { className: 'dsh-styl-row' },
          React.createElement('input', {
            className: 'dsh-styl-input',
            value: bgUrl,
            placeholder: 'https://example.com/bg.jpg',
            onChange: (e) => setBgUrl(e.target.value),
          }),
          React.createElement('button', { className: 'dsh-styl-btn', onClick: applyBg }, '应用'),
          React.createElement('button', { className: 'dsh-styl-btn', onClick: clearBg }, '清除'),
        ),
        React.createElement('div', { className: 'dsh-styl-row' },
          React.createElement('input', {
            type: 'file',
            accept: 'image/*',
            style: { display: 'none' },
            id: 'dsh-styl-file',
            onChange: pickFile,
          }),
          React.createElement('button', {
            className: 'dsh-styl-btn',
            onClick: () => {
              const el = document.getElementById('dsh-styl-file')
              if (el) el.click()
            },
          }, '选择本地图片…'),
          React.createElement('span', { className: 'dsh-styl-hint' }, '本地图片已存入浏览器本地，刷新后自动恢复，无需重选。'),
        ),
        React.createElement('div', { className: 'dsh-styl-row' },
          React.createElement('button', { className: 'dsh-styl-btn' + (flipBg ? ' active' : ''), onClick: () => toggleFlip(!flipBg) }, '⇄ 水平翻转'),
          React.createElement('span', { className: 'dsh-styl-hint' }, '开启后背景图左右镜像；翻转图生成需要一点加载时间（图片越大越慢），生成期间先显示原图。'),
        ),
        ui.flipFailed
          ? React.createElement('div', { className: 'dsh-styl-hint' }, '翻转生成失败：该图片来源不允许跨域读取（服务器未开放 CORS），已保持原图显示。可改用本地图片。')
          : null,
      ),
      React.createElement('div', { className: 'dsh-styl-group' },
        React.createElement('div', { className: 'dsh-styl-lbl' }, '预览（与页面窗口同比例）'),
        React.createElement('div', {
          className: 'dsh-styl-preview' + (dragging ? ' dragging' : ''),
          style: { width: 'min(100%, 400px, calc(280px * ' + ratio + '))', aspectRatio: String(ratio), background: preview || 'var(--dsw-alias-bg-layer-2)' },
          onMouseDown: startDrag,
          onWheel: onWheel,
        },
          React.createElement('span', { className: 'dsh-styl-preview-tag' }, '预览'),
          React.createElement('span', { className: 'dsh-styl-preview-hint' },
            !ui.appliedBg ? '未设置背景图'
              : canDrag ? '按住拖动调整位置 · 滚轮缩放'
                : ui.scaleMode === 'cover' ? '铺满模式下位置不可调 · 滚轮可缩放'
                  : '图片尺寸加载中…（完成后可拖动/缩放）'),
        ),
      ),
      React.createElement('div', { className: 'dsh-styl-group' },
        React.createElement('div', { className: 'dsh-styl-lbl' }, '缩放'),
        React.createElement('div', { className: 'dsh-styl-row' },
          React.createElement('button', { className: 'dsh-styl-btn' + (scaleMode === 'cover' ? ' active' : ''), onClick: () => pickScaleMode('cover') }, '铺满'),
          React.createElement('button', { className: 'dsh-styl-btn' + (scaleMode === 'contain' ? ' active' : ''), onClick: () => pickScaleMode('contain') }, '完整显示'),
          React.createElement('button', { className: 'dsh-styl-btn' + (scaleMode === 'custom' ? ' active' : ''), onClick: () => pickScaleMode('custom') }, '自定义高度'),
        ),
        scaleMode === 'custom'
          ? sliderRow('高度', scalePct, 20, 200, changeScalePct, false, '%')
          : null,
      ),
      React.createElement('div', { className: 'dsh-styl-group' },
        React.createElement('div', { className: 'dsh-styl-lbl' }, '位置' + (scaleMode === 'cover' ? '（铺满模式下无效）' : '')),
        sliderRow('水平', posX, 0, 100, changePosX, scaleMode === 'cover'),
        sliderRow('垂直', posY, 0, 100, changePosY, scaleMode === 'cover'),
        React.createElement('div', { className: 'dsh-styl-row' },
          React.createElement('button', { className: 'dsh-styl-btn', disabled: scaleMode === 'cover', onClick: centerPos }, '居中'),
        ),
      ),
      React.createElement('div', { className: 'dsh-styl-group' },
        React.createElement('div', { className: 'dsh-styl-lbl' }, '背景图透明度'),
        sliderRow('', opacity, 0, 100, changeOpacity, false),
      ),
      React.createElement('div', { className: 'dsh-styl-row' },
        React.createElement('button', { className: 'dsh-styl-btn', onClick: () => setShowAdvanced((v) => !v) }, (showAdvanced ? '收起' : '展开') + '高级选项（透明度/折叠）' + (showAdvanced ? ' ▴' : ' ▾')),
      ),
      showAdvanced ? advancedGroups : null,
      React.createElement('div', { className: 'dsh-styl-hint' }, '配置自动保存在本地浏览器（localStorage + IndexedDB）：刷新网页、更新插件后自动恢复；本地图片内容已存库，无需重新选择。'),
    )
  }

  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'appearance', order: 25, label: '外观' },
    (props) => React.createElement(StylSection, props),
  ))
}
