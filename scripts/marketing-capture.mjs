#!/usr/bin/env node
// Dev-only marketing capture: honest screenshots of the REAL application.
// A real Vite dev server is spawned on a loopback port and driven with
// Playwright Chromium. The artwork (орнаментальная моль, вертикальная
// симметрия, линворк + сдержанный dotwork) is drawn stroke by stroke through
// real CDP pen pointer events — no pasted images, no UI mock-ups, no DEV
// hooks (window.__tattooStudio is never touched), no external network.
// PNGs go to docs/assets/screenshots/ with a machine-readable manifest.json.
// Does not modify src/, app configs, test thresholds or the product bundle.
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  if (!key.startsWith('--')) continue
  args[key.slice(2)] = process.argv[i + 1]
}
const outDir = args.out || path.resolve('docs/assets/screenshots')
const manifestPath = path.join(outDir, 'manifest.json')
mkdirSync(outDir, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

function waitForHttp(url, timeoutMs = 45000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(url, res => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`dev server did not respond at ${url}`))
        else setTimeout(poll, 250)
      })
    }
    poll()
  })
}

function startVite(port) {
  const viteBin = path.resolve('node_modules/vite/bin/vite.js')
  if (!existsSync(viteBin)) throw new Error(`vite binary not found: ${viteBin}`)
  const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--strictPort', '--port', String(port)], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logTail = ''
  child.stdout.on('data', d => { logTail = (logTail + String(d)).slice(-2000) })
  child.stderr.on('data', d => { logTail = (logTail + String(d)).slice(-2000) })
  child.logTail = () => logTail
  return child
}

const LAUNCH = {
  headless: true,
  args: ['--disable-dev-shm-usage', '--no-sandbox', '--hide-scrollbars'],
}
const DSF = 2

function attachTrackers(page) {
  const t = { pageErrors: [], consoleErrors: [] }
  page.on('pageerror', e => t.pageErrors.push(String(e).slice(0, 400)))
  page.on('console', m => { if (m.type() === 'error') t.consoleErrors.push(m.text().slice(0, 400)) })
  return t
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
const isBackgroundPx = (r, g, b) => r === 243 && g === 241 && b === 233
function inkStats(sample) {
  let ink = 0
  for (let i = 0; i < sample.pixels.length; i += 4) {
    if (!isBackgroundPx(sample.pixels[i], sample.pixels[i + 1], sample.pixels[i + 2])) ink++
  }
  return { sampledPixels: sample.count, inkPixels: ink, inkShare: ink / sample.count, hash: sample.hash }
}

// Deterministic pen stroke via CDP (pointerType 'pen', fixed pressure path) —
// the same honest input path as the production/media regression audits.
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
  await sleep(220)
}

// de Casteljau sampling of a bezier curve into a dense doc-space polyline.
function bez(ctrl, n = 26) {
  const out = []
  for (let k = 0; k <= n; k++) {
    let t = k / n
    let px = ctrl.map(p => p[0]), py = ctrl.map(p => p[1])
    for (let r = ctrl.length - 1; r > 0; r--) {
      const nx = [], ny = []
      for (let i = 0; i < r; i++) {
        nx.push(px[i] + (px[i + 1] - px[i]) * t)
        ny.push(py[i] + (py[i + 1] - py[i]) * t)
      }
      px = nx; py = ny
    }
    out.push([px[0], py[0]])
  }
  return out
}

async function pickBrush(page, name) {
  let btn = page.locator('.brush-preset', { hasText: name }).first()
  if (!(await btn.isVisible().catch(() => false))) {
    await page.click('button[aria-label="Настройки кисти"]')
    await sleep(350)
    btn = page.locator('.brush-preset', { hasText: name }).first()
  }
  await btn.click()
  await sleep(160)
}

// ---------- main ----------
const started = Date.now()
const port = await freePort()
const baseUrl = `http://127.0.0.1:${port}/`
console.log(`[capture] starting vite dev server on ${baseUrl}`)
const vite = startVite(port)
let browser = null
const results = { screenshots: [] }
let overall = 'PASS'

