import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { preview } from 'vite'

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.tools/ms-playwright')
const { firefox } = await import('playwright')
const outDir = resolve('.tools/large-final')
const server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false } })
const url = `http://127.0.0.1:${server.httpServer.address().port}/?field=2048`
let browser, stopped = false
try {
  const index = await readFile(`${outDir}/index.html`, 'utf8')
  assert.equal(await (await fetch(url)).text(), index)
  browser = await firefox.launch({ executablePath: firefox.executablePath() })
  const ctx = await browser.newContext({ viewport: { width: 1150, height: 940 }, serviceWorkers: 'allow' })
  let p = await ctx.newPage()
  await p.goto(url)
  const ua = await p.evaluate(() => navigator.userAgent)
  assert.equal(browser.browserType().name(), 'firefox'); assert.match(ua, /Gecko\/\d+ Firefox\//)
  console.log({ outDir, indexSHA256: createHash('sha256').update(index).digest('hex'), executable: firefox.executablePath(), version: browser.version(), ua })
  const click = n => p.getByRole('button', { name: n, exact: true }).click()
  const label = n => p.getByLabel(n).filter({ visible: true })
  const saved = () => p.getByText('Сохранено локально', { exact: true }).filter({ visible: true }).waitFor()
  const field = () => label('Поле плотности'), model = () => label('3D-модель тела')
  const frame = c => c.evaluate(el => el.toDataURL())
  const colors = c => c.evaluate(el => {
    const a = el.getContext('2d').getImageData(0, 0, el.width, el.height).data
    let red = 0, blue = 0
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] > a[i+1]*4 && a[i] > a[i+2]*3) red++
      if (a[i+2] > a[i]*4 && a[i+2] > a[i+1]*2) blue++
    }
    return { red, blue }
  })
  const gesture = async (c, x, y, dx = 0) => {
    await c.scrollIntoViewIfNeeded(); const b = await c.boundingBox()
    await p.mouse.move(b.x + b.width*x, b.y + b.height*y); await p.mouse.down()
    if (dx) await p.mouse.move(b.x + b.width*(x+dx), b.y + b.height*y, { steps: 6 })
    await p.mouse.up()
  }
  await p.getByText('Новый документ', { exact: true }).last().waitFor()
  assert.deepEqual(await field().evaluate(c => [c.width, c.height]), [2048,2048])
  await click('3D-поверхность'); const measure = () => p.getByRole('spinbutton').first()
  const value = await measure().getAttribute('max'); await measure().fill(value); await measure().press('Tab'); await saved()
  await click('Вернуться в поле'); const blank = await frame(field())
  await label('Режим пигмента').selectOption('line'); await label('Цвет линии').fill('#ec1634')
  await gesture(field(), .33, .5, .04); await saved()
  const line = await frame(field()); assert.ok((await colors(field())).red > 5)
  await click('Шаг назад'); await saved(); assert.equal(await frame(field()), blank)
  await click('Шаг вперёд'); await saved(); assert.equal(await frame(field()), line)
  console.log('PASS field line and history')
  await click('3D-поверхность'); const beforeStroke = await frame(model())
  await gesture(model(), .5, .48, .03); await saved(); assert.notEqual(await frame(model()), beforeStroke)
  assert.ok((await colors(model())).red > 5)
  await label('Режим пигмента').selectOption('fill'); await label('Цвет заливки').fill('#123df1')
  const beforeFill = await frame(model()); await gesture(model(), .51, .53); await click('Отменить заливку'); assert.equal(await frame(model()), beforeFill)
  await gesture(model(), .51, .53); await click('Применить заливку'); await saved(); assert.ok((await colors(model())).blue > 5)
  const front = await frame(model()); await click('Разворот 180°'); assert.notEqual(await frame(model()), front)
  await click('Вся фигура'); assert.equal(await frame(model()), front); await click('Вернуться в поле')
  const painted = await frame(field()); const rgb = await colors(field()); assert.ok(rgb.blue > 5 && rgb.red > 5)
  await click('Шаг назад'); await saved(); assert.equal((await colors(field())).blue, 0)
  await click('Шаг вперёд'); await saved(); assert.equal(await frame(field()), painted)
  console.log('PASS Surface line/fill, orbit and shared history', rgb)
  const download = async name => (await Promise.all([p.waitForEvent('download'), click(name)]))[0]
  const png = await readFile(await (await download('Экспорт PNG')).path()); const size = [png.readUInt32BE(16),png.readUInt32BE(20)]
  assert.deepEqual(size, [2048,2048]); assert.equal('data:image/png;base64,' + png.toString('base64'), painted)
  const doc = await download('Сохранить документ'); assert.match(doc.suggestedFilename(), /\.tfw$/i)
  const bytes = await readFile(await doc.path()); p.once('dialog', d => d.accept()); await click('Новый документ'); await saved(); assert.equal(await frame(field()), blank)
  const chooser = p.waitForEvent('filechooser'); await click('Открыть документ'); p.once('dialog', d => d.accept())
  await (await chooser).setFiles({ name:'color.tfw', mimeType:'application/octet-stream', buffer:bytes })
  await p.getByText('Документ открыт', { exact:true }).waitFor(); await saved(); assert.equal(await frame(field()), painted)
  await click('3D-поверхность'); assert.equal(await measure().inputValue(), value); assert.equal(await frame(model()), front)
  console.log('PASS PNG and .tfw roundtrip', { size, pngBytes:png.length, tfwBytes:bytes.length, measure:value })
  await p.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated')
  await p.close(); await server.close(); stopped = true; await assert.rejects(fetch(url)); await ctx.setOffline(true)
  p = await ctx.newPage(); await p.goto(url); await p.getByText('Локальное поле загружено', { exact:true }).waitFor()
  const offline = await p.evaluate(() => ({ online:navigator.onLine, controller:navigator.serviceWorker.controller?.scriptURL }))
  assert.equal(offline.online,false); assert.equal(offline.controller,new URL('/sw.js', url).href)
  assert.equal(await frame(field()), painted); await click('3D-поверхность'); assert.equal(await frame(model()), front); assert.equal(await measure().inputValue(),value)
  console.log('PASS offline new tab, origin stopped, identical field and Surface', offline)
} finally { try { await browser?.close() } finally { if (!stopped) await server.close() } }
