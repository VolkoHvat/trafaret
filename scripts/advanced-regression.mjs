#!/usr/bin/env node
// Dev-only advanced production regression audit: honest E2E over the production
// build served by a loopback static server, driven with Playwright. Same
// constraints as production-regression.mjs: no DEV hooks, no external network,
// no credentials, fresh isolated context per scenario. Does not modify src/.
import http from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  if (!key.startsWith('--')) continue
  args[key.slice(2)] = process.argv[i + 1]
}
const distDir = args.dist || '/tmp/trafaret-current-dist'
const outJson = args.out || '/mnt/agents/private/trafaret-audit/advanced-regression.json'
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

const sleep = ms => new Promise(r => setTimeout(r, ms))
const shotsDir = path.join(path.dirname(outJson), 'screenshots', 'advanced-regression')
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
async function freshContext({ viewport = VIEW, initScript } = {}) {
  const context = await browser.newContext({ viewport })
  if (initScript) await context.addInitScript(initScript)
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

// Exact full-canvas sample: raw RGBA every `step` px, compared byte-for-byte in Node.
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
const exactEqual = (a, b) => diffPixels(a, b) === 0
function diffLocations(a, b, limit = 12) {
  if (!a || !b) return []
  const out = []
  const columns = Math.ceil(a.width / a.step)
  for (let i = 0; i < a.pixels.length && out.length < limit; i += 4) {
    if (a.pixels[i] === b.pixels[i] && a.pixels[i + 1] === b.pixels[i + 1]
      && a.pixels[i + 2] === b.pixels[i + 2] && a.pixels[i + 3] === b.pixels[i + 3]) continue
    const pixel = i / 4
    out.push({
      x: (pixel % columns) * a.step, y: Math.floor(pixel / columns) * a.step,
      before: a.pixels.slice(i, i + 4), after: b.pixels.slice(i, i + 4),
    })
  }
  return out
}

async function readPixel(page, docX, docY) {
  return page.evaluate(([x, y]) => {
    const el = document.querySelector('canvas.drawing-canvas')
    const ctx = el.getContext('2d', { willReadFrequently: true })
    const px = Math.max(0, Math.min(el.width - 1, Math.floor(x)))
    const py = Math.max(0, Math.min(el.height - 1, Math.floor(y)))
    return Array.from(ctx.getImageData(px, py, 1, 1).data)
  }, [docX, docY])
}
const isBackground = rgba => rgba[0] === 243 && rgba[1] === 241 && rgba[2] === 233

async function rectSelect(page, box, a, b) {
  await page.keyboard.press('a')
  await sleep(150)
  const A = docToClient(box, a[0], a[1]), B = docToClient(box, b[0], b[1])
  await page.mouse.move(A.x, A.y)
  await page.mouse.down()
  await page.mouse.move((A.x + B.x) / 2, (A.y + B.y) / 2, { steps: 4 })
  await page.mouse.move(B.x, B.y, { steps: 4 })
  await page.mouse.up()
  await sleep(250)
}

async function fillAt(page, box, docX, docY) {
  await page.keyboard.press('g')
  await sleep(200)
  const c = docToClient(box, docX, docY)
  await page.mouse.click(c.x, c.y)
  await sleep(300)
}

async function downloadTo(page, trigger, target) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    trigger(),
  ])
  await download.saveAs(target)
  return target
}

