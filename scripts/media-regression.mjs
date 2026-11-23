#!/usr/bin/env node
// Dev-only media production regression audit: honest E2E over the production
// build served by a loopback static server, driven with Playwright. Covers
// scenario 11 (scan import + stencil toggle) and scenario 12 (vertical and
// radial symmetry). Same constraints as advanced-regression.mjs: no DEV hooks,
// no external network, no credentials, deterministic local PNG (no network),
// fresh isolated context per scenario. Does not modify src/ or other audits.
import http from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright'

const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  if (!key.startsWith('--')) continue
  args[key.slice(2)] = process.argv[i + 1]
}
const distDir = args.dist || '/tmp/trafaret-current-dist'
const outJson = args.out || '/mnt/agents/private/trafaret-audit/media-regression.json'
if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error(`production dist not found: ${distDir}`)
  process.exit(2)
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

// ---------- deterministic local PNG (no network, pure function of coordinates) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
// 512x512 RGB PNG: warm paper background with dark diagonal stripes and a ring.
function makeDeterministicPng() {
  const W = 512, H = 512
  const raw = Buffer.alloc((W * 3 + 1) * H)
  const pixel = (x, y) => {
    const stripe = Math.floor((x + y) / 36) % 2 === 0
    const dx = x - 256, dy = y - 256
    const ring = Math.abs(Math.hypot(dx, dy) - 170) < 14
    const dot = Math.hypot(dx - 90, dy + 60) < 26
    if (stripe || ring || dot) return [0x1c, 0x1e, 0x1a]
    return [0xe9, 0xe4, 0xd4]
  }
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0 // filter: none
    for (let x = 0; x < W; x++) {
      const [r, g, b] = pixel(x, y)
      const o = y * (W * 3 + 1) + 1 + x * 3
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const shotsDir = path.join(path.dirname(outJson), 'screenshots', 'media-regression')
mkdirSync(shotsDir, { recursive: true })

const LAUNCH = {
  headless: true,
  args: ['--disable-dev-shm-usage', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1'],
}
const VIEW = { width: 1400, height: 900 }

function attachTrackers(page) {
  const t = {
    pageErrors: [], consoleErrors: [], responses: [], failed: [], external: [],
    badResponses: [],
  }
  page.on('pageerror', e => t.pageErrors.push(String(e).slice(0, 400)))
  page.on('console', m => { if (m.type() === 'error') t.consoleErrors.push(m.text().slice(0, 400)) })
  page.on('response', res => {
    const rec = { url: res.url(), status: res.status() }
    t.responses.push(rec)
    if (res.status() >= 400) t.badResponses.push(rec)
  })
  page.on('requestfailed', req => t.failed.push({ url: req.url(), error: String(req.failure()?.errorText || '').slice(0, 200) }))
  page.on('request', req => {
    try {
      const u = new URL(req.url())
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') t.external.push(req.url())
    } catch { /* non-http scheme */ }
  })
  return t
}
function errorSummary(t) {
  return {
    pageErrors: t.pageErrors, consoleErrors: t.consoleErrors,
    badResponses: t.badResponses, failedLocal: t.failed, externalRequests: t.external,
    clean: t.pageErrors.length === 0 && t.consoleErrors.length === 0 && t.badResponses.length === 0 && t.failed.length === 0 && t.external.length === 0,
  }
}

let server = null
let browser = null
async function freshContext({ viewport = VIEW } = {}) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const trackers = attachTrackers(page)
  const url = `http://127.0.0.1:${server.address().port}/`
  await page.goto(url, { waitUntil: 'load', timeout: 30000 })
  await page.waitForSelector('canvas.drawing-canvas', { timeout: 15000 })
  await page.waitForSelector('.loading-cover', { state: 'detached', timeout: 15000 }).catch(() => {})
  await sleep(800) // hydrate + fitView + idle diagnostics
  return { context, page, trackers, url }
}

async function canvasBox(page) {
  return page.evaluate(() => {
    const el = document.querySelector('canvas.drawing-canvas')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height, docW: el.width, docH: el.height }
  })
}
const docToClient = (box, x, y) => ({ x: box.left + x * box.width / box.docW, y: box.top + y * box.height / box.docH })

async function sampleGrid(page, step = 8) {
  return page.evaluate(step => {
    const el = document.querySelector('canvas.drawing-canvas')
    const ctx = el.getContext('2d', { willReadFrequently: true })
    const { width, height } = el
    const img = ctx.getImageData(0, 0, width, height).data
    const out = []
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4
        out.push(img[i], img[i + 1], img[i + 2], img[i + 3])
      }
    }
    let h1 = 0, h2 = 0
    for (let i = 0; i < out.length; i++) { h1 = (Math.imul(h1, 31) + out[i]) | 0; h2 = (Math.imul(h2, 17) + out[i] * 3) | 0 }
    return { width, height, step, count: out.length / 4, hash: `${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`, pixels: out }
  }, step)
}
function diffPixels(a, b) {
  if (!a || !b || a.pixels.length !== b.pixels.length) return -1
  let n = 0
  for (let i = 0; i < a.pixels.length; i += 4) {
    if (a.pixels[i] !== b.pixels[i] || a.pixels[i + 1] !== b.pixels[i + 1] || a.pixels[i + 2] !== b.pixels[i + 2] || a.pixels[i + 3] !== b.pixels[i + 3]) n++
  }
  return n
}

