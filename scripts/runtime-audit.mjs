#!/usr/bin/env node
// Dev-only runtime audit lab: deterministic render, pointer/touch behavior, RSS memory.
// Not part of the app bundle. No env/credentials/process command lines.
// RSS uses /proc on Linux and selected Win32_Process fields on Windows.
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  if (!key.startsWith('--')) continue
  args[key.slice(2)] = process.argv[i + 1]
}
const currentDir = args.current
const baselineDir = args.baseline
const outJson = args.out
if (!currentDir || !outJson) {
  console.error('usage: node scripts/runtime-audit.mjs --current <dist> [--baseline <dist>] --out <json>')
  process.exit(2)
}
for (const dir of [currentDir, baselineDir].filter(Boolean)) {
  if (!existsSync(path.join(dir, 'index.html'))) {
    console.error(`dist not found: ${dir}`)
    process.exit(2)
  }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff': 'font/woff', '.woff2': 'font/woff2' }
function serve(root) {
  const server = http.createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      if (urlPath === '/') urlPath = '/index.html'
      const file = path.normalize(path.join(root, urlPath))
      if (!file.startsWith(path.normalize(root))) { res.writeHead(403); res.end(); return }
      const data = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
      res.end(data)
    } catch {
      res.writeHead(404); res.end('not found')
    }
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

// ---- safe RSS: only browser descendants of THIS audit node process ----
const selfPid = process.pid
function readStatus(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const comm = readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
    const ppid = Number((status.match(/^PPid:\s*(\d+)/m) || [])[1] || 0)
    const vmRSS = (status.match(/^VmRSS:\s*(\d+)\s*kB/m) || [])[1]
    return { pid, ppid, comm, vmRSSKb: vmRSS ? Number(vmRSS) : null }
  } catch { return null }
}
function processTable() {
  if (process.platform === 'win32') {
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name LIKE 'chrome%' OR Name LIKE 'headless_shell%'\" | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress",
    ], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    const parsed = JSON.parse(output)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.map(row => ({
      pid: Number(row.ProcessId), ppid: Number(row.ParentProcessId),
      comm: String(row.Name).replace(/\.exe$/i, ''),
      vmRSSKb: Math.round(Number(row.WorkingSetSize) / 1024),
    }))
  }
  const procs = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    const info = readStatus(Number(entry))
    if (info) procs.push(info)
  }
  return procs
}
function browserRSSKb() {
  const names = /^(headless_shell|chrome|chromium|chrome-headless)/
  const table = processTable()
  const byPid = new Map(table.map(info => [info.pid, info]))
  const isDescendantOfAudit = pid => {
    let cur = pid
    for (let depth = 0; depth < 64; depth++) {
      const info = byPid.get(cur)
      if (!info) return false
      if (info.ppid === selfPid) return true
      if (info.ppid <= 1) return false
      cur = info.ppid
    }
    return false
  }
  const procs = table.filter(info => info.pid !== selfPid && info.vmRSSKb !== null
    && names.test(info.comm) && isDescendantOfAudit(info.pid))
  const total = procs.reduce((sum, p) => sum + p.vmRSSKb, 0)
  return { totalKb: total, procs: procs.map(p => ({ pid: p.pid, comm: p.comm, rssKb: p.vmRSSKb })), sharedNotUnique: true }
}

// ---- helpers ----
const sleep = ms => new Promise(r => setTimeout(r, ms))
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const VIEW = { width: 1280, height: 800 }

