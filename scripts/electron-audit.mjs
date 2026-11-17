#!/usr/bin/env node
// Dev-only Electron production UI audit lab: real Electron (playwright _electron),
// production dist, sandboxed preload, device diagnostics, pen/palm/pinch input.
// Not part of the app bundle. Run under Xvfb: xvfb-run -a node scripts/electron-audit.mjs
// Staging app lives in /tmp with throwaway XDG_CONFIG_HOME: no real tokens/config/credentials.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { _electron as electron } from 'playwright'

const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]
  if (!key.startsWith('--')) continue
  args[key.slice(2)] = process.argv[i + 1]
}
const distDir = args.dist || '/tmp/trafaret-current-dist'
const outJson = args.out || '/mnt/agents/private/trafaret-audit/electron-matrix.json'
if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error(`dist not found: ${distDir}`)
  process.exit(2)
}

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const EXECUTABLE = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron')
const DESKTOP_DIST = path.join(REPO, 'desktop', 'dist')
if (!existsSync(EXECUTABLE) || !existsSync(path.join(DESKTOP_DIST, 'main.js')) || !existsSync(path.join(DESKTOP_DIST, 'preload.cjs'))) {
  console.error('electron binary or desktop/dist build missing — run npm run desktop:build first')
  process.exit(2)
}

const started = Date.now()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const shotsDir = path.join(path.dirname(outJson), 'screenshots')
mkdirSync(shotsDir, { recursive: true })

// ---- staging app in /tmp: production dist + desktop bundle + minimal package.json ----
const staging = mkdtempSync(path.join(tmpdir(), 'trafaret-electron-audit-'))
const xdgConfig = path.join(staging, 'xdg-config')
const xdgCache = path.join(staging, 'xdg-cache')
mkdirSync(path.join(staging, 'desktop', 'dist'), { recursive: true })
cpSync(distDir, path.join(staging, 'dist'), { recursive: true })
cpSync(path.join(DESKTOP_DIST, 'main.js'), path.join(staging, 'desktop', 'dist', 'main.js'))
cpSync(path.join(DESKTOP_DIST, 'preload.cjs'), path.join(staging, 'desktop', 'dist', 'preload.cjs'))
writeFileSync(path.join(staging, 'package.json'), JSON.stringify({
  name: 'trafaret-electron-audit', private: true, version: '0.0.0', type: 'module', main: 'desktop/dist/main.js',
}))

// ---- OS-level sandbox reality check (browser sandbox, NOT webPreferences.sandbox) ----
// webPreferences.sandbox is verified separately in the main process and is unaffected
// by this Chromium flag; we never claim this flag disables the renderer sandbox.
let osSandboxArg = []
let osSandboxNote = 'chrome-sandbox setuid helper available, browser sandbox left enabled'
try {
  const sb = statSync(path.join(REPO, 'node_modules', 'electron', 'dist', 'chrome-sandbox'))
  const setuid = (sb.mode & 0o4000) !== 0
  if (!(setuid && sb.uid === 0) && process.geteuid() !== 0) {
    osSandboxArg = ['--no-sandbox']
    osSandboxNote = 'chrome-sandbox helper is not setuid in this environment; --no-sandbox passed as a browser arg only. Renderer webPreferences.sandbox is still verified separately in the main process.'
  }
} catch {
  osSandboxNote = 'chrome-sandbox helper missing; --no-sandbox passed as a browser arg only. Renderer webPreferences.sandbox is still verified separately in the main process.'
  osSandboxArg = ['--no-sandbox']
}

// No console patterns are ignored: every console error, 404 and net::ERR must land
// in the report and fail the run, same as pageerror.

// ---- canvas helpers (same sampling approach as scripts/runtime-audit.mjs) ----
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
async function readStylusOnly(page) {
  return page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('.brush-panel-content label.toggle-row'))
    const row = labels.find(l => /Только перо/.test(l.textContent ?? ''))
    if (!row) return { found: false, checked: null }
    return { found: true, checked: row.querySelector('input[type=checkbox]')?.checked ?? null }
  })
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
    }
  })
}