// Regional probe: count non-background pixels in a (2*half)^2 doc-space region.
// A region result requires many ink pixels, not a single antialiased pixel.
const isBackground = rgba => rgba[0] === 243 && rgba[1] === 241 && rgba[2] === 233
async function regionProbe(page, cx, cy, half = 22) {
  return page.evaluate(([cx, cy, half]) => {
    const el = document.querySelector('canvas.drawing-canvas')
    const ctx = el.getContext('2d', { willReadFrequently: true })
    const x0 = Math.max(0, Math.floor(cx - half))
    const y0 = Math.max(0, Math.floor(cy - half))
    const w = Math.min(el.width, Math.ceil(cx + half)) - x0
    const h = Math.min(el.height, Math.ceil(cy + half)) - y0
    const d = ctx.getImageData(x0, y0, w, h).data
    let nonBg = 0
    for (let i = 0; i < d.length; i += 4) {
      if (!(d[i] === 243 && d[i + 1] === 241 && d[i + 2] === 233)) nonBg++
    }
    return { cx, cy, half, x0, y0, w, h, total: w * h, nonBackground: nonBg }
  }, [cx, cy, half])
}

// Deterministic pen stroke via CDP (pointerType 'pen', fixed pressure path).
async function penStroke(page, box, docPts, force = 0.8) {
  const pts = docPts.map(([x, y]) => docToClient(box, x, y))
  const cdp = await page.context().newCDPSession(page)
  const first = pts[0], last = pts[pts.length - 1]
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first.x, y: first.y, button: 'left', buttons: 1, clickCount: 1, force, pointerType: 'pen' })
  for (let i = 1; i < pts.length - 1; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[i].x, y: pts[i].y, button: 'left', buttons: 1, force, pointerType: 'pen' })
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last.x, y: last.y, button: 'left', buttons: 0, clickCount: 1, force, pointerType: 'pen' })
  await cdp.detach()
  await sleep(300)
}