// ---------- Scenario 04: vector pen path inside selection; clips proven in saved project; Delete clears vector pixels; Ctrl+Z restores exactly ----------
async function s04VectorPenClips() {
  const { context, page, trackers } = await freshContext()
  try {
    const box = await canvasBox(page)
    // rectangle selection; the pen path is committed inside it
    await rectSelect(page, box, [500, 300], [1100, 700])
    await page.keyboard.press('p') // pen tool auto-creates a vector layer
    await sleep(250)
    // dense zig-zag of pen nodes strictly inside the selection
    const docPts = []
    for (let i = 0; i < 14; i++) {
      docPts.push([560 + i * 40, 500 + (i % 2 === 0 ? -110 : 110)])
    }
    for (const [x, y] of docPts) {
      const c = docToClient(box, x, y)
      await page.mouse.click(c.x, c.y)
      await sleep(70)
    }
    await page.keyboard.press('Enter') // commit open path
    await sleep(350)
    await page.keyboard.press('b') // drop object selection so Delete hits clearActive(selection)
    await sleep(250)
    const sampleBefore = await sampleGrid(page)

    // save the project and prove vector objects + selection clips in the file
    const file = '/tmp/trafaret-audit-vector-clips.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), file)
    const json = JSON.parse(await readFile(file, 'utf8'))
    const layers = json.layers || []
    const vectorLayer = layers.find(l => l.kind === 'vector')
    const vectorOk = Boolean(vectorLayer && Array.isArray(vectorLayer.objects) && vectorLayer.objects.length > 0
      && vectorLayer.objects.every(o => Array.isArray(o.points) && o.points.length >= 2))
    const clipsOk = Boolean(vectorLayer && vectorLayer.objects.some(o => Array.isArray(o.clips) && o.clips.length > 0 && Array.isArray(o.clips[0].points)))

    // Delete with the selection still active clears the vector pixels inside it
    await page.keyboard.press('Delete')
    await sleep(350)
    const sampleCleared = await sampleGrid(page)
    const clearedDiff = diffPixels(sampleBefore, sampleCleared)
    await page.screenshot({ path: path.join(shotsDir, '04-vector-cleared.png') })

    // Ctrl+Z must restore the exact sampled composite
    await page.keyboard.press('Control+z')
    await sleep(350)
    const sampleUndone = await sampleGrid(page)
    await page.screenshot({ path: path.join(shotsDir, '04-vector-undo.png') })
    const undoExact = exactEqual(sampleUndone, sampleBefore)
    const err = errorSummary(trackers)
    return {
      status: (vectorOk && clipsOk && clearedDiff > 0 && undoExact && err.clean) ? 'PASS' : 'FAIL',
      evidence: {
        structure: {
          format: json.format, version: json.version,
          layerKinds: layers.map(l => l.kind),
          vectorObjects: vectorOk, selectionClips: clipsOk,
          clipPointCount: vectorLayer?.objects?.[0]?.clips?.[0]?.points?.length ?? 0,
        },
        hashes: { beforeDelete: sampleBefore.hash, cleared: sampleCleared.hash, undone: sampleUndone.hash },
        clearedDiffPixels: clearedDiff,
        undoExactRestore: undoExact,
        file,
        ...err,
      },
    }
  } finally { await context.close().catch(() => {}) }
}

