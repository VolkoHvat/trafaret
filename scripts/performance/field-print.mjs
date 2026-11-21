import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { build } from 'vite'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const fixture = 'scripts/performance/field-print.html'
// Compile only this fixture in memory: no shared dev server, dep scanner, PWA or dist.
const { output } = await build({
  configFile: false, envFile: false, publicDir: false, css: { postcss: { plugins: [] } },
  build: { write: false, minify: false, rollupOptions: { input: fixture } },
})
const origin = 'http://field-print.test'
const outputPath = process.argv[2]
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() })
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.print = () => { window.printRaster = [document.images[0].complete, document.images[0].naturalWidth] }
  })
  await page.route(`${origin}/**`, route => {
    const file = output.find(f => `/${f.fileName}` === new URL(route.request().url()).pathname)
    if (!file) return route.abort()
    return route.fulfill(file.type === 'chunk'
      ? { contentType: 'application/javascript', body: file.code }
      : { contentType: 'text/html; charset=utf-8', body: file.source })
  })
  await page.goto(`${origin}/${fixture}`)
  const width = page.getByRole('spinbutton'), print = page.getByRole('button', { name: 'Печать поля 1:1' })
  await width.fill('191'); await print.click()
  await page.getByRole('alert').filter({ hasText: 'A4' }).waitFor()
  assert.equal(await page.locator('iframe').count(), 0)
  await width.fill('102.4'); await print.click()
  const sheet = page.frameLocator('iframe')
  await sheet.locator('img').waitFor({ state: 'attached' })
  await page.waitForFunction(() => document.querySelector('iframe').contentWindow.printRaster)
  const frame = page.frames().find(f => f.parentFrame())
  assert.deepEqual(await frame.evaluate(() => window.printRaster), [true, 384])
  assert.equal(await frame.locator('canvas,#backdrop,input').count(), 0)
  // CDP prints a top-level page. Promote the exact captured print document, not a recreated layout.
  const pdfPage = await browser.newPage()
  await pdfPage.setContent(await frame.content())
  await pdfPage.emulateMedia({ media: 'print' })
  const mm = await pdfPage.evaluate(async () => {
    const img = document.images[0]; await img.decode()
    const rect = img.getBoundingClientRect(), ruler = document.querySelector('.ruler').getBoundingClientRect()
    return [rect.width, rect.height, ruler.width].map(px => px * 25.4 / 96)
  })
  function close(actual, expected, tolerance) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected} ±${tolerance} mm`) }
  ;[102.4, 64, 50].forEach((expected, i) => close(mm[i], expected, 0.01))
  if (outputPath) await mkdir(dirname(outputPath), { recursive: true })
  const bytes = await pdfPage.pdf({ preferCSSPageSize: true, scale: 1, displayHeaderFooter: false, path: outputPath })
  if (outputPath) assert.deepEqual(await readFile(outputPath), bytes)
  const pdf = bytes.toString('latin1')
  assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, 1)
  const box = /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)
  assert.ok(box, 'Missing Chromium PDF MediaBox')
  const paper = box.slice(1).map(pt => Number(pt) * 25.4 / 72)
  close(paper[0], 210, 0.5); close(paper[1], 297, 0.5)
  console.log(JSON.stringify({ printLayoutMm: mm, pdfPageMm: paper, pages: 1, decodedBeforePrint: true, paperMeasurement: 'NOT_TESTED' }))
} finally { await browser?.close() }