// ---------- Scenario 11: deterministic PNG scan import via real file input; stencil toggle changes composite ----------
async function s11ScanImportStencil() {
  const { context, page, trackers } = await freshContext()
  try {
    const devHookAbsent = await page.evaluate(() => typeof window.__tattooStudio === 'undefined')
    const pngPath = '/tmp/trafaret-audit-scan-deterministic.png'
    await writeFile(pngPath, makeDeterministicPng())

    const box = await canvasBox(page)
    const baseline = await sampleGrid(page)

    // real scan file input accepting images, inside the scan section
    const input = page.locator('.scan-section input[type=file]')
    const inputInfo = await input.evaluate(el => ({ accept: el.accept, type: el.type }))
    const acceptOk = typeof inputInfo.accept === 'string' && inputInfo.accept.split(',').some(t => t.trim().startsWith('image/'))

    // open the layers/scan drawer via the real toggle; on desktop (>=1280px)
    // the toggle is display:none and the right panel is already in the grid
    const layersToggle = page.locator('button[aria-label="Слои и скан"]')
    if (await layersToggle.isVisible()) {
      await layersToggle.click()
      await sleep(350)
    }
    await page.setInputFiles('.scan-section input[type=file]', pngPath)

    // a scan layer row «Скан · …» must appear
    const scanRowName = page.locator('.layer-row .layer-name', { hasText: /^Скан ·/ })
    await scanRowName.first().waitFor({ state: 'visible', timeout: 10000 })
    const scanLayerName = (await scanRowName.first().textContent())?.trim() ?? null
    // image decode + composite render are async: poll the sampled composite until it changes
    let imported = baseline, importDiff = 0, waited = 0
    while (waited < 10000) {
      await sleep(300)
      waited += 300
      imported = await sampleGrid(page)
      importDiff = diffPixels(baseline, imported)
      if (importDiff > 0) break
    }

    // real stencil toggle via keyboard shortcut T; footer button must flip to pressed
    await page.keyboard.press('t')
    await sleep(500)
    const stencilButton = page.locator('.view-modes button', { hasText: 'Трафарет' })
    const stencilPressed = await stencilButton.getAttribute('aria-pressed') === 'true'
    const stenciled = await sampleGrid(page)
    const stencilDiff = diffPixels(imported, stenciled)
    await page.screenshot({ path: path.join(shotsDir, '11-scan-stencil.png') })

    const err = errorSummary(trackers)
    const ok = devHookAbsent && acceptOk && scanLayerName !== null
      && importDiff > 0 && stencilPressed && stencilDiff > 0 && err.clean
    return {
      status: ok ? 'PASS' : 'FAIL',
      evidence: {
        devHookAbsent,
        input: inputInfo, acceptAllowsImages: acceptOk,
        scanLayerName,
        png: { path: pngPath, bytes: makeDeterministicPng().length, createdLocally: true, networkUsed: false },
        hashes: { baseline: baseline.hash, imported: imported.hash, stenciled: stenciled.hash },
        importChangedPixels: importDiff,
        stencilToggle: { via: 'keyboard key T', buttonAriaPressed: stencilPressed, changedPixels: stencilDiff },
        screenshot: path.join(shotsDir, '11-scan-stencil.png'),
        ...err,
      },
    }
  } finally { await context.close().catch(() => {}) }
}