async function runMode(mode, modeArgs) {
  const launchArgs = [staging, ...osSandboxArg, ...modeArgs]
  const electronApp = await electron.launch({
    executablePath: EXECUTABLE,
    args: launchArgs,
    env: { ...process.env, XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: xdgCache },
  })
  const result = {
    launchArgs,
    osSandboxNote,
    security: {},
    diagnostics: {},
    input: { pen: {}, palm: {}, pinch: {} },
    errors: { pageErrors: [], consoleErrors: [], externalRequests: [] },
    screenshots: {},
  }
  try {
    const page = await electronApp.firstWindow()
    const pageErrors = result.errors.pageErrors
    page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)))
    const consoleErrors = result.errors.consoleErrors
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
    page.on('request', req => {
      const url = req.url()
      if (/^https?:\/\//.test(url) && !/127\.0\.0\.1|localhost/.test(url)) result.errors.externalRequests.push(url.slice(0, 300))
    })
    await page.waitForSelector('canvas.drawing-canvas', { timeout: 30000 })
    await sleep(700) // hydrate + fitView + automatic diagnostics

    // ---- security: renderer context ----
    const renderer = await page.evaluate(() => ({
      platform: window.trafaretNative?.platform ?? null,
      hasRequire: typeof window.require !== 'undefined',
      hasModule: typeof window.module !== 'undefined',
      hasProcess: typeof window.process !== 'undefined',
      hasIpcRenderer: typeof window.ipcRenderer !== 'undefined',
    }))
    // ---- security: actual webPreferences from the main process ----
    // Electron 41 has no webContents.getWebPreferences; use getLastWebPreferences() when present.
    const webPreferences = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const wc = win.webContents
      if (typeof wc.getLastWebPreferences !== 'function') return { getLastWebPreferencesMissing: true }
      const p = wc.getLastWebPreferences()
      return { nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, sandbox: p.sandbox }
    })
    result.security = {
      renderer,
      webPreferences,
      platformIsElectron: renderer.platform === 'electron',
      rendererHasNoNodeGlobals: !renderer.hasRequire && !renderer.hasModule && !renderer.hasProcess,
      webPreferencesSecure: !!webPreferences && webPreferences.nodeIntegration === false && webPreferences.contextIsolation === true && webPreferences.sandbox === true,
    }

    // ---- diagnostics UI ----
    await page.click('button.text-button:has-text("Диагностика устройства")')
    await page.waitForSelector('.diag-counts .diag-count', { timeout: 15000 })
    await page.waitForFunction(() => document.querySelectorAll('.diag-check').length === 10, null, { timeout: 15000 })
    await sleep(200)
    const diagShot = path.join(shotsDir, `${mode}-diagnostics.png`)
    await page.screenshot({ path: diagShot })
    result.screenshots.diagnostics = diagShot
    const counts = await page.evaluate(() => {
      const out = {}
      for (const cls of ['diag-pass', 'diag-review', 'diag-fail']) {
        out[cls.replace('diag-', '')] = Number(document.querySelector(`.diag-count.${cls} dd`)?.textContent ?? -1)
      }
      return out
    })
    const checks = await page.evaluate(() => Array.from(document.querySelectorAll('.diag-check')).map(row => ({
      label: row.querySelector('strong')?.textContent ?? '',
      status: (row.querySelector('.diag-status')?.className.match(/diag-(pass|review|fail)/) || [])[1] ?? 'unknown',
      required: row.querySelector('.diag-required')?.textContent === 'обязательно',
    })))
    const requiredFails = checks.filter(c => c.required && c.status === 'fail').map(c => c.label)
    result.diagnostics = {
      counts, checks, totalChecks: checks.length,
      requiredFails,
      allRequiredPassed: requiredFails.length === 0,
      getCoalescedEventsReviewed: checks.some(c => /getCoalescedEvents/i.test(c.label) && c.status === 'review') || null,
    }
    await page.keyboard.press('Escape')
    await page.waitForSelector('.diag-counts', { state: 'detached', timeout: 10000 }).catch(() => {})

    // ---- 1) pen stroke must change sampled canvas ----
    const box = await canvasBox(page)
    const penBefore = await sampleCanvas(page)
    const pts = []
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      pts.push(docToClient(box, box.docW * (0.15 + 0.5 * t), box.docH * 0.3 + Math.sin(t * Math.PI * 2) * box.docH * 0.08))
    }
    await dispatchPenStroke(page, pts, 0.65)
    await sleep(250)
    const penAfter = await sampleCanvas(page)
    result.input.pen = { pointerType: 'pen', force: 0.65, points: pts.length, changed: !sameSample(penBefore, penAfter) }

    // ---- 2) single touch with stylusOnly must NOT draw (palm rejection) ----
    let stylusState = await readStylusOnly(page)
    let stylusWasEnabled = 'already-on'
    if (stylusState.checked === false) {
      const row = page.locator('.brush-panel-content label.toggle-row', { hasText: 'Только перо' }).first()
      await row.locator('input[type=checkbox]').click()
      await sleep(150)
      stylusWasEnabled = 'toggled-on'
      stylusState = await readStylusOnly(page)
    }
    const stylusOnly = stylusState.found ? stylusState.checked : null
    const palmBefore = await sampleCanvas(page)
    const t0 = docToClient(box, box.docW * 0.5, box.docH * 0.55)
    const tcdp = await page.context().newCDPSession(page)
    await tcdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: t0.x, y: t0.y, id: 1 }] })
    await sleep(120)
    await tcdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(250)
    const palmAfter = await sampleCanvas(page)
    result.input.palm = {
      stylusOnly, enabledViaRealCheckbox: stylusWasEnabled,
      unchanged: sameSample(palmBefore, palmAfter),
    }

    // ---- 3) two-finger pinch out must grow zoom ----
    const zoomBefore = (await readAppState(page)).zoomFromStyle
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2
    await tcdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 120, y: cy, id: 1 }, { x: cx + 120, y: cy, id: 2 }] })
    for (let i = 1; i <= 6; i++) {
      const d = 120 + i * 12 // fingers move apart: pinch out
      await tcdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }] })
      await sleep(40)
    }
    await tcdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await tcdp.detach()
    await sleep(300)
    const stateAfter = await readAppState(page)
    const zoomAfter = stateAfter.zoomFromStyle
    const zoomTextBefore = stateAfter.zoomText
    result.input.pinch = {
      zoomBefore, zoomAfter, zoomTextAfter: zoomTextBefore,
      grew: zoomBefore !== null && zoomAfter !== null && zoomAfter - zoomBefore > 1e-6,
    }
    const inputShot = path.join(shotsDir, `${mode}-input.png`)
    await page.screenshot({ path: inputShot })
    result.screenshots.input = inputShot

    result.errors.externalRequests = Array.from(new Set(result.errors.externalRequests))
    result.pass = result.security.platformIsElectron
      && result.security.rendererHasNoNodeGlobals
      && result.security.webPreferencesSecure
      && result.diagnostics.allRequiredPassed
      && result.diagnostics.totalChecks === 10
      && result.input.pen.changed
      && result.input.palm.unchanged
      && result.input.palm.stylusOnly === true
      && result.input.pinch.grew
      && result.errors.pageErrors.length === 0
      && result.errors.consoleErrors.length === 0
      && result.errors.externalRequests.length === 0
    return result
  } finally {
    await electronApp.close().catch(() => {})
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    playwright: JSON.parse(readFileSync(path.join(REPO, 'node_modules', 'playwright', 'package.json'), 'utf8')).version,
    electron: JSON.parse(readFileSync(path.join(REPO, 'node_modules', 'electron', 'package.json'), 'utf8')).version,
    electronExecutable: EXECUTABLE,
    dist: distDir,
    staging,
    display: process.env.DISPLAY ?? null,
  },
  modes: {},
  limitations: [
    'Physical pen digitizer drivers (Wacom/WinTab/Windows Ink) and true pressure curve on physical hardware — NOT_TESTED (CDP-synthesized PointerEvent only)',
    'Physical multi-touch touchscreen pinch-to-zoom — NOT_TESTED (CDP dispatchTouchEvent synthesis only)',
    'Real device GPUs (Intel/AMD/NVIDIA) and hardware rasterization — NOT_TESTED (Xvfb software rendering; --disable-gpu mode compared separately)',
    'Device digitizer / touchscreen firmware — NOT_TESTED',
    'OS-level Chromium sandbox: depends on setuid chrome-sandbox helper in this environment; renderer webPreferences.sandbox verified separately in the main process',
  ],
}