// ---------- Scenario 05: layer mask hides lower layer; clipToBelow clips upper by masked lower (pixel proofs) ----------
async function s05LayerMaskClipToBelow() {
  const { context, page, trackers } = await freshContext()
  try {
    const box = await canvasBox(page)
    // lower layer «Линия 1»: fill block [600,600]-[1100,900]
    await rectSelect(page, box, [600, 600], [1100, 900])
    await fillAt(page, box, 850, 750)
    await page.keyboard.press('Escape')
    await sleep(250)

    // add raster layer «Линия 2» (becomes active, sits above «Линия 1»)
    await page.click('button[aria-label="Добавить растровый слой"]')
    await sleep(400)
    const upperName = await page.evaluate(() => document.querySelector('.layer-row.active .layer-name')?.textContent?.trim() ?? null)

    // upper layer: fill block [500,500]-[1200,1000]
    await rectSelect(page, box, [500, 500], [1200, 1000])
    await fillAt(page, box, 850, 750)
    await page.keyboard.press('Escape')
    await sleep(250)

    // lower layer: add mask, switch to mask editing
    await page.click('button[aria-label="Выбрать слой Линия 1"]')
    await sleep(300)
    await page.click('button:has-text("Добавить маску")')
    await sleep(400)
    await page.click('.mask-controls .segmented-control button:has-text("Маска")')
    await sleep(300)
    const maskEditingActive = await page.evaluate(() => document.querySelector('.canvas-context')?.textContent?.includes('РЕДАКТИРОВАНИЕ МАСКИ') ?? false)

    // select the right part and Delete: mask goes black there, lower layer hidden on the right
    await rectSelect(page, box, [900, 500], [1200, 1000])
    await page.keyboard.press('Delete')
    await sleep(400)

    // back to content editing, select the upper layer
    await page.click('.mask-controls .segmented-control button:has-text("Содержимое")')
    await sleep(300)
    await page.click('button[aria-label="Выбрать слой Линия 2"]')
    await sleep(300)

    // pixel proofs before enabling clipToBelow
    const rightBefore = await readPixel(page, 1000, 800) // upper ink, lower masked away here
    const leftBefore = await readPixel(page, 700, 700)   // upper ink over intact lower
    const rightVisibleBefore = !isBackground(rightBefore)

    // enable «Обрезать по нижнему слою» on the upper layer
    await page.check('.layer-settings label.check-row:has-text("Обрезать по нижнему слою") input')
    await sleep(500)

    const rightAfter = await readPixel(page, 1000, 800) // now background: lower masked → upper clipped away
    const leftAfter = await readPixel(page, 700, 700)   // still visible: lower intact here
    await page.screenshot({ path: path.join(shotsDir, '05-clip-to-below.png') })

    const clipOk = isBackground(rightAfter) && !isBackground(leftAfter)
    const err = errorSummary(trackers)
    return {
      status: (upperName === 'Линия 2' && maskEditingActive && rightVisibleBefore && clipOk && err.clean) ? 'PASS' : 'FAIL',
      evidence: {
        upperLayerName: upperName,
        maskEditingActive,
        probes: {
          right: { doc: [1000, 800], beforeClip: rightBefore, afterClip: rightAfter, visibleBeforeClip: rightVisibleBefore, backgroundAfterClip: isBackground(rightAfter) },
          left: { doc: [700, 700], beforeClip: leftBefore, afterClip: leftAfter, visibleAfterClip: !isBackground(leftAfter) },
        },
        clipToBelowProof: clipOk,
        ...err,
      },
    }
  } finally { await context.close().catch(() => {}) }
}