async function canvasBox(page) {
  return page.evaluate(() => {
    const el = document.querySelector('canvas.drawing-canvas')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height, docW: el.width, docH: el.height }
  })
}
function docToClient(box, x, y) {
  return { x: box.left + x * box.width / box.docW, y: box.top + y * box.height / box.docH }
}
async function sampleCanvas(page) {
  return page.evaluate(() => {
    const el = document.querySelector('canvas.drawing-canvas')
    if (!el) return null
    const ctx = el.getContext('2d', { willReadFrequently: true })
    const { width, height } = el
    const img = ctx.getImageData(0, 0, width, height).data
    const step = 8
    const out = []
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4
        out.push(img[i], img[i + 1], img[i + 2], img[i + 3])
      }
    }
    return { width, height, step, pixels: out }
  })
}
function sampleStats(sample) {
  let hash = 0
  let nonBg = 0
  for (let i = 0; i < sample.pixels.length; i += 4) {
    const a = sample.pixels[i], b = sample.pixels[i + 1], c = sample.pixels[i + 2], d = sample.pixels[i + 3]
    hash = (Math.imul(hash, 31) + a * 3 + b * 5 + c * 7 + d) | 0
    if (!(a === 243 && b === 241 && c === 233)) nonBg++
  }
  return { hash, nonBg, total: sample.pixels.length / 4 }
}
function sameSample(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height || a.pixels.length !== b.pixels.length) return false
  for (let i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) return false
  return true
}
async function dispatchPenStroke(page, points, force) {
  const cdp = await page.context().newCDPSession(page)
  const first = points[0], last = points[points.length - 1]
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first.x, y: first.y, button: 'left', buttons: 1, clickCount: 1, force, pointerType: 'pen' })
  for (let i = 1; i < points.length - 1; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[i].x, y: points[i].y, button: 'left', buttons: 1, force, pointerType: 'pen' })
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last.x, y: last.y, button: 'left', buttons: 0, clickCount: 1, force, pointerType: 'pen' })
  await cdp.detach()
}
async function readAppState(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.drawing-canvas')
    const zoomBtn = document.querySelector('.zoom-value')
    const zoomFromStyle = canvas ? Number(canvas.style.width.replace('px', '')) / canvas.width : null
    return {
      canvasStyleW: canvas?.style.width ?? null,
      zoomText: zoomBtn?.textContent ?? null,
      zoomFromStyle: zoomFromStyle ? Number(zoomFromStyle.toFixed(4)) : null,
      stylusOnly: document.querySelector('.brush-panel input[type=checkbox]')?.checked ?? null,
    }
  })
}
async function metrics(page, cdp) {
  try { await cdp.send('Performance.enable') } catch { /* optional */ }
  const m = await cdp.send('Performance.getMetrics')
  const pick = name => m.metrics.find(x => x.name === name)?.value ?? null
  const heap = await page.evaluate(() => (window.gc ? (window.gc(), performance.memory?.usedJSHeapSize ?? null) : performance.memory?.usedJSHeapSize ?? null))
  return {
    jsHeapUsed: heap ?? pick('JSHeapUsedSize'),
    domNodes: pick('Nodes'),
    documents: pick('Documents'),
    jsListeners: pick('JSEventListeners'),
  }
}
async function gcPage(page, cdp) {
  try { await page.evaluate(() => window.gc && window.gc()) } catch { /* no expose-gc */ }
  try { await cdp.send('HeapProfiler.collectGarbage') } catch { /* optional */ }
}

const LAUNCH_BASE = {
  headless: true,
  args: ['--js-flags=--expose-gc', '--disable-dev-shm-usage', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1'],
}
const ignored = []
for (const pattern of [/Failed to load resource/, /the server responded with a status of 404/, /favicon/i, /net::ERR/, /does not have a service worker/i]) ignored.push(pattern)

async function openApp(rootDir, extraArgs = [], hasTouch = false) {
  const server = await serve(rootDir)
  const url = `http://127.0.0.1:${server.address().port}/`
  const browser = await chromium.launch({ ...LAUNCH_BASE, args: [...LAUNCH_BASE.args, ...extraArgs] })
  const context = await browser.newContext({ hasTouch, viewport: VIEW })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)))
  const consoleErrors = []
  page.on('console', m => { if (m.type() === 'error' && !ignored.some(p => p.test(m.text()))) consoleErrors.push(m.text().slice(0, 300)) })
  const cdp = await context.newCDPSession(page)
  await page.goto(url, { waitUntil: 'load', timeout: 30000 })
  await page.waitForSelector('canvas.drawing-canvas', { timeout: 15000 })
  await sleep(700) // hydrate + fitView
  return { server, browser, context, page, cdp, pageErrors, consoleErrors, close: async () => { await context.close().catch(() => {}); await browser.close().catch(() => {}); await new Promise(r => server.close(() => r())) } }
}

