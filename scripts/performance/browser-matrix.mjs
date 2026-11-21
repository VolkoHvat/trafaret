import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, firefox } from 'playwright'
import { preview } from 'vite'

// Run after npm run build. No installs, personal profiles or external test server.
const targets = [
  ['Edge', chromium, { channel: 'msedge' }],
  ['Chrome', chromium, { channel: 'chrome' }],
  ['Firefox (Playwright-compatible)', firefox, process.env.FIREFOX_PATH ? { executablePath: process.env.FIREFOX_PATH } : {}],
  ['Chromium (supplementary)', chromium, { executablePath: resolve('.tools/ms-playwright/chromium-1234/chrome-win64/chrome.exe') }],
]
const button = (page, name) => page.getByRole('button', { name, exact: true })
const field = page => page.getByLabel('Поле плотности', { exact: true })
const pixels = canvas => canvas.evaluate(c => c.toDataURL())
const probes = {
  async workspace(page) {
    const canvas = field(page)
    await button(page, 'Чистое поле').click()
    const blank = await pixels(canvas)
    await canvas.click()
    assert.ok(await pixels(canvas) !== blank, 'tap must change field projection')
    await button(page, 'Шаг назад').click()
    assert.ok(await pixels(canvas) === blank, 'undo must restore projection')
  },
  async offlineWarmReload(page) {
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active))
    await page.reload()
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    await page.context().setOffline(true)
    const response = await page.reload()
    assert.ok(response?.fromServiceWorker(), 'offline navigation must use SW')
    await probes.workspace(page)
  },
  async manualRasterReport(page) {
    const data = await pixels(field(page))
    const picker = page.waitForEvent('filechooser')
    await button(page, 'Импорт PNG/JPEG reference').click()
    await (await picker).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(data.split(',')[1], 'base64') })
    const consent = page.getByLabel(/Записывать отчёт текущей обработки/)
    await consent.waitFor()
    assert.equal(await consent.isChecked(), false)
    const download = button(page, 'Скачать отдельный отчёт')
    assert.equal(await download.count(), 0)
    await consent.check()
    const event = page.waitForEvent('download')
    await download.click()
    assert.deepEqual(JSON.parse(await readFile(await (await event).path(), 'utf8')), { mode: 'manual', settings: null, counts: { autoStrokes: 0 } })
    await consent.uncheck()
    assert.equal(await download.count(), 0)
  },
  async printLayout(page) {
    await page.getByLabel('Ширина поля, мм').fill('80')
    const source = await pixels(field(page))
    await button(page, 'Печать поля 1:1').click()
    const img = page.frameLocator('iframe[title="Лист печати поля"]').getByAltText('Поле', { exact: true })
    assert.ok(await img.getAttribute('src') === source, 'print must use current projection')
    const bounds = await img.boundingBox()
    assert.ok(bounds && Math.abs(bounds.width * 25.4 / 96 - 80) < 0.1, 'expected 80mm layout')
  },
  async surface(page) {
    await page.getByRole('link', { name: 'Открыть режим рисования на 3D-модели' }).click()
    const model = page.getByLabel('3D-модель тела', { exact: true }), atlas = page.getByLabel('Развёртка поля', { exact: true })
    const before = await pixels(atlas), view = await pixels(model)
    await model.click()
    assert.ok(await pixels(atlas) !== before && await pixels(model) !== view, 'tap must update both projections')
    await button(page, 'Отменить').click()
    assert.ok(await pixels(atlas) === before && await pixels(model) === view, 'undo must restore both projections')
  },
}
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } })
const url = `http://127.0.0.1:${server.httpServer.address().port}/`
try {
  for (const [name, type, options] of targets) {
    let browser
    try { browser = await type.launch(options) } catch (e) {
      console.log(JSON.stringify({ name, status: 'NOT_TESTED', reason: e.message.split('\n')[0] }))
      if (!name.startsWith('Chromium')) process.exitCode ||= 2
      continue
    }
    try {
      for (const [probe, test] of Object.entries(probes)) {
        const context = await browser.newContext(), errors = []
        context.setDefaultTimeout(10000)
        try {
          if (probe === 'printLayout') await context.addInitScript(() => { window.print = () => {} })
          const page = await context.newPage()
          page.on('pageerror', e => errors.push(e.message))
          await page.goto(url)
          await test(page)
          assert.deepEqual(errors, [])
          console.log(JSON.stringify({ name, version: browser.version(), probe, status: 'PASS' }))
        } catch (e) {
          process.exitCode = 1
          console.log(JSON.stringify({ name, version: browser.version(), probe, status: 'FAIL', reason: e.message, errors }))
        } finally { await context.close() }
      }
    } finally { await browser.close() }
  }
} finally { await server.close() }