// ---------- Scenario 13: freehand vector stroke control point editing + exact Undo ----------
async function s13VectorStrokeControlPoints() {
  const { context, page, trackers } = await freshContext()
  try {
    const box = await canvasBox(page)
    await page.click('button[aria-label="Добавить векторный слой"]')
    await sleep(250)
    const start = docToClient(box, 500, 500)
    const end = docToClient(box, 800, 500)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 12 })
    await page.mouse.up()
    await sleep(400)
    const sampleBefore = await sampleGrid(page)

    const beforeFile = '/tmp/trafaret-control-points-before.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), beforeFile)
    const beforeJson = JSON.parse(await readFile(beforeFile, 'utf8'))
    const beforeStroke = beforeJson.layers.find(layer => layer.kind === 'vector')?.objects?.find(object => object.kind === 'stroke')
    const nodeIndex = beforeStroke ? Math.floor(beforeStroke.points.length / 2) : -1
    if (!beforeStroke || nodeIndex < 0) throw new Error('freehand vector stroke not found')
    const [nodeX, nodeY] = beforeStroke.points[nodeIndex]

    await page.keyboard.press('v')
    await sleep(250)
    const from = docToClient(box, nodeX, nodeY)
    const to = docToClient(box, nodeX + 40, nodeY + 120)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
    await sleep(400)
    const sampleAfter = await sampleGrid(page)

    const afterFile = '/tmp/trafaret-control-points-after.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), afterFile)
    const afterJson = JSON.parse(await readFile(afterFile, 'utf8'))
    const afterStroke = afterJson.layers.find(layer => layer.kind === 'vector')?.objects?.find(object => object.id === beforeStroke.id)
    const moved = afterStroke?.points?.[nodeIndex]
    const movedX = moved ? moved[0] - beforeStroke.points[nodeIndex][0] : null
    const movedY = moved ? moved[1] - beforeStroke.points[nodeIndex][1] : null
    const pressurePreserved = moved?.[2] === beforeStroke.points[nodeIndex][2]
    const otherPointsPreserved = Boolean(afterStroke && beforeStroke.points.every((point, index) => index === nodeIndex
      || JSON.stringify(point) === JSON.stringify(afterStroke.points[index])))

    await page.keyboard.press('Control+z')
    await sleep(400)
    const sampleUndone = await sampleGrid(page)
    const undoFile = '/tmp/trafaret-control-points-undo.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), undoFile)
    const undoJson = JSON.parse(await readFile(undoFile, 'utf8'))
    const undoStroke = undoJson.layers.find(layer => layer.kind === 'vector')?.objects?.find(object => object.id === beforeStroke.id)
    const undoPointsExact = JSON.stringify(undoStroke?.points) === JSON.stringify(beforeStroke.points)
    const undoPixelsExact = exactEqual(sampleUndone, sampleBefore)
    const predictionExcluded = beforeStroke.points.at(-1)?.[0] === 800 && beforeStroke.points.at(-1)?.[1] === 500
    const err = errorSummary(trackers)
    const pass = Boolean(afterStroke && Math.abs(movedX - 40) < 1 && Math.abs(movedY - 120) < 1
      && pressurePreserved && otherPointsPreserved && diffPixels(sampleBefore, sampleAfter) > 0
      && predictionExcluded && undoPointsExact && undoPixelsExact && err.clean)
    await page.screenshot({ path: path.join(shotsDir, '13-vector-control-points.png') })
    return {
      status: pass ? 'PASS' : 'FAIL',
      evidence: {
        objectKind: beforeStroke.kind, nodeIndex, pointCount: beforeStroke.points.length,
        movedX, movedY, pressurePreserved, otherPointsPreserved, predictionExcluded,
        changedPixels: diffPixels(sampleBefore, sampleAfter), undoPointsExact, undoPixelsExact,
        ...err,
      },
    }
  } finally { await context.close().catch(() => {}) }
}

// ---------- Scenario 14: selected vector line width redraw + Undo/Redo ----------
async function s14VectorLineWidthRedraw() {
  const { context, page, trackers } = await freshContext()
  try {
    const box = await canvasBox(page)
    await page.click('button[aria-label="Добавить векторный слой"]')
    await sleep(250)
    const start = docToClient(box, 500, 500)
    const end = docToClient(box, 800, 500)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 12 })
    await page.mouse.up()
    await sleep(400)
    const sampleBefore = await sampleGrid(page)

    const beforeFile = '/tmp/trafaret-line-width-before.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), beforeFile)
    const beforeJson = JSON.parse(await readFile(beforeFile, 'utf8'))
    const beforeStroke = beforeJson.layers.find(layer => layer.kind === 'vector')?.objects?.find(object => object.kind === 'stroke')
    if (!beforeStroke) throw new Error('freehand vector stroke not found')

    const objectSlider = page.locator('label.control-slider', { hasText: 'Толщина объекта' }).locator('input')
    const brushSlider = page.locator('label.control-slider', { hasText: 'Размер' }).locator('input')
    if (await objectSlider.count() !== 1) throw new Error('selected object width slider not found')
    const brushSizeBefore = await brushSlider.inputValue()
    await objectSlider.evaluate(input => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '18')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await sleep(400)
    const sampleAfter = await sampleGrid(page)
    const objectSizeAfter = await objectSlider.inputValue()
    const brushSizeAfter = await brushSlider.inputValue()

    const afterFile = '/tmp/trafaret-line-width-after.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), afterFile)
    const afterJson = JSON.parse(await readFile(afterFile, 'utf8'))
    const afterStroke = afterJson.layers.find(layer => layer.kind === 'vector')?.objects?.find(object => object.id === beforeStroke.id)

    await page.keyboard.press('Control+z')
    await sleep(400)
    const sampleUndone = await sampleGrid(page)
    const undoFile = '/tmp/trafaret-line-width-undo.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), undoFile)
    const undoJson = JSON.parse(await readFile(undoFile, 'utf8'))
    const undoStroke = undoJson.layers.find(layer => layer.kind === 'vector')?.objects?.find(object => object.id === beforeStroke.id)

    await page.keyboard.press('Control+Shift+z')
    await sleep(400)
    const redoFile = '/tmp/trafaret-line-width-redo.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), redoFile)
    const redoJson = JSON.parse(await readFile(redoFile, 'utf8'))
    const redoStroke = redoJson.layers.find(layer => layer.kind === 'vector')?.objects?.find(object => object.id === beforeStroke.id)

    const err = errorSummary(trackers)
    const pass = afterStroke?.brush?.size === 18 && objectSizeAfter === '18'
      && brushSizeBefore === String(beforeStroke.brush.size) && brushSizeAfter === brushSizeBefore
      && undoStroke?.brush?.size === beforeStroke.brush.size && redoStroke?.brush?.size === 18
      && diffPixels(sampleBefore, sampleAfter) > 0 && exactEqual(sampleUndone, sampleBefore) && err.clean
    return {
      status: pass ? 'PASS' : 'FAIL',
      evidence: {
        beforeSize: beforeStroke.brush.size, afterSize: afterStroke?.brush?.size,
        undoSize: undoStroke?.brush?.size, redoSize: redoStroke?.brush?.size,
        objectSizeAfter, brushSizeBefore, brushSizeAfter,
        changedPixels: diffPixels(sampleBefore, sampleAfter), undoPixelsExact: exactEqual(sampleUndone, sampleBefore),
        ...err,
      },
    }
  } finally { await context.close().catch(() => {}) }
}

