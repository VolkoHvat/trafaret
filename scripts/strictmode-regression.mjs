#!/usr/bin/env node
// Dev-only React StrictMode regression check against the REAL Vite development
// server. In development, StrictMode simulates unmount: StudioCanvas
// useLayoutEffect cleanup shrinks the visible canvas to 1x1, and the following
// effect setup must restore the document-sized backing store. This script
// launches `vite` on loopback with --strictPort, opens the app in headless
// Chromium via Playwright, waits for the post-StrictMode state (no fixed
// sleeps as proof; state polling with timeout), then verifies the working
// canvas backing size matches the active document and reads back pixels.
// No production debug API, no external network, non-zero exit on any failure.
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const HOST = '127.0.0.1'
const BG = [243, 241, 233, 255]

const ignored = []
for (const pattern of [/Failed to load resource/, /the server responded with a status of 404/, /favicon/i, /net::ERR/, /does not have a service worker/i, /React DevTools/i]) ignored.push(pattern)

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, HOST, () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

function httpGet(url, timeoutMs = 3000) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('timeout', () => { req.destroy(); resolve(0) })
    req.on('error', () => resolve(0))
  })
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await httpGet(url)
    if (status === 200) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

// Same identification mechanism as the other dev audit scripts: the working
// canvas is `canvas.drawing-canvas`; document size is parsed from the existing
// `.canvas-document-label` text ("<w> × <h> px · ..."), not from the canvas.
async function readCanvasState(page) {
  return page.evaluate(() => {
    const el = document.querySelector('canvas.drawing-canvas')
    const label = document.querySelector('.canvas-document-label')?.textContent ?? ''
    const match = label.match(/(\d+)\s*×\s*(\d+)\s*px/)
    return {
      canvasW: el ? el.width : null,
      canvasH: el ? el.height : null,
      docW: match ? Number(match[1]) : null,
      docH: match ? Number(match[2]) : null,
      label,
    }
  })
}

async function main() {
  const port = await getFreePort()
  const url = `http://${HOST}:${port}/`
  const serverLog = []
  const server = spawn(process.execPath, [viteBin, '--host', HOST, '--port', String(port), '--strictPort'], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', d => serverLog.push(String(d).slice(0, 400)))
  server.stderr.on('data', d => serverLog.push(String(d).slice(0, 400)))
  const serverExited = new Promise(resolve => server.once('exit', code => resolve(code)))

  let browser = null
  const evidence = { url, strictPort: true, strictMode: {}, checks: {} }
  let pass = false
  try {
    const ready = await waitForHttp(url, 30_000)
    const earlyExit = ready ? null : await Promise.race([serverExited, Promise.resolve(null)])
    if (!ready) {
      evidence.checks.serverReady = false
      evidence.serverLogTail = serverLog.slice(-5)
      if (earlyExit !== null) evidence.serverExitCode = earlyExit
      console.log(JSON.stringify({ status: 'FAIL', ...evidence }, null, 2))
      return 1
    }
    evidence.checks.serverReady = true

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1'],
    })
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    const pageErrors = []
    const consoleErrors = []
    page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)))
    page.on('console', m => { if (m.type() === 'error' && !ignored.some(p => p.test(m.text()))) consoleErrors.push(m.text().slice(0, 300)) })

    await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
    await page.waitForSelector('canvas.drawing-canvas', { timeout: 15_000 })
    await page.waitForSelector('.canvas-document-label', { timeout: 15_000 })

    // Wait for the post-StrictMode steady state: setup→cleanup→setup has
    // finished and the visible backing store is document-sized again. The
    // condition must hold on two consecutive polls to prove stability.
    const deadline = Date.now() + 15_000
    let stablePolls = 0
    let state = null
    while (Date.now() < deadline && stablePolls < 2) {
      state = await readCanvasState(page)
      const restored = state.canvasW !== null && state.docW !== null
        && state.canvasW === state.docW && state.canvasH === state.docH
      stablePolls = restored ? stablePolls + 1 : 0
      if (stablePolls < 2) await new Promise(r => setTimeout(r, 100))
    }
    evidence.strictMode = { stablePolls, state }

    const readback = await page.evaluate(() => {
      const el = document.querySelector('canvas.drawing-canvas')
      if (!el) return null
      const ctx = el.getContext('2d', { willReadFrequently: true })
      const { width, height } = el
      const image = ctx.getImageData(0, 0, width, height)
      return {
        backingW: width, backingH: height,
        dataLength: image.data.length,
        expectedLength: width * height * 4,
        cornerPixel: Array.from(image.data.slice(0, 4)),
      }
    })

    const c = evidence.checks
    c.canvasNot1x1 = Boolean(state && state.canvasW !== 1 && state.canvasH !== 1)
    c.backingMatchesDoc = Boolean(state && readback && readback.backingW === state.docW && readback.backingH === state.docH && state.docW !== null)
    c.readbackLength = Boolean(readback && readback.dataLength === readback.expectedLength)
    c.cornerBackground = Boolean(readback && readback.cornerPixel.join(',') === '243,241,233,255')
    c.noPageErrors = pageErrors.length === 0
    c.noConsoleErrors = consoleErrors.length === 0
    evidence.readback = readback ? { ...readback, cornerPixel: readback.cornerPixel } : null
    evidence.pageErrors = pageErrors
    evidence.consoleErrors = consoleErrors
    evidence.background = BG

    pass = Object.values(c).every(Boolean)
    evidence.status = pass ? 'PASS' : 'FAIL'
    console.log(JSON.stringify(evidence, null, 2))
    await context.close().catch(() => {})
    return pass ? 0 : 1
  } finally {
    if (browser) await browser.close().catch(() => {})
    // Kill only the dev server this script spawned (detached process group).
    if (server.pid) {
      try { process.kill(-server.pid, 'SIGTERM') } catch { try { server.kill('SIGTERM') } catch { /* already gone */ } }
      const dead = await Promise.race([serverExited, new Promise(r => setTimeout(() => r('timeout'), 3000))])
      if (dead === 'timeout') {
        try { process.kill(-server.pid, 'SIGKILL') } catch { try { server.kill('SIGKILL') } catch { /* already gone */ } }
        await Promise.race([serverExited, new Promise(r => setTimeout(r, 1000))]).catch(() => {})
      }
    }
  }
}

main().then(code => process.exit(code)).catch(e => {
  console.error(String(e).slice(0, 500))
  process.exit(1)
})