// Deterministic drawing: 4 seeded raster strokes + 12-point pen tool path (same every run)
async function drawSeededArtwork(page, seed = 1234567) {
  const rnd = mulberry32(seed)
  const box = await canvasBox(page)
  const strokes = []
  for (let s = 0; s < 4; s++) {
    const x0 = box.docW * (0.12 + rnd() * 0.15), y0 = box.docH * (0.12 + rnd() * 0.7)
    const len = box.docW * (0.35 + rnd() * 0.3), amp = box.docH * (0.05 + rnd() * 0.12)
    const freq = 1.5 + rnd() * 3
    const phase = rnd() * Math.PI * 2
    const pts = []
    const n = 24
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const d = docToClient(box, x0 + len * t, y0 + Math.sin(t * freq * Math.PI * 2 + phase) * amp)
      pts.push(d)
    }
    strokes.push(pts)
  }
  for (const pts of strokes) await dispatchPenStroke(page, pts, 0.8)
  await sleep(150)
  // 12-point pen tool path on a fresh vector layer (chooseTool('pen') auto-creates it)
  await page.keyboard.press('p')
  await sleep(120)
  const cx = box.docW / 2, cy = box.docH / 2, r = Math.min(box.docW, box.docH) * 0.2
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const c = docToClient(box, cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    await page.mouse.click(c.x, c.y)
    await sleep(30)
  }
  await page.keyboard.press('Enter')
  await sleep(250)
  await page.keyboard.press('b') // back to brush
  await sleep(120)
  return sampleCanvas(page)
}

// ---------- Test A ----------
async function testA() {
  const results = { currentGpuVsNoGpu: null, baselineVsCurrent: null }
  const runs = {}
  for (const tag of ['current-default', 'current-nogpu']) {
    const app = await openApp(currentDir, tag === 'current-nogpu' ? ['--disable-gpu'] : [])
    try {
      const before = await sampleCanvas(app.page)
      const after = await drawSeededArtwork(app.page)
      runs[tag] = {
        beforeStats: sampleStats(before), afterStats: sampleStats(after),
        sample: after, pageErrors: app.pageErrors.slice(), consoleErrors: app.consoleErrors.slice(),
      }
    } finally { await app.close() }
  }
  const a = runs['current-default'], b = runs['current-nogpu']
  const aDelta = a.afterStats.nonBg - a.beforeStats.nonBg
  const bDelta = b.afterStats.nonBg - b.beforeStats.nonBg
  results.currentGpuVsNoGpu = {
    identical: sameSample(a.sample, b.sample),
    currentChangedCanvas: aDelta > 100,
    noGpuChangedCanvas: bDelta > 100,
    currentDelta: aDelta, noGpuDelta: bDelta,
    currentHash: a.afterStats.hash, noGpuHash: b.afterStats.hash,
    currentErrors: a.pageErrors, noGpuErrors: b.pageErrors,
    pass: sameSample(a.sample, b.sample) && aDelta > 100 && bDelta > 100 && a.pageErrors.length === 0 && b.pageErrors.length === 0,
  }
  if (baselineDir) {
    const base = await openApp(baselineDir)
    try {
      const before = await sampleCanvas(base.page)
      const after = await drawSeededArtwork(base.page)
      const bs = { beforeStats: sampleStats(before), afterStats: sampleStats(after), sample: after, pageErrors: base.pageErrors.slice() }
      results.baselineVsCurrent = {
        identical: sameSample(bs.sample, a.sample),
        baselineHash: bs.afterStats.hash, currentHash: a.afterStats.hash,
        baselineChanged: bs.afterStats.nonBg - bs.beforeStats.nonBg > 100,
        baselineErrors: bs.pageErrors,
      }
    } finally { await base.close() }
  }
  return results
}