// ---------- Scenario 15: crash recovery and clean reload ----------
async function s15CrashRecovery() {
  const { context, page, trackers } = await freshContext({
    initScript: () => {
      if (sessionStorage.getItem('trafaret-test-unclean') === '1') sessionStorage.removeItem('trafaret-test-unclean')
      window.addEventListener('pagehide', event => {
        if (sessionStorage.getItem('trafaret-test-unclean') === '1') event.stopImmediatePropagation()
      }, true)
    },
  })
  try {
    const box = await canvasBox(page)
    const start = docToClient(box, 500, 500)
    const end = docToClient(box, 800, 500)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 12 })
    await page.mouse.up()
    await sleep(1700)
    const sampleBefore = await sampleGrid(page)

    await page.evaluate(() => { sessionStorage.setItem('trafaret-test-unclean', '1') })
    await page.reload({ waitUntil: 'load', timeout: 30000 })
    const recovered = page
    await recovered.waitForSelector('canvas.drawing-canvas', { timeout: 15000 })
    await recovered.waitForSelector('.dialog-content:has-text("Восстановить аварийную копию?")', { timeout: 15000 })
    const dialogShown = true
    await recovered.click('button.accent-button:has-text("Восстановить проект")')
    await recovered.waitForSelector('.dialog-content', { state: 'detached', timeout: 15000 })
    await sleep(500)
    const sampleRecovered = await sampleGrid(recovered)

    await recovered.reload({ waitUntil: 'load', timeout: 30000 })
    await recovered.waitForSelector('canvas.drawing-canvas', { timeout: 15000 })
    await recovered.waitForSelector('.loading-cover', { state: 'detached', timeout: 15000 }).catch(() => {})
    await sleep(500)
    const cleanDialogCount = await recovered.locator('.dialog-content:has-text("Восстановить аварийную копию?")').count()
    const sampleCleanReload = await sampleGrid(recovered)
    const err = errorSummary(trackers)
    const pass = dialogShown && cleanDialogCount === 0
      && exactEqual(sampleRecovered, sampleBefore) && exactEqual(sampleCleanReload, sampleBefore) && err.clean
    return {
      status: pass ? 'PASS' : 'FAIL',
      evidence: {
        dialogShown, cleanDialogCount,
        recoveredPixelsExact: exactEqual(sampleRecovered, sampleBefore),
        cleanReloadPixelsExact: exactEqual(sampleCleanReload, sampleBefore),
        ...err,
      },
    }
  } finally { await context.close().catch(() => {}) }
}

