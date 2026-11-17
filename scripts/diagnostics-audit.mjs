#!/usr/bin/env node
// Dev-only production diagnostics audit: runs the BUILT bundle in Chromium
// (default and --disable-gpu), opens the real «Диагностика устройства» dialog,
// extracts the full report from the DOM and fails on missing report, failed
// required checks, page/console errors, failed local resources or missing
// NOT_TESTED hardware limitations. No src/threshold/dependency changes.
// No network access beyond the loopback static server. No credentials.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
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
const outJson = args.out || '/mnt/agents/private/trafaret-audit/diagnostics-browser.json'
if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error(`dist not found: ${distDir}`)
  process.exit(2)
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
}
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
const VIEW = { width: 1280, height: 800 }

// id -> label map from runEnvironmentDiagnostics() source, applied to DOM order
// (ids are React keys and are not rendered into the DOM). Mismatches recorded.
const sourceChecks = []
{
  const src = readFileSync(new URL('../src/lib/diagnostics.ts', import.meta.url), 'utf8')
  const re = /runCheck\('([^']+)',\s*'((?:[^'\\]|\\.)*)'/g
  let m
  while ((m = re.exec(src))) sourceChecks.push({ id: m[1], label: m[2].replace(/\\'/g, "'") })
}

const LIMITATION_RULES = [
  { key: 'wacom-wintab-ink', pattern: /Wacom|WinTab|Windows Ink/i },
  { key: 'touchscreen-multitouch', pattern: /multitouch|мультитач|касан/i },
  { key: 'gpu', pattern: /Intel|AMD|NVIDIA|GPU-драйвер/i },
  { key: 'digitizer', pattern: /дигитайзер/i },
]

function extractDialog() {
  const content = document.querySelector('.dialog-content .diagnostics-content')
  if (!content) return null
  const num = el => { const v = Number(el?.textContent?.trim()); return Number.isFinite(v) ? v : null }
  const counts = {
    pass: num(document.querySelector('.diag-counts .diag-count.diag-pass dd')),
    review: num(document.querySelector('.diag-counts .diag-count.diag-review dd')),
    fail: num(document.querySelector('.diag-counts .diag-count.diag-fail dd')),
  }
  const factsLine = document.querySelector('.diag-facts')?.textContent?.trim() ?? null
  const checks = Array.from(document.querySelectorAll('.diag-list .diag-check')).map(row => {
    const statusEl = row.querySelector('.diag-status')
    const status = statusEl?.classList.contains('diag-pass') ? 'pass'
      : statusEl?.classList.contains('diag-review') ? 'review'
      : statusEl?.classList.contains('diag-fail') ? 'fail' : 'unknown'
    return {
      label: row.querySelector('strong')?.textContent?.trim() ?? null,
      status,
      required: row.querySelector('.diag-required')?.textContent?.trim() === 'обязательно',
      evidence: Array.from(row.querySelectorAll('ul li')).map(li => li.textContent.trim()),
    }
  })
  const limitations = Array.from(document.querySelectorAll('.diag-limitations li')).map(li => li.textContent.trim())
  return { counts, factsLine, checks, limitations }
}

async function runMode(mode, extraArgs, server, outDir) {
  const result = {
    mode, args: extraArgs,
    launched: false, canvasReady: false, productionNoDevHook: null,
    runningStateSeen: false, reportRenderedBeforeDialogOpen: null,
    report: null, screenshot: null,
    pageErrors: [], consoleErrors: [], failedResponses: [], requestFailures: [], externalRequests: [],
    failures: [], pass: false,
  }
  const port = server.address().port
  const url = `http://127.0.0.1:${port}/`
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1', ...extraArgs],
  })
  try {
    result.launched = true
    const context = await browser.newContext({ viewport: VIEW })
    const page = await context.newPage()
    page.on('pageerror', e => result.pageErrors.push(String(e).slice(0, 500)))
    // No ignore patterns: every console error counts.
    page.on('console', m => { if (m.type() === 'error') result.consoleErrors.push(m.text().slice(0, 500)) })
    page.on('response', r => {
      const u = new URL(r.url())
      if (u.hostname !== '127.0.0.1') { result.externalRequests.push(r.url()); return }
      if (r.status() >= 400) result.failedResponses.push({ url: r.url(), status: r.status() })
    })
    page.on('requestfailed', r => {
      const u = new URL(r.url())
      if (u.hostname !== '127.0.0.1') { result.externalRequests.push(r.url()); return }
      result.requestFailures.push({ url: r.url(), error: r.failure()?.errorText ?? 'unknown' })
    })

    await page.goto(url, { waitUntil: 'load', timeout: 30000 })
    await page.waitForSelector('canvas.drawing-canvas', { timeout: 15000 })
    result.canvasReady = true
    result.productionNoDevHook = await page.evaluate(() => !('__tattooStudio' in window))
    // The app runs diagnostics in requestIdleCallback (timeout 2000) — give it time.
    await sleep(2500)

    // Open the dialog with the real button.
    await page.click('button.text-button:has-text("Диагностика устройства")')
    await page.waitForSelector('.dialog-content', { timeout: 10000 })
    const running = page.locator('.dialog-content .diag-running')
    if (await running.count() > 0) {
      result.runningStateSeen = true
      await running.waitFor({ state: 'detached', timeout: 10000 })
    } else {
      // Report was already there when the dialog opened — the idle run completed.
      result.reportRenderedBeforeDialogOpen = true
    }
    await page.waitForSelector('.dialog-content .diagnostics-content', { timeout: 10000 })

    const report = await page.evaluate(extractDialog)
    if (!report) throw new Error('diagnostics-content rendered but extraction returned null')
    // Attach ids by DOM order against runEnvironmentDiagnostics() source; flag mismatches.
    report.checks = report.checks.map((check, i) => {
      const src = sourceChecks[i]
      return {
        id: src?.id ?? null,
        idSourceLabel: src?.label ?? null,
        labelMatchesSource: src ? src.label === check.label : false,
        ...check,
      }
    })
    result.report = report

    // Limitation coverage: each physical-limitation keyword must appear in a
    // NOT_TESTED line of the dialog limitations list.
    result.limitationCoverage = {}
    for (const rule of LIMITATION_RULES) {
      result.limitationCoverage[rule.key] = report.limitations.some(line => rule.pattern.test(line) && /NOT_TESTED/.test(line))
    }
    // Every physical-limitation line (matched by LIMITATION_RULES) must carry NOT_TESTED.
    const physicalLines = report.limitations.filter(l => LIMITATION_RULES.some(rule => rule.pattern.test(l)))
    result.physicalLimitationsNotTested = physicalLines.length > 0 && physicalLines.every(l => /NOT_TESTED/.test(l))

    const shotName = `diagnostics-${mode}.png`
    await page.screenshot({ path: path.join(outDir, shotName), fullPage: true })
    result.screenshot = shotName

    // ---- verdicts ----
    const f = result.failures
    if (result.productionNoDevHook !== true) f.push('DEV hook __tattooStudio present in production build')
    if (report.counts.pass === null || report.counts.review === null || report.counts.fail === null) f.push('counts missing in dialog')
    const countSum = (report.counts.pass ?? 0) + (report.counts.review ?? 0) + (report.counts.fail ?? 0)
    if (countSum !== report.checks.length) f.push(`counts sum ${countSum} != checks rendered ${report.checks.length}`)
    for (const check of report.checks) {
      if (!check.id) f.push(`check #${report.checks.indexOf(check)} has no id (source has ${sourceChecks.length} checks)`)
      if (check.id && !check.labelMatchesSource) f.push(`check ${check.id}: label mismatch DOM vs source`)
      if (check.required && check.status === 'fail') f.push(`required check ${check.id ?? check.label} failed`)
      if (check.status === 'unknown') f.push(`check ${check.id ?? check.label} has unknown status`)
    }
    for (const [key, ok] of Object.entries(result.limitationCoverage)) {
      if (!ok) f.push(`limitation missing or without NOT_TESTED: ${key}`)
    }
    if (!result.physicalLimitationsNotTested) f.push('a physical limitation line lacks NOT_TESTED')
    if (result.pageErrors.length) f.push(`pageerrors: ${result.pageErrors.length}`)
    if (result.consoleErrors.length) f.push(`console errors: ${result.consoleErrors.length}`)
    if (result.failedResponses.length) f.push(`failed local responses: ${JSON.stringify(result.failedResponses)}`)
    if (result.requestFailures.length) f.push(`failed local requests: ${JSON.stringify(result.requestFailures)}`)
    if (result.externalRequests.length) f.push(`external network requests: ${JSON.stringify(result.externalRequests)}`)
    result.pass = f.length === 0
  } finally {
    await browser.close().catch(() => {})
  }
  return result
}

// ---------- main ----------
const started = Date.now()
const outDir = path.dirname(outJson)
mkdirSync(outDir, { recursive: true })
console.log(`[diag-audit] dist=${distDir} out=${outJson}`)
const server = await serve(distDir)
const modes = [
  { mode: 'default', extraArgs: [] },
  { mode: 'disable-gpu', extraArgs: ['--disable-gpu'] },
]
const results = []
try {
  for (const { mode, extraArgs } of modes) {
    try {
      const r = await runMode(mode, extraArgs, server, outDir)
      results.push(r)
      console.log(`[diag-audit] ${mode}: checks=${r.report?.checks.length ?? 0} counts=${JSON.stringify(r.report?.counts)} pass=${r.pass}${r.failures.length ? ' failures=' + JSON.stringify(r.failures) : ''}`)
    } catch (error) {
      const r = { mode, args: extraArgs, launchFailed: true, error: String(error).slice(0, 1000), failures: [`run crashed: ${String(error).slice(0, 300)}`], pass: false }
      results.push(r)
      console.log(`[diag-audit] ${mode}: RUN CRASHED ${String(error).slice(0, 200)}`)
    }
  }
} finally {
  await new Promise(r => server.close(() => r()))
}

const report = {
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - started,
  environment: {
    node: process.version,
    playwright: JSON.parse(readFileSync(new URL('../node_modules/playwright/package.json', import.meta.url), 'utf8')).version,
    dist: distDir, viewport: VIEW,
    note: 'Production bundle audit. No DEV __tattooStudio hook expected. Optional checks (offscreen, pen-pressure, coalesced-events) may be review — not a FAIL.',
  },
  modes: results,
  summary: {
    defaultPass: results.find(r => r.mode === 'default')?.pass ?? false,
    disableGpuPass: results.find(r => r.mode === 'disable-gpu')?.pass ?? false,
  },
}
report.summary.pass = report.summary.defaultPass && report.summary.disableGpuPass
writeFileSync(outJson, JSON.stringify(report, null, 2))
console.log(`[diag-audit] report written: ${outJson}`)
console.log(`[diag-audit] overall: ${report.summary.pass ? 'PASS' : 'FAIL'}`)
process.exit(report.summary.pass ? 0 : 1)
