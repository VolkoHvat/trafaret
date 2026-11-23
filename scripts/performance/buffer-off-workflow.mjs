import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { preview } from 'vite'
import { chromium } from 'playwright'

const outDir = process.argv[2]
assert.ok(outDir, 'usage: buffer-off-workflow.mjs <production outDir>')
const server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
const sha = b => createHash('sha256').update(b).digest('hex')
let browser
try {
  browser = await chromium.launch({ channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, serviceWorkers: 'block' })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const label = name => page.getByLabel(name).filter({ visible: true }).first()
  const click = name => page.getByRole('button', { name, exact: true }).click()
  const group = async value => {
    const menu = page.locator('.hud-switch select')
    if (await menu.isVisible()) await menu.selectOption(value)
  }
  const download = async name => {
    const [d] = await Promise.all([page.waitForEvent('download'), click(name)])
    return d.path()
  }
  const exported = async name => { await group('document'); return readFile(await download(name)) }
  const png = async () => sha(await exported('Экспорт PNG'))
  const tfd = () => exported('Экспорт поля')
  const projection = async mode => { await group('brush'); await label('Проекция').selectOption(mode) }
  const stroke = async (canvas, x, y, end) => {
    const b = await canvas.boundingBox(); assert.ok(b)
    await page.mouse.move(b.x + b.width*x, b.y + b.height*y); await page.mouse.down()
    await page.mouse.move(b.x + b.width*end, b.y + b.height*y, { steps: 8 }); await page.mouse.up()
  }
  const field = label('Поле плотности')
  const line = y => stroke(field, .43, y, .56)
  const history = async name => { await group('scene'); await click(name) }
  const surface = () => click('3D-поверхность')
  const back = () => click('Вернуться в поле')
  const canvasHash = canvas => canvas.evaluate(async c => {
    const rgba = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', rgba))).join(',')
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?field=2048`)
  await page.locator('.hud-status [role=status]').getByText('Новый документ').waitFor()
  assert.equal(await label('Без буфера').isChecked(), false)
  await line(.45)
  const baseline = await tfd()
  assert.equal(baseline.length, 24 + 8*2048**2)
  let donors = 0, receivers = 0
  for (let i=24; i<baseline.length; i+=8) { const v=baseline.readDoubleLE(i); donors+=Number(v<1); receivers+=Number(v>1) }
  assert.ok(donors && receivers, 'full stroke must already have a core and a ring')
  const parity = async () => assert.ok((await tfd()).equals(baseline), 'density bytes changed')
  const full = await png()
  await projection('stencil'); const stencil = await png(); await projection('tone')
  await group('brush'); await label('Без буфера').check()
  await parity(); assert.equal(await png(), full)
  await group('pigment'); await label('Режим пигмента').selectOption('line'); await label('Цвет линии').fill('#bd2875')
  await line(.45); await parity(); const repeated = await png(); assert.notEqual(repeated, full)
  await line(.46); await parity(); const adjacent = await png(); assert.notEqual(adjacent, repeated)
  await projection('stencil'); assert.equal(await png(), stencil); await projection('tone')
  await history('Шаг назад'); assert.equal(await png(), repeated); await parity()
  await history('Шаг вперёд'); assert.equal(await png(), adjacent); await parity()
  await group('pigment'); await label('Режим пигмента').selectOption('material'); await label('Добавлять новый пигмент').check()
  const materialBefore = await exported('Сохранить документ'); await line(.46)
  assert.ok((await exported('Сохранить документ')).equals(materialBefore), 'material/off with feed changed document'); await parity(); assert.equal(await png(), adjacent)
  await surface(); await click('Цвет'); assert.equal(await label('Без буфера').isChecked(), true)
  await label('Режим пигмента').selectOption('line')
  const model = label('3D-модель тела'), modelBefore = await canvasHash(model)
  await stroke(model,.49,.40,.51); const modelAfter = await canvasHash(model); assert.notEqual(modelAfter, modelBefore, 'model stroke missed')
  await click('Файл'); assert.ok((await readFile(await download('Скачать поле .tfd'))).equals(baseline))
  await back(); const shared = await png(); assert.notEqual(shared, adjacent); await parity()
  await surface(); await click('Отменить'); assert.equal(await canvasHash(model), modelBefore); await back(); assert.equal(await png(), adjacent)
  await history('Шаг вперёд'); assert.equal(await png(), shared); await surface(); assert.equal(await canvasHash(model), modelAfter); await back()
  await projection('stencil'); assert.equal(await png(), stencil); await projection('tone')
  await group('document'); const saved = await download('Сохранить документ'), bytes = await readFile(saved)
  const meta = JSON.parse(bytes.subarray(16,16+bytes.readUInt32LE(8))); assert.equal(meta.bufferMode,'off'); assert.ok(meta.pigment.tiles.length)
  page.once('dialog', d=>d.accept()); await click('Новый документ'); await group('brush'); assert.equal(await label('Без буфера').isChecked(),false)
  assert.notEqual(await png(), shared)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'),click('Открыть документ')]); page.once('dialog',d=>d.accept()); await chooser.setFiles(saved)
  await page.locator('.hud-status b').getByText('Документ открыт').waitFor(); await group('brush'); assert.equal(await label('Без буфера').isChecked(),true)
  await parity(); assert.equal(await png(), shared); await projection('stencil'); assert.equal(await png(), stencil)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({result:'PASS',edge:browser.version(),node:process.version,donors,receivers,tfdBytes:baseline.length,tfdSHA256:sha(baseline),tone:{full,repeated,adjacent,shared},stencil,materialOff:'unchanged',reopenedPigmentTiles:meta.pigment.tiles.length},null,2))
} finally { await browser?.close(); await server.close() }