// ---------- Scenario 16: nondestructive filters preserve raster/vector sources ----------
async function s16NondestructiveFilters() {
  const { context, page, trackers } = await freshContext()
  try {
    const box = await canvasBox(page)
    const drawStroke = async (x, y) => {
      const start = docToClient(box, x, y)
      const end = docToClient(box, x + 300, y)
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(end.x, end.y, { steps: 12 })
      await page.mouse.up()
      await sleep(400)
    }
    const brushSlider = page.locator('label.control-slider', { hasText: 'Размер' }).locator('input')
    await brushSlider.evaluate(input => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '16')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await drawStroke(500, 450)
    const beforeFile = '/tmp/trafaret-filters-before.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), beforeFile)
    const beforeJson = JSON.parse(await readFile(beforeFile, 'utf8'))
    const beforePaint = beforeJson.layers.find(layer => layer.kind === 'paint')
    const sampleBefore = await sampleGrid(page, 4)

    await page.check('.scan-section label.check-row:has-text("Инвертировать") input')
    await sleep(400)
    const sampleRasterFiltered = await sampleGrid(page, 4)

    await page.click('button[aria-label="Добавить векторный слой"]')
    await sleep(250)
    await drawStroke(500, 700)
    const vectorBeforeFile = '/tmp/trafaret-filters-vector-before.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), vectorBeforeFile)
    const vectorBeforeJson = JSON.parse(await readFile(vectorBeforeFile, 'utf8'))
    const beforeVector = vectorBeforeJson.layers.find(layer => layer.kind === 'vector')

    await page.check('.scan-section label.check-row:has-text("Инвертировать") input')
    await sleep(400)
    await page.click('button[aria-label="Кисть (B)"]')
    await sleep(250)
    const sampleFiltered = await sampleGrid(page, 4)
    const filteredProbe = await readPixel(page, 650, 450)
    const afterFile = '/tmp/trafaret-filters-after.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), afterFile)
    const afterJson = JSON.parse(await readFile(afterFile, 'utf8'))
    const afterPaint = afterJson.layers.find(layer => layer.kind === 'paint')
    const afterVector = afterJson.layers.find(layer => layer.kind === 'vector')

    await sleep(1300)
    await page.reload({ waitUntil: 'load', timeout: 30000 })
    await page.waitForSelector('canvas.drawing-canvas', { timeout: 15000 })
    await page.waitForSelector('.loading-cover', { state: 'detached', timeout: 15000 }).catch(() => {})
    await sleep(500)
    const sampleReloaded = await sampleGrid(page, 4)
    const reloadProbe = await readPixel(page, 650, 450)
    await page.screenshot({ path: path.join(shotsDir, '16-filters-reloaded.png') })
    const reloadFile = '/tmp/trafaret-filters-reloaded.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), reloadFile)
    const reloadJson = JSON.parse(await readFile(reloadFile, 'utf8'))
    const reloadPaint = reloadJson.layers.find(layer => layer.kind === 'paint')
    const reloadVector = reloadJson.layers.find(layer => layer.kind === 'vector')
    const err = errorSummary(trackers)
    const pass = afterPaint?.data === beforePaint?.data
      && JSON.stringify(afterVector?.objects) === JSON.stringify(beforeVector?.objects)
      && afterPaint?.filters?.invert === true && afterVector?.filters?.invert === true
      && diffPixels(sampleBefore, sampleRasterFiltered) > 0
      && diffPixels(sampleRasterFiltered, sampleFiltered) > 0
      && exactEqual(sampleReloaded, sampleFiltered) && err.clean
    return {
      status: pass ? 'PASS' : 'FAIL',
      evidence: {
        rasterSourceUnchanged: afterPaint?.data === beforePaint?.data,
        vectorSourceUnchanged: JSON.stringify(afterVector?.objects) === JSON.stringify(beforeVector?.objects),
        rasterFilterPersisted: afterPaint?.filters?.invert === true,
        vectorFilterPersisted: afterVector?.filters?.invert === true,
        reloadPixelsExact: exactEqual(sampleReloaded, sampleFiltered),
        rasterFilterChangedPixels: diffPixels(sampleBefore, sampleRasterFiltered),
        vectorFilterChangedPixels: diffPixels(sampleRasterFiltered, sampleFiltered),
        reloadDiffPixels: diffPixels(sampleFiltered, sampleReloaded),
        reloadDiffLocations: diffLocations(sampleFiltered, sampleReloaded),
        filteredHash: sampleFiltered.hash, reloadHash: sampleReloaded.hash,
        filteredProbe, reloadProbe, reloadSize: [sampleReloaded.width, sampleReloaded.height],
        reloadRasterFilter: reloadPaint?.filters, reloadVectorFilter: reloadVector?.filters,
        ...err,
      },
    }
  } finally { await context.close().catch(() => {}) }
}