// ---------- Test B ----------
async function testB() {
  const app = await openApp(currentDir, [], true)
  try {
    const { page, cdp } = app
    const box = await canvasBox(page)
    const out = { hasTouch: true, pen: {}, touch: {}, pinch: {} }
    // pen pressure .2 and .8 must change canvas, no pageerror
    for (const force of [0.2, 0.8]) {
      const before = await sampleCanvas(page)
      const pts = []
      const rnd = mulberry32(777 + Math.round(force * 100))
      const x0 = box.docW * (0.1 + rnd() * 0.2), y0 = box.docH * (0.1 + rnd() * 0.2)
      for (let i = 0; i <= 20; i++) {
        const d = docToClient(box, x0 + box.docW * 0.5 * (i / 20), y0 + Math.sin(i / 20 * Math.PI * 2) * box.docH * 0.08)
        pts.push(d)
      }
      await dispatchPenStroke(page, pts, force)
      await sleep(200)
      const after = await sampleCanvas(page)
      const changed = !sameSample(before, after)
      out.pen[`force${force}`] = { changed, pageErrors: app.pageErrors.length }
      if (!changed) out.pen[`force${force}`].beforeNonBg = sampleStats(before).nonBg
    }
    // single touch with stylusOnly must not draw (stylusOnly defaults to true)
    const before = await sampleCanvas(page)
    const t = docToClient(box, box.docW * 0.5, box.docH * 0.55)
    const tcdp = await page.context().newCDPSession(page)
    await tcdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: t.x, y: t.y, id: 1 }] })
    await sleep(120)
    await tcdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(200)
    const afterTouch = await sampleCanvas(page)
    out.touch.singleTouchBlockedByStylusOnly = sameSample(before, afterTouch)
    // two-touch pinch must change zoom
    const zoomBefore = (await readAppState(page)).zoomFromStyle
    const p1 = { x: VIEW.width / 2 - 120, y: VIEW.height / 2 }, p2 = { x: VIEW.width / 2 + 120, y: VIEW.height / 2 }
    await tcdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p1.x, y: p1.y, id: 1 }, { x: p2.x, y: p2.y, id: 2 }] })
    for (let i = 1; i <= 6; i++) {
      const d = 120 - i * 12
      await tcdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: VIEW.width / 2 - d, y: VIEW.height / 2, id: 1 }, { x: VIEW.width / 2 + d, y: VIEW.height / 2, id: 2 }] })
      await sleep(40)
    }
    await tcdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(300)
    const zoomAfter = (await readAppState(page)).zoomFromStyle
    await tcdp.detach()
    out.pinch.zoomBefore = zoomBefore
    out.pinch.zoomAfter = zoomAfter
    out.pinch.changed = zoomBefore !== null && zoomAfter !== null && Math.abs(zoomAfter - zoomBefore) > 1e-6
    out.pageErrors = app.pageErrors.slice()
    out.pass = out.pen['force0.2'].changed && out.pen['force0.8'].changed && app.pageErrors.length === 0
      && out.touch.singleTouchBlockedByStylusOnly && out.pinch.changed
    return out
  } finally { await app.close() }
}

