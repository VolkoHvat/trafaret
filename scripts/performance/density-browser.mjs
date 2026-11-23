import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
import { preview } from 'vite'

const server = await preview({ build:{outDir:process.argv[2]??'dist'}, preview: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  const { port } = server.httpServer.address()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() })
  const page = await browser.newPage({ viewport: { width: 1100, height: 920 }, serviceWorkers: 'block' })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' })
  const canvas = page.locator('canvas[aria-label="Поле плотности"]')
  await canvas.waitFor()
  const pixels = () => canvas.evaluate(async c => {
    const bytes = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  })
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const idle = () => page.waitForFunction(() => !document.querySelector('fieldset').disabled)
  const click = name => page.getByRole('button', { name, exact: true }).click()
  await page.getByLabel('Инспектор').selectOption('all'); await click('A → B'); const ab = await pixels(); await click('B → A'); const ba = await pixels(); assert.notEqual(ba, ab)
  await click('A → B'); assert.equal(await pixels(), ab)
  const metrics = await page.getByText(/Контроль 384×240/).innerText()
  await click('Чистое поле'); const blank = await pixels(); assert.notEqual(blank, ab)
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  const at = (x, y, steps = 1) => page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps })
  await at(.25, .5); await page.mouse.down(); const tap = await pixels(); assert.notEqual(tap, blank)
  await page.waitForTimeout(120); assert.equal(await pixels(), tap); await page.mouse.up(); assert.equal(await pixels(), tap)
  await click('Шаг назад'); assert.equal(await pixels(), blank)
  await at(.25, .5); await page.mouse.down(); await at(.75, .5, 24); await settle(); const live = await pixels()
  assert.notEqual(live, tap); await page.mouse.up(); assert.equal(await pixels(), live)
  await page.getByRole('combobox', { name: /^Проекция/ }).selectOption('stencil'); assert.notEqual(await pixels(), live)
  await page.getByRole('combobox', { name: /^Проекция/ }).selectOption('tone'); assert.equal(await pixels(), live)
  await at(.5, .25); await page.mouse.down(); await at(.5, .75, 12); assert.notEqual(await pixels(), live)
  await page.keyboard.press('Escape'); await page.mouse.up(); assert.equal(await pixels(), live)
  await click('Шаг назад'); assert.equal(await pixels(), blank)
  // Repeat the exact native polyline in one coalesced packet versus three independent events.
  const replay = async packed => {
    await at(.25, .5); await page.mouse.down()
    await canvas.evaluate((c, packed) => {
      const r = c.getBoundingClientRect()
      const events = [[.31, .45], [.44, .53], [.25, .5]].map(([x, y]) => new PointerEvent('pointermove', { bubbles: true, pointerId: 1, buttons: 1, clientX: r.x + r.width * x, clientY: r.y + r.height * y }))
      if (packed) { const last = events.at(-1); Object.defineProperty(last, 'getCoalescedEvents', { value: () => events }); c.dispatchEvent(last) }
      else for (const e of events) c.dispatchEvent(e)
    }, packed)
    await page.mouse.up(); await idle(); return pixels()
  }
  const unpacked = await replay(false); assert.notEqual(unpacked, tap); await click('Шаг назад'); assert.equal(await replay(true), unpacked)
  await click('Шаг назад'); await click('Шаг вперёд'); assert.equal(await pixels(), unpacked)
  await click('Шаг назад'); await click('B → A'); assert.equal(await page.getByRole('button', { name: 'Шаг вперёд' }).isDisabled(), true)
  const file = async name => { const [item] = await Promise.all([page.waitForEvent('download'), click(name)]); return readFile(await item.path()) }
  const data = await file('Экспорт поля'); assert.equal(data.length, 737304)
  let mass = 0; for (let i = 24; i < data.length; i += 8) mass += data.readDoubleLE(i)
  assert.ok(Math.abs(mass - 92160) < 1e-7)
  const png = await file('Экспорт PNG')
  const pngPixels = await page.evaluate(async base64 => {
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + base64)).blob())
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d'); ctx.drawImage(bitmap, 0, 0)
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, bitmap.width, bitmap.height).data)), b => b.toString(16).padStart(2, '0')).join('')
  }, png.toString('base64')); assert.equal(pngPixels, ba)
  await click('Чистое поле')
  await page.getByText('Сохранено локально',{exact:true}).waitFor()
  const input = page.locator('input[type=file][accept=".tfd,.tfw"]')
  const upload = buffer => input.setInputFiles({ name: 'test.tfd', mimeType: 'application/octet-stream', buffer })
  await upload(data); await page.getByText('Импортировано', { exact: true }).waitFor(); assert.equal(await pixels(), ba); assert.deepEqual(await file('Экспорт поля'), data)
  const bad = Buffer.from(data); bad[24] ^= 1; await upload(bad); await page.getByText('Повреждены данные поля').waitFor(); assert.equal(await pixels(), ba)
  await canvas.scrollIntoViewIfNeeded(); const center = await canvas.boundingBox(); await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2)
  await page.mouse.down(); assert.notEqual(await pixels(), ba); assert.ok(await page.getByRole('button', { name: 'Экспорт поля' }).isDisabled())
  await page.reload(); await page.mouse.up(); await page.getByLabel('Инспектор').selectOption('all'); await page.getByText('Локальное поле загружено').waitFor(); assert.deepEqual(await file('Экспорт поля'), data)
  await page.getByRole('combobox', { name: /^Кисть/ }).selectOption('nib'); await canvas.scrollIntoViewIfNeeded(); const area = await canvas.boundingBox(); await page.mouse.move(area.x + area.width * .2, area.y + area.height * .5); await page.mouse.down()
  await canvas.evaluate(c => {
    const r = c.getBoundingClientRect(); const events = Array.from({ length: 1400 }, (_, i) => new PointerEvent('pointermove', { bubbles: true, pointerId: 1, buttons: 1, clientX: r.x + r.width * (.2 + .5 * i / 1400), clientY: r.y + r.height * .5 }))
    const e = events.at(-1); Object.defineProperty(e, 'getCoalescedEvents', { value: () => events }); c.dispatchEvent(e)
  }); await page.mouse.up(); await idle(); assert.notEqual(await pixels(), ba)
  await click('Шаг назад'); assert.equal(await pixels(), ba)
  console.log({ mass, fieldSHA256: createHash('sha256').update(data).digest('hex'), pngBytes: png.length })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ browser: browser.version(), port, metrics, ab, ba, live, repacked: unpacked }, null, 2))
} finally {
  try { await browser?.close() } finally { await server.close() }
}