// ---------- Scenario 17: print color modes and physical page size ----------
async function s17PrintColorModes() {
  const { context, page, trackers } = await freshContext()
  try {
    await page.click('button[aria-label="Цвет #7d1f2d"]')
    const brushSlider = page.locator('label.control-slider', { hasText: 'Размер' }).locator('input')
    await brushSlider.evaluate(input => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '16')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const box = await canvasBox(page)
    const start = docToClient(box, 500, 450)
    const end = docToClient(box, 800, 450)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 12 })
    await page.mouse.up()
    await sleep(400)

    const printFrame = async mode => {
      await page.click('button[aria-label="Печать"]')
      await page.selectOption('.dialog-content label.select-field:has-text("Режим печати") select', mode)
      await page.fill('.dialog-content label.text-field:has-text("Ширина, мм") input', '100')
      await page.click('button.accent-button:has-text("Открыть диалог печати")')
      await page.waitForSelector('iframe.print-frame', { timeout: 15000 })
      await page.waitForFunction(() => {
        const image = document.querySelector('iframe.print-frame')?.contentDocument?.querySelector('img')
        return image?.complete && image.naturalWidth > 0
      }, null, { timeout: 15000 })
      const result = await page.evaluate(() => {
        const frame = document.querySelector('iframe.print-frame')
        const image = frame.contentDocument.querySelector('img')
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(image, 0, 0)
        return {
          pixel: Array.from(ctx.getImageData(650, 450, 1, 1).data),
          pageCss: frame.getAttribute('srcdoc').match(/@page\{[^}]+\}/)?.[0] ?? null,
        }
      })
      await page.evaluate(() => { document.querySelector('iframe.print-frame')?.remove() })
      return result
    }

    const color = await printFrame('color')
    const grayscale = await printFrame('grayscale')
    const stencil = await printFrame('stencil')
    const err = errorSummary(trackers)
    const colorIsColored = color.pixel[0] !== color.pixel[1] || color.pixel[0] !== color.pixel[2]
    const grayIsNeutral = grayscale.pixel[0] === grayscale.pixel[1] && grayscale.pixel[1] === grayscale.pixel[2]
    const stencilIsBinary = stencil.pixel[0] === stencil.pixel[1] && stencil.pixel[1] === stencil.pixel[2]
      && (stencil.pixel[0] === 0 || stencil.pixel[0] === 255)
    const pageSizes = [color, grayscale, stencil].every(result => result.pageCss?.includes('size:100.00mm 100.00mm'))
    return {
      status: colorIsColored && grayIsNeutral && stencilIsBinary && pageSizes && err.clean ? 'PASS' : 'FAIL',
      evidence: { color, grayscale, stencil, colorIsColored, grayIsNeutral, stencilIsBinary, pageSizes, ...err },
    }
  } finally { await context.close().catch(() => {}) }
}