// ---------- Test C + D ----------
async function testMemoryOne(rootDir, label) {
  const app = await openApp(rootDir)
  const m = { label, rss: {}, heap: {} }
  try {
    const { page, cdp } = app
    await sleep(400)
    m.rss.blankKb = browserRSSKb()
    // app 2048 after warmup + GC
    await drawSeededArtwork(page, 424242)
    await sleep(400)
    await gcPage(page, cdp)
    await sleep(300)
    m.heap.app2048 = await metrics(page, cdp)
    m.rss.app2048Kb = browserRSSKb()
    // new 4096 document (UI: Новый -> set 4096 -> Создать холст)
    await page.click('button.text-button:has-text("Новый")')
    await sleep(200)
    await page.fill('.dimension-fields input[type=number] >> nth=0', '4096')
    await page.fill('.dimension-fields input[type=number] >> nth=1', '4096')
    await page.click('button.accent-button.large:has-text("Создать холст")')
    await sleep(700) // fitView
    m.heap.new4096 = await metrics(page, cdp)
    m.rss.new4096PreFillKb = browserRSSKb()
    // center fill: fill tool, click canvas center, wall time, RGBA must change
    await page.keyboard.press('g')
    await sleep(150)
    const box = await canvasBox(page)
    const c = docToClient(box, box.docW / 2, box.docH / 2)
    const rgbaBefore = await page.evaluate(pt => {
      const el = document.querySelector('canvas.drawing-canvas')
      const ctx = el.getContext('2d', { willReadFrequently: true })
      const x = clampPx(Math.round(pt.docX)), y = clampPx(Math.round(pt.docY))
      return Array.from(ctx.getImageData(x, y, 1, 1).data)
      function clampPx(v) { return Math.max(0, Math.min(el.width - 1, v)) }
    }, { docX: box.docW / 2, docY: box.docH / 2 })
    const t0 = performance.now()
    await page.mouse.click(c.x, c.y)
    await page.waitForTimeout(50)
    const fillWallMs = performance.now() - t0
    await sleep(300)
    m.fill = { wallMs: Math.round(fillWallMs * 100) / 100 }
    const rgbaAfter = await page.evaluate(pt => {
      const el = document.querySelector('canvas.drawing-canvas')
      const ctx = el.getContext('2d', { willReadFrequently: true })
      const x = clampPx(Math.round(pt.docX)), y = clampPx(Math.round(pt.docY))
      return Array.from(ctx.getImageData(x, y, 1, 1).data)
      function clampPx(v) { return Math.max(0, Math.min(el.width - 1, v)) }
    }, { docX: box.docW / 2, docY: box.docH / 2 })
    m.fill.centerRgbaBefore = rgbaBefore
    m.fill.centerRgbaAfter = rgbaAfter
    m.fill.centerRgbaChanged = rgbaBefore.join(',') !== rgbaAfter.join(',')
    await gcPage(page, cdp)
    await sleep(300)
    m.heap.postFill = await metrics(page, cdp)
    m.rss.postFillKb = browserRSSKb()
    // 3 undo/redo cycles with heap/listeners/DOM/RSS tracking
    m.cycles = []
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Control+z')
      await sleep(250)
      await page.keyboard.press('Control+Shift+z')
      await sleep(250)
      await gcPage(page, cdp)
      const mm = await metrics(page, cdp)
      m.cycles.push({ cycle: i + 1, ...mm, rssKb: browserRSSKb().totalKb })
    }
    m.pageErrors = app.pageErrors.slice()
    m.crash = app.pageErrors.some(e => /out of memory|aw snap|terminated|crash/i.test(e))
  } finally { await app.close() }
  return m
}
function testD(current, baseline) {
  if (!baseline) return { evaluated: false, reason: 'no baseline given' }
  const r = (a, b) => (b - a) / b
  const preDrop = r(current.rss.new4096PreFillKb.totalKb, baseline.rss.new4096PreFillKb.totalKb)
  const postDrop = r(current.rss.postFillKb.totalKb, baseline.rss.postFillKb.totalKb)
  const fillRatio = current.fill.wallMs / baseline.fill.wallMs
  const last = current.cycles[current.cycles.length - 1]
  const first = current.cycles[0]
  const heapGrow = last.jsHeapUsed - first.jsHeapUsed
  const domGrow = last.domNodes - first.domNodes
  const rssGrow = last.rssKb - first.rssKb
  const checks = {
    prefillDropGte25: preDrop >= 0.25,
    postfillDropGte15: postDrop >= 0.15,
    fillTimeLte120: fillRatio <= 1.2,
    noCrash: !current.crash && !baseline.crash,
    noGrowth: heapGrow <= 8 * 1024 * 1024 && domGrow <= 50 && rssGrow <= 64 * 1024,
  }
  return {
    evaluated: true, checks, pass: Object.values(checks).every(Boolean),
    prefillDropPct: Math.round(preDrop * 1000) / 10,
    postfillDropPct: Math.round(postDrop * 1000) / 10,
    fillTimeRatioPct: Math.round(fillRatio * 1000) / 10,
    heapGrowBytes: heapGrow, domGrow: domGrow, rssGrowKb: rssGrow,
    thresholds: { prefillDrop: '>=25%', postfillDrop: '>=15%', fillTime: '<=120%', growth: 'heap<=8MB, DOM<=50 nodes, RSS<=64MB per 3 cycles' },
  }
}

async function testStrokeLatency(rootDir, label) {
  const app = await openApp(rootDir)
  try {
    const { page } = app
    await page.evaluate(() => {
      const samples = []
      let inputAt = null
      const canvas = document.querySelector('canvas.drawing-canvas')
      canvas.addEventListener('pointermove', () => { inputAt = performance.now() }, true)
      const raf = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = callback => raf(time => {
        callback(time)
        if (inputAt !== null) {
          samples.push(performance.now() - inputAt)
          inputAt = null
        }
      })
      window.__strokeLatencySamples = samples
    })
    const box = await canvasBox(page)
    const points = []
    for (let i = 0; i <= 64; i++) {
      const x = box.docW * (0.2 + 0.6 * i / 64)
      const y = box.docH * (0.45 + Math.sin(i / 8) * 0.08)
      points.push(docToClient(box, x, y))
    }
    await dispatchPenStroke(page, points, 0.8)
    await sleep(500)
    const samples = await page.evaluate(() => window.__strokeLatencySamples.slice())
    const sorted = samples.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
    const percentile = q => sorted.length ? sorted[Math.floor((sorted.length - 1) * q)] : null
    return {
      label, sampleCount: sorted.length,
      p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) ?? null,
      pageErrors: app.pageErrors.slice(),
      pass: sorted.length > 0 && app.pageErrors.length === 0,
    }
  } finally { await app.close() }
}