// ---------- Scenario 12a: vertical symmetry via M key; one pen stroke inks original + mirror-x regions ----------
async function s12VerticalSymmetry() {
  const { context, page, trackers } = await freshContext()
  try {
    const box = await canvasBox(page)
    const DOC_W = box.docW
    const axis = DOC_W / 2

    await page.keyboard.press('m') // real key: symmetry off -> vertical
    await sleep(400)
    const symmetryButton = page.locator('.view-modes button', { hasText: 'Симметрия' })
    const symmetryButtonActive = await symmetryButton.evaluate(el => el.classList.contains('active'))

    // dense horizontal stroke strictly left of the axis (y=600, x 500..800)
    const docPts = Array.from({ length: 25 }, (_, i) => [500 + i * (300 / 24), 600])
    const mirrorOf = ([x, y]) => [DOC_W - x, y]
    const origRegion = [650, 600]
    const mirrorRegion = mirrorOf(origRegion)

    const before = await sampleGrid(page)
    const preOrig = await regionProbe(page, origRegion[0], origRegion[1])
    const preMirror = await regionProbe(page, mirrorRegion[0], mirrorRegion[1])

    await penStroke(page, box, docPts, 0.8)

    const after = await sampleGrid(page)
    const postOrig = await regionProbe(page, origRegion[0], origRegion[1])
    const postMirror = await regionProbe(page, mirrorRegion[0], mirrorRegion[1])
    await page.screenshot({ path: path.join(shotsDir, '12-symmetry-vertical.png') })

    const INK_MIN = 40 // many ink pixels, not an antialiased single pixel
    const BG_MAX = 5   // regions are clean background before the stroke
    const origInk = preOrig.nonBackground <= BG_MAX && postOrig.nonBackground >= INK_MIN
    const mirrorInk = preMirror.nonBackground <= BG_MAX && postMirror.nonBackground >= INK_MIN
    const err = errorSummary(trackers)
    return {
      status: (symmetryButtonActive && origInk && mirrorInk && err.clean) ? 'PASS' : 'FAIL',
      evidence: {
        toggledVia: 'keyboard key M',
        symmetryButtonActive,
        docWidth: DOC_W, axisX: axis,
        stroke: { points: docPts.length, from: docPts[0], to: docPts[docPts.length - 1] },
        probes: {
          original: { region: origRegion, pre: preOrig.nonBackground, post: postOrig.nonBackground, inkProven: origInk },
          mirrorX: { region: mirrorRegion, pre: preMirror.nonBackground, post: postMirror.nonBackground, inkProven: mirrorInk },
        },
        strokeChangedPixels: diffPixels(before, after),
        hashes: { before: before.hash, after: after.hash },
        screenshot: path.join(shotsDir, '12-symmetry-vertical.png'),
        ...err,
      },
    }
  } finally { await context.close().catch(() => {}) }
}

// ---------- Scenario 12b: radial symmetry via real «Круг» button, default 6 sectors; one pen stroke inks 6 rotated regions ----------
async function s12RadialSymmetry() {
  const { context, page, trackers } = await freshContext()
  try {
    const box = await canvasBox(page)
    const cx = box.docW / 2, cy = box.docH / 2

    // open the construction panel via the real toggle; on desktop (>=1280px)
    // the toggle is display:none and the left panel is already in the grid
    const brushToggle = page.locator('button[aria-label="Настройки кисти"]')
    if (await brushToggle.isVisible()) {
      await brushToggle.click()
      await sleep(350)
    }
    // the «Симметрия» option-block holds the radial «Круг» segmented button
    // (the guide block's «Круг» button carries aria-label and is a different control)
    const symmetryBlock = page.locator('.document-section .option-block', { hasText: 'Симметрия' })
    const radialButton = symmetryBlock.locator('.segmented-control button', { hasText: 'Круг' })
    await radialButton.click()
    await sleep(400)
    const radialActive = await radialButton.evaluate(el => el.classList.contains('active'))
    const sectorsSlider = symmetryBlock.locator('input')
    await sectorsSlider.waitFor({ state: 'visible', timeout: 5000 })
    const sectors = await sectorsSlider.evaluate(el => ({ sliderPresent: true, value: Number(el.value) }))
    const radialCountDefault = sectors.sliderPresent && sectors.value === 6

    // one dense stroke parallel to a ray, offset 40px from it so overlay rays
    // (drawn on the composite) cannot be mistaken for ink inside probe regions
    const docPts = Array.from({ length: 25 }, (_, i) => [cx + 120 + i * (200 / 24), cy + 40])
    const rotate = ([x, y], angle) => {
      const cos = Math.cos(angle), sin = Math.sin(angle)
      const dx = x - cx, dy = y - cy
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
    }
    // copies are drawn every 60° (2π/6), so probe all six rotated regions of the full circle
    const probeCenters = Array.from({ length: 6 }, (_, k) => rotate([cx + 220, cy + 40], k * (2 * Math.PI / 6)))

    const before = await sampleGrid(page)
    const pre = []
    for (const [px, py] of probeCenters) pre.push(await regionProbe(page, px, py))

    await penStroke(page, box, docPts, 0.8)

    const after = await sampleGrid(page)
    const post = []
    for (const [px, py] of probeCenters) post.push(await regionProbe(page, px, py))
    await page.screenshot({ path: path.join(shotsDir, '12-symmetry-radial.png') })

    const INK_MIN = 40
    const BG_MAX = 5
    const regionResults = probeCenters.map(([px, py], k) => ({
      sector: k, region: [Math.round(px), Math.round(py)],
      pre: pre[k].nonBackground, post: post[k].nonBackground,
      inkProven: pre[k].nonBackground <= BG_MAX && post[k].nonBackground >= INK_MIN,
    }))
    const inkedSectors = regionResults.filter(r => r.inkProven).length
    const err = errorSummary(trackers)
    return {
      status: (radialActive && radialCountDefault && inkedSectors === 6 && err.clean) ? 'PASS' : 'FAIL',
      evidence: {
        toggledVia: 'real «Круг» button in DocumentPanel',
        radialActive,
        radialCount: sectors,
        center: [cx, cy],
        stroke: { points: docPts.length, from: docPts[0].map(Math.round), to: docPts[docPts.length - 1].map(Math.round) },
        probes: regionResults,
        inkedSectors,
        strokeChangedPixels: diffPixels(before, after),
        hashes: { before: before.hash, after: after.hash },
        screenshot: path.join(shotsDir, '12-symmetry-radial.png'),
        ...err,
      },
    }
  } finally { await context.close().catch(() => {}) }
}