// ---------- Scenario 18: Bezier handles, persistence, Undo/Redo and SVG ----------
async function s18BezierHandles() {
  const { context, page, trackers } = await freshContext()
  try {
    const box = await canvasBox(page)
    await page.keyboard.press('p')
    await sleep(250)
    for (const [x, y] of [[500, 500], [650, 500], [800, 650]]) {
      const point = docToClient(box, x, y)
      await page.mouse.click(point.x, point.y)
      await sleep(100)
    }
    await page.keyboard.press('Enter')
    await sleep(350)
    const sampleBefore = await sampleGrid(page)
    const beforeFile = '/tmp/trafaret-bezier-before.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), beforeFile)
    const beforeJson = JSON.parse(await readFile(beforeFile, 'utf8'))
    const beforePath = beforeJson.layers.find(layer => layer.kind === 'vector')?.objects?.find(object => object.kind === 'path')

    await page.keyboard.press('v')
    await sleep(250)
    const from = docToClient(box, 650, 500)
    const to = docToClient(box, 650, 300)
    await page.keyboard.down('Alt')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await sleep(350)
    const sampleAfter = await sampleGrid(page)
    const afterFile = '/tmp/trafaret-bezier-after.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), afterFile)
    const afterJson = JSON.parse(await readFile(afterFile, 'utf8'))
    const afterPath = afterJson.layers.find(layer => layer.kind === 'vector')?.objects?.find(object => object.id === beforePath.id)
    const outHandle = afterPath?.handles?.[1]?.out
    const inHandle = afterPath?.handles?.[2]?.in

    await page.keyboard.press('Control+z')
    await sleep(350)
    const sampleUndone = await sampleGrid(page)
    await page.keyboard.press('Control+Shift+z')
    await sleep(350)
    const redoFile = '/tmp/trafaret-bezier-redo.tattoo.json'
    await downloadTo(page, () => page.click('header button:has-text("Сохранить")'), redoFile)
    const redoJson = JSON.parse(await readFile(redoFile, 'utf8'))
    const redoPath = redoJson.layers.find(layer => layer.kind === 'vector')?.objects?.find(object => object.id === beforePath.id)

    const svgFile = '/tmp/trafaret-bezier.svg'
    await page.click('header button:has-text("Экспорт")')
    await downloadTo(page, () => page.click('button.export-option:has-text("Векторный SVG")'), svgFile)
    const svg = await readFile(svgFile, 'utf8')
    const err = errorSummary(trackers)
    const handlesCreated = outHandle?.[0] === 650 && outHandle?.[1] === 300
      && inHandle?.[0] === 800 && inHandle?.[1] === 650
    const undoExact = exactEqual(sampleUndone, sampleBefore)
    const redoHandles = redoPath?.handles?.[1]?.out?.[1] === 300 && redoPath?.handles?.[2]?.in?.[1] === 650
    const svgHasBezier = svg.includes(' C')
    return {
      status: handlesCreated && undoExact && redoHandles && svgHasBezier && diffPixels(sampleBefore, sampleAfter) > 0 && err.clean ? 'PASS' : 'FAIL',
      evidence: { handlesCreated, outHandle, inHandle, undoExact, redoHandles, svgHasBezier, ...err },
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
  ['04-vector-pen-clips', 'Vector pen path inside selection; saved project proves objects+clips; Delete clears vector pixels; Ctrl+Z exact restore', s04VectorPenClips],
  ['05-layer-mask-cliptobelow', 'Layer mask hides lower right side; clipToBelow on upper clips by masked lower (readPixel proofs)', s05LayerMaskClipToBelow],
  ['13-vector-stroke-control-points', 'Freehand vector stroke control point moves with pressure preserved and exact Undo', s13VectorStrokeControlPoints],
  ['14-vector-line-width-redraw', 'Selected vector line width redraw preserves brush and supports Undo/Redo', s14VectorLineWidthRedraw],
  ['15-crash-recovery', 'Interrupted pagehide offers recovery; restored pixels and clean reload are exact', s15CrashRecovery],
  ['16-nondestructive-filters', 'Raster and vector filters preserve sources and survive clean reload', s16NondestructiveFilters],
  ['17-print-color-modes', 'Color, grayscale and stencil print modes with exact 100mm page size', s17PrintColorModes],
  ['18-bezier-handles', 'Bezier handle creation, persistence, Undo/Redo and cubic SVG output', s18BezierHandles],
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
  if (args.only && id !== args.only) continue
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