function recordShot(entry) {
  const fileOk = existsSync(entry.file) && statSync(entry.file).size > 0
  entry.checks = {
    ...entry.checks,
    fileExistsNonZero: fileOk,
    fileBytes: fileOk ? statSync(entry.file).size : 0,
    noConsoleErrors: entry.consoleErrors.length === 0,
    noPageErrors: entry.pageErrors.length === 0,
  }
  entry.status = (fileOk && entry.checks.noConsoleErrors && entry.checks.noPageErrors && entry.checks.extraOk !== false) ? 'PASS' : 'FAIL'
  if (entry.status !== 'PASS') overall = 'FAIL'
  results.screenshots.push(entry)
  console.log(`[capture] ${entry.id}: ${entry.status} (${entry.checks.fileBytes} bytes)`)
}

try {
  await waitForHttp(baseUrl)
  browser = await chromium.launch(LAUNCH)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DSF, hasTouch: false })
  const page = await context.newPage()
  const trackers = attachTrackers(page)
  const errorsOf = () => ({ consoleErrors: trackers.consoleErrors.slice(), pageErrors: trackers.pageErrors.slice() })

  await page.goto(baseUrl, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('canvas.drawing-canvas', { timeout: 30000 })
  await page.waitForSelector('.loading-cover', { state: 'detached', timeout: 30000 }).catch(() => {})
  await sleep(1000) // hydrate + fitView

  // real document title via the real input
  await page.fill('.document-title', 'Мотылёк · орнаментальный линворк')
  // focus a tool button so keyboard shortcuts go to the app, not the input
  await page.click('button[aria-label="Кисть (B)"]')
  await sleep(200)

  // vertical symmetry via the real key (m), as a user would
  await page.keyboard.press('m')
  await sleep(400)
  const symmetryActive = await page.locator('.view-modes button', { hasText: 'Симметрия' }).evaluate(el => el.classList.contains('active'))

  const box = await canvasBox(page)
  const baseline = await sampleGrid(page)

  // --- draw the moth: left half only, the app mirrors across x = docW/2 ---
  const strokes = []
  async function draw(brush, ctrl, { n = 26, force = 0.8 } = {}) {
    await pickBrush(page, brush)
    const pts = Array.isArray(ctrl[0][0]) ? ctrl : bez(ctrl, n)
    await penStroke(page, box, pts, force)
    strokes.push({ brush, points: pts.length })
  }

  // antenna: one curled filament feeler (mirrored into a symmetric pair)
  await draw('Fineline', [[1008, 510], [936, 388], [836, 296], [768, 300], [748, 340]], { n: 30 })
  // head: small loop at the axis
  await draw('Fineline', [[988, 538], [1000, 520], [1014, 536], [1010, 556], [992, 554], [988, 538]], { n: 18 })
  // thorax: firm vertical + blackwork core
  await draw('Traditional', [[1000, 592], [994, 652], [1000, 712]], { n: 12 })
  await draw('Blackwork', [[998, 628], [1000, 682]], { n: 8 })
  // abdomen: long tapering body, thicker than a dragonfly's, pointed tip
  await draw('Traditional', [[1002, 712], [986, 920], [996, 1120], [1004, 1300]], { n: 36 })
  await draw('Fineline', [[1004, 1300], [1000, 1350], [1002, 1392]], { n: 10 })
  // restrained dotwork along the abdomen edge
  for (const y of [830, 950, 1070, 1190]) {
    await draw('Dotwork', [[970, y], [969, y + 4]], { n: 2 })
  }
  // left forewing: broad rounded upper wing with two ornament arcs
  await draw('Fineline', [[1000, 716], [872, 512], [672, 330], [470, 250], [352, 282]], { n: 34 })
  await draw('Fineline', [[352, 282], [438, 470], [620, 690], [842, 838], [1002, 892]], { n: 34 })
  await draw('Fineline', [[994, 756], [856, 592], [700, 432], [552, 332]], { n: 26 })
  await draw('Fineline', [[994, 812], [862, 682], [716, 548], [588, 430]], { n: 26 })
  await draw('Dotwork', [[430, 520], [580, 680], [760, 800], [930, 868]], { n: 20 })
  // left hindwing: rounded lower lobe with inner arc and stippled edge
  await draw('Fineline', [[1002, 918], [830, 990], [640, 1092], [486, 1240]], { n: 28 })
  await draw('Fineline', [[486, 1240], [452, 1360], [560, 1460], [742, 1420], [892, 1260], [1002, 1108]], { n: 32 })
  await draw('Fineline', [[996, 966], [846, 1044], [700, 1150], [576, 1282]], { n: 24 })
  await draw('Dotwork', [[520, 1330], [640, 1410], [790, 1340], [910, 1200]], { n: 18 })
  await draw('Dotwork', [[392, 330], [412, 354]], { n: 3 })
  // one calm vein per wing pair
  await draw('Fineline', [[1000, 780], [902, 724], [812, 660]], { n: 12 })
  await draw('Fineline', [[1000, 962], [900, 1006], [816, 1076]], { n: 12 })

  await sleep(500)
  const after = await sampleGrid(page)
  const ink = inkStats(after)
  const canvasNonEmpty = ink.inkPixels >= 300
  const drawingHash = { before: baseline.hash, after: after.hash }
  console.log(`[capture] drawing done: ${strokes.length} strokes, ink sampled px=${ink.inkPixels}, hash=${after.hash}`)
  if (!canvasNonEmpty) overall = 'FAIL'

  // --- 01: desktop hero ---
  await sleep(300)
  await page.screenshot({ path: path.join(outDir, '01-desktop-hero.png') })
  recordShot({
    id: '01-desktop-hero',
    file: path.join(outDir, '01-desktop-hero.png'),
    viewport: { width: 1440, height: 900, deviceScaleFactor: DSF },
    scenario: 'Desktop hero: полный интерфейс студии с нарисованным эскизом моли (линворк + dotwork, вертикальная симметрия)',
    actions: [`${strokes.length} CDP pen strokes через кисти ${[...new Set(strokes.map(s => s.brush))].join(', ')}`, 'симметрия: клавиша M', 'название проекта: реальный input'],
    results: { strokes, symmetryActive, canvasNonEmpty, ...ink },
    checks: { canvasNonEmpty, extraOk: canvasNonEmpty && symmetryActive },
    ...errorsOf(),
  })

  // --- 02: artwork analysis (real button) ---
  await page.click('button[aria-label="Проверка эскиза"]')
  await sleep(900)
  const metrics = await page.evaluate(() => {
    const out = {}
    for (const row of document.querySelectorAll('.analysis-metric')) {
      const dt = row.querySelector('dt')?.textContent?.trim()
      const dd = row.querySelector('dd')?.textContent?.trim()
      if (dt) out[dt] = dd ?? null
    }
    return { metrics: out, dialogOpen: document.querySelectorAll('.analysis-metric').length > 0 }
  })
  const parseNum = v => v ? Number(String(v).replace(/[^\d.,]/g, '').replace(',', '.')) : NaN
  const density = parseNum(metrics.metrics['Покрытие холста'])
  const components = parseNum(metrics.metrics['Компонентов чернил'])
  await page.screenshot({ path: path.join(outDir, '02-artwork-analysis.png') })
  recordShot({
    id: '02-artwork-analysis',
    file: path.join(outDir, '02-artwork-analysis.png'),
    viewport: { width: 1440, height: 900, deviceScaleFactor: DSF },
    scenario: 'Локальный анализ эскиза: диалог «Проверка эскиза» с реальными метриками нарисованной моли',
    actions: ['клик по кнопке «Проверка эскиза» в шапке'],
    results: { dialogOpen: metrics.dialogOpen, densityPct: density, inkComponents: components, allMetrics: metrics.metrics },
    checks: { canvasNonEmpty, extraOk: metrics.dialogOpen && density > 0 && components > 0 },
    ...errorsOf(),
  })
  await page.keyboard.press('Escape')
  await sleep(300)

  // --- 03: API / device diagnostics (real button) ---
  await page.click('header button:has-text("Диагностика устройства")')
  await page.waitForSelector('.diag-count', { timeout: 20000 })
  await sleep(300)
  const diag = await page.evaluate(() => ({
    counts: {
      pass: Number(document.querySelector('.diag-count.diag-pass dd')?.textContent ?? -1),
      review: Number(document.querySelector('.diag-count.diag-review dd')?.textContent ?? -1),
      fail: Number(document.querySelector('.diag-count.diag-fail dd')?.textContent ?? -1),
    },
    checks: Array.from(document.querySelectorAll('.diag-check strong')).map(el => el.textContent?.trim()),
  }))
  await page.screenshot({ path: path.join(outDir, '03-diagnostics-api.png') })
  recordShot({
    id: '03-diagnostics-api',
    file: path.join(outDir, '03-diagnostics-api.png'),
    viewport: { width: 1440, height: 900, deviceScaleFactor: DSF },
    scenario: 'Диагностика API/устройства: Canvas 2D, маски, перо, фильтры — локальные проверки платформы',
    actions: ['клик по кнопке «Диагностика устройства» в шапке'],
    results: { counts: diag.counts, checkNames: diag.checks },
    checks: { canvasNonEmpty, extraOk: diag.counts.fail === 0 },
    ...errorsOf(),
  })
  await page.keyboard.press('Escape')
  await sleep(300)

  // --- 04: tablet working state ---
  await page.setViewportSize({ width: 768, height: 1024 })
  await sleep(600)
  await page.click('button[aria-label="Слои и скан"]')
  await sleep(400)
  await page.screenshot({ path: path.join(outDir, '04-tablet-working.png') })
  recordShot({
    id: '04-tablet-working',
    file: path.join(outDir, '04-tablet-working.png'),
    viewport: { width: 768, height: 1024, deviceScaleFactor: DSF },
    scenario: 'Tablet 768×1024: рабочее состояние, открыт ящик слоёв, эскиз моли на холсте',
    actions: ['viewport 768×1024', 'клик по «Слои и скан»'],
    results: { rightDrawerOpen: await page.evaluate(() => document.querySelector('.right-panel')?.classList.contains('open') ?? false) },
    checks: { canvasNonEmpty },
    ...errorsOf(),
  })
  await page.click('button[aria-label="Закрыть слои"]')
  await sleep(300)

  // --- 05: mobile working state ---
  await page.setViewportSize({ width: 390, height: 844 })
  await sleep(600)
  await page.screenshot({ path: path.join(outDir, '05-mobile-working.png') })
  recordShot({
    id: '05-mobile-working',
    file: path.join(outDir, '05-mobile-working.png'),
    viewport: { width: 390, height: 844, deviceScaleFactor: DSF },
    scenario: 'Mobile 390×844: рабочее состояние, компактный интерфейс, эскиз моли вписан в холст',
    actions: ['viewport 390×844'],
    results: { noHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth) },
    checks: { canvasNonEmpty },
    ...errorsOf(),
  })

  results.drawing = {
    subject: 'орнаментальная моль: вертикальная симметрия (клавиша M), линворк + сдержанный dotwork',
    input: 'реальные CDP pen pointer events (pointerType pen, pressure), без DEV-хуков и без вставки изображений',
    strokes,
    symmetryActive,
    hashes: drawingHash,
    ...ink,
    canvasNonEmpty,
  }
  results.analysis = { densityPct: density, inkComponents: components, allMetrics: metrics.metrics }
  results.diagnostics = diag

  await context.close().catch(() => {})
} catch (e) {
  overall = 'FAIL'
  results.fatal = String(e).slice(0, 800)
  console.error(`[capture] FATAL ${String(e).slice(0, 400)}`)
  if (vite.logTail) console.error(`[capture] vite log tail:\n${vite.logTail()}`)
} finally {
  await browser?.close().catch(() => {})
  if (vite && !vite.killed) vite.kill('SIGTERM')
}

results.generatedAt = new Date().toISOString()
results.durationMs = Date.now() - started
results.command = 'node scripts/marketing-capture.mjs'
results.environment = {
  project: 'Трафарет (команда «Кир»)',
  mode: 'vite dev server + playwright chromium',
  node: process.version,
  playwright: JSON.parse(readFileSync(new URL('../node_modules/playwright/package.json', import.meta.url), 'utf8')).version,
  vite: JSON.parse(readFileSync(new URL('../node_modules/vite/package.json', import.meta.url), 'utf8')).version,
  deviceScaleFactor: DSF,
  devHookUsed: false,
  stockImagesUsed: false,
}
results.summary = {
  screenshots: results.screenshots.length,
  pass: results.screenshots.filter(s => s.status === 'PASS').length,
  fail: results.screenshots.filter(s => s.status === 'FAIL').length,
  canvasNonEmpty: Boolean(results.drawing?.canvasNonEmpty),
  overall,
}
await writeFile(manifestPath, JSON.stringify(results, null, 2))
console.log(`[capture] overall=${overall} shots=${results.summary.pass}P/${results.summary.fail}F manifest=${manifestPath}`)
process.exit(overall === 'PASS' ? 0 : 1)