// ---------- main ----------
const started = Date.now()
console.log(`[audit] current=${currentDir} baseline=${baselineDir || '(none)'}`)
const A = await testA()
console.log('[audit] A done:', JSON.stringify({ gpuVsNoGpu: A.currentGpuVsNoGpu.pass, identical: A.currentGpuVsNoGpu.identical, baselineCompare: A.baselineVsCurrent?.identical ?? null }))
const B = await testB()
console.log('[audit] B done: pass=%s pen.2=%s pen.8=%s touchBlocked=%s pinch=%s errors=%d',
  B.pass, B.pen['force0.2'].changed, B.pen['force0.8'].changed, B.touch.singleTouchBlockedByStylusOnly, B.pinch.changed, B.pageErrors.length)
const memCurrent = await testMemoryOne(currentDir, 'current')
console.log('[audit] C current done: prefill=%dMB postfill=%dMB fill=%sms',
  Math.round(memCurrent.rss.new4096PreFillKb.totalKb / 1024), Math.round(memCurrent.rss.postFillKb.totalKb / 1024), memCurrent.fill.wallMs)
let memBaseline = null
if (baselineDir) {
  memBaseline = await testMemoryOne(baselineDir, 'baseline')
  console.log('[audit] C baseline done: prefill=%dMB postfill=%dMB fill=%sms',
    Math.round(memBaseline.rss.new4096PreFillKb.totalKb / 1024), Math.round(memBaseline.rss.postFillKb.totalKb / 1024), memBaseline.fill.wallMs)
}
const D = testD(memCurrent, memBaseline)
console.log('[audit] D:', D.evaluated ? (D.pass ? `PASS prefill -${D.prefillDropPct}% postfill -${D.postfillDropPct}% fill ${D.fillTimeRatioPct}%` : `FAIL ${JSON.stringify(D.checks)}`) : 'not evaluated')
const latencyCurrent = await testStrokeLatency(currentDir, 'current')
let latencyBaseline = null
if (baselineDir) {
  latencyBaseline = await testStrokeLatency(baselineDir, 'baseline')
}
console.log('[audit] E stroke latency: current p50=%sms p95=%sms baseline p50=%sms p95=%sms',
  latencyCurrent.p50Ms?.toFixed(2), latencyCurrent.p95Ms?.toFixed(2),
  latencyBaseline?.p50Ms?.toFixed(2) ?? 'n/a', latencyBaseline?.p95Ms?.toFixed(2) ?? 'n/a')

const report = {
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - started,
  environment: {
    node: process.version,
    playwright: JSON.parse(readFileSync(new URL('../node_modules/playwright/package.json', import.meta.url), 'utf8')).version,
    viewport: VIEW,
    rssNote: process.platform === 'win32'
      ? 'Working set via Win32_Process (selected fields only, no command lines), only browser descendants of the audit node. Includes shared pages (shared, not unique).'
      : 'RSS via /proc/<pid>/status VmRSS, only descendants of audit node with comm headless_shell/chrome/chromium. RSS includes shared pages (shared, not unique).',
  },
  tests: { A, B, C: { current: memCurrent, baseline: memBaseline }, D, E: { current: latencyCurrent, baseline: latencyBaseline } },
  unverifiedPhysicalDrivers: [
    'Real stylus digitizer drivers (Wacom/Windows Ink) and true pressure curve on physical hardware',
    'Physical multi-touch touchscreen pinch-to-zoom (headless CDP synthesis only)',
    'GPU/raster behavior on real device GPUs (headless SwiftShader/software only)',
  ],
}
report.summary = {
  A_pass: A.currentGpuVsNoGpu.pass,
  B_pass: B.pass,
  C_memoryPass: D.evaluated ? D.pass : null,
  E_strokeLatencyPass: latencyCurrent.pass && (latencyBaseline ? latencyBaseline.pass : true),
  memoryOptimization: D.evaluated ? (D.pass ? 'PASS' : 'FAIL') : 'NOT_EVALUATED (no baseline)',
}
mkdirSync(path.dirname(outJson), { recursive: true })
const { writeFileSync } = await import('node:fs')
writeFileSync(outJson, JSON.stringify(report, null, 2))
console.log(`[audit] report written: ${outJson}`)
process.exit(report.summary.A_pass && report.summary.B_pass ? 0 : 1)