let exitCode = 0
try {
  for (const [mode, modeArgs] of [['default', []], ['disable-gpu', ['--disable-gpu']]]) {
    console.log(`[electron-audit] mode=${mode} args=${JSON.stringify([...osSandboxArg, ...modeArgs])}`)
    try {
      const r = await runMode(mode, modeArgs)
      report.modes[mode] = r
      console.log(`[electron-audit] mode=${mode} pass=%s security=%s diagnostics=%s pen=%s palmBlocked=%s pinchGrew=%s errors=%d/%d ext=%d`,
        r.pass, r.security.webPreferencesSecure, r.diagnostics.allRequiredPassed, r.input.pen.changed, r.input.palm.unchanged, r.input.pinch.grew,
        r.errors.pageErrors.length, r.errors.consoleErrors.length, r.errors.externalRequests.length)
      if (!r.pass) exitCode = 1
    } catch (modeError) {
      console.error(`[electron-audit] mode=${mode} failed:`, modeError)
      report.modes[mode] = { modeError: String(modeError?.stack || modeError).slice(0, 2000), pass: false }
      exitCode = 1
    }
  }
} catch (error) {
  console.error('[electron-audit] fatal:', error)
  report.fatal = String(error?.stack || error).slice(0, 2000)
  exitCode = 1
} finally {
  try { rmSync(staging, { recursive: true, force: true }) } catch { /* best effort */ }
}
report.durationMs = Date.now() - started
report.summary = {
  defaultPass: report.modes.default?.pass ?? false,
  disableGpuPass: report.modes['disable-gpu']?.pass ?? false,
  pass: exitCode === 0 && !report.fatal,
}
mkdirSync(path.dirname(outJson), { recursive: true })
writeFileSync(outJson, JSON.stringify(report, null, 2))
console.log(`[electron-audit] report written: ${outJson}`)
process.exit(report.summary.pass ? 0 : 1)