// ---------- main ----------
const started = Date.now()
console.log(`[audit] production dist=${distDir}`)
console.log(`[audit] out=${outJson}`)
server = await serve(distDir)
browser = await chromium.launch(LAUNCH)

const scenarios = [
  ['11-scan-import-stencil', 'Deterministic local PNG via real scan input (accept image); «Скан ·» layer appears; composite changes; Трафарет toggle (key T) changes composite', s11ScanImportStencil],
  ['12-symmetry-vertical', 'Vertical symmetry via key M; one pen stroke inks original and mirror-x regions (regional probes)', s12VerticalSymmetry],
  ['12-symmetry-radial', 'Radial symmetry via real «Круг» button, default 6 sectors; one pen stroke inks 6 rotated regions (regional probes)', s12RadialSymmetry],
]

const report = {
  generatedAt: new Date().toISOString(),
  durationMs: 0,
  environment: {
    dist: distDir,
    node: process.version,
    playwright: JSON.parse(readFileSync(new URL('../node_modules/playwright/package.json', import.meta.url), 'utf8')).version,
    viewport: VIEW,
    loopbackOnly: true,
    devHookUsed: false,
  },
  scenarios: {},
}

let pass = 0, fail = 0
for (const [id, description, fn] of scenarios) {
  const t0 = Date.now()
  try {
    const result = await fn()
    report.scenarios[id] = { description, durationMs: Date.now() - t0, ...result }
    if (result.status === 'PASS') pass++
    else fail++
    console.log(`[audit] ${id}: ${result.status} (${Date.now() - t0}ms)`)
  } catch (e) {
    fail++
    report.scenarios[id] = { description, durationMs: Date.now() - t0, status: 'FAIL', evidence: { crashed: String(e).slice(0, 500) } }
    console.log(`[audit] ${id}: FAIL (exception) ${String(e).slice(0, 200)}`)
  }
}

report.summary = {
  pass, fail, notTested: 0,
  exitCode: fail === 0 ? 0 : 1,
}
report.durationMs = Date.now() - started
mkdirSync(path.dirname(outJson), { recursive: true })
await writeFile(outJson, JSON.stringify(report, null, 2))
console.log(`[audit] PASS=${pass} FAIL=${fail} report=${outJson}`)

await browser.close().catch(() => {})
await new Promise(r => server.close(() => r()))
process.exit(report.summary.exitCode)
