import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { preview } from 'vite'
import { chromium } from 'playwright'

const outDir = process.argv[2]
assert.ok(outDir, 'Usage: node scripts/performance/tattoo-detail-quality.mjs <production-outDir>')
const html = await readFile(`${outDir}/index.html`, 'utf8')
assert.match(html, /src="[^" ]*assets\/[^" ]+\.js"/)
const sha = b => createHash('sha256').update(b).digest('hex')
const server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  browser = await chromium.launch({ channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 3000, height: 2400 }, serviceWorkers: 'block' })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const url = `http://127.0.0.1:${server.httpServer.address().port}/?field=2048`
  assert.equal(await (await page.goto(url)).text(), html)
  await page.getByText('Новый документ', { exact: true }).last().waitFor()
  const canvas = page.getByLabel('Поле плотности', { exact: true })
  const label = n => page.getByLabel(n).filter({ visible: true })
  const click = n => page.getByRole('button', { name: n, exact: true }).click()
  const saved = () => page.getByRole('status').filter({ hasText: 'Сохранено локально' }).waitFor()
  const frame = () => canvas.evaluate(async c => {
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), x => x.toString(16).padStart(2, '0')).join('')
  })
  const field = async () => {
    const download = page.waitForEvent('download')
    await click('Экспорт поля')
    const b = await readFile(await (await download).path())
    assert.equal(b.length, 24 + 8 * 2048 ** 2)
    assert.equal(b.toString('ascii', 0, 8), 'TRAFDENS')
    return b
  }
  for (const name of [/^Радиус/, /^Буфер/]) {
    const slider = page.getByRole('slider', { name })
    await slider.press('Home'); assert.equal(await slider.inputValue(), '2')
  }
  await label('Режим пигмента').selectOption('line')
  await label('Цвет линии').fill('#ff0000')
  const box = await canvas.boundingBox()
  const mouse = page.mouse
  const move = ([x,y], steps = 1) => mouse.move(box.x + (x + .5) * box.width / 2048, box.y + (y + .5) * box.height / 2048, { steps })
  const stroke = async points => {
    await move(points[0]); await mouse.down()
    for (const p of points.slice(1)) await move(p, 12)
    await mouse.up(); await saved()
  }
  const failures = []
  const check = (name, value, ok) => {
    console.log(JSON.stringify({ name, value, pass: ok }))
    if (!ok) failures.push(name)
  }
  console.log(JSON.stringify({ synthetic: 'Playwright mouse; document cells, not mm', edge: browser.version(), node: process.version, box, html: sha(html) }))
  const pixels = (x,y,w,h) => canvas.evaluate((c,[x,y,w,h]) => Array.from(c.getContext('2d').getImageData(x,y,w,h).data), [x,y,w,h])
  const red = (a,i) => a[i] > a[i+1] * 2 && a[i] > a[i+2] * 2
  const rho = (b,x,y) => b.readDoubleLE(24 + (y*2048+x)*8)
  // Two 96-cell lines, 14 cells apart; the middle three rows must remain pristine.
  const blank = await pixels(808,806,81,3)
  const line = [[800,800],[896,800]]
  await stroke(line); await stroke([[800,814],[896,814]])
  const pair = await field(), pairHash = sha(pair), pairFrame = await frame()
  const coverage = [], widths = []
  for (const y of [800,814]) {
    const a = await pixels(808,y-4,81,9)
    const counts = Array.from({length:81}, (_,x) => Array.from({length:9}, (_,j) => red(a,4*(81*j+x))).filter(Boolean).length)
    coverage.push(counts.filter(Boolean).length); widths.push(Math.max(...counts))
  }
  check('continuous thin rails (81 columns each; <=6 red cells wide)', {coverage,widths}, coverage.every(v=>v===81) && widths.every(v=>v<=6))
  let changed = 0
  for (let y=806;y<=808;y++) for (let x=808;x<=888;x++) if (rho(pair,x,y)!==1) changed++
  const cleanPixels = Buffer.from(blank).equals(Buffer.from(await pixels(808,806,81,3)))
  check('negative space: 243 original RGBA and rho cells', {changed,cleanPixels}, !changed && cleanPixels)
  await stroke(line)
  const repeat = sha(await field())
  check('exact retrace deposits additional density', {pairHash,repeat}, repeat!==pairHash)
  await click('Шаг назад'); await saved()
  assert.equal(sha(await field()),pairHash); assert.equal(await frame(),pairFrame)
  // Four right-angle turns (including closure); seed five cells inside left edge.
  const square = [[960,900],[1024,900],[1024,964],[960,964],[960,900]]
  await stroke(square)
  const outline = await frame(), contour = sha(await field())
  for (const [x,y] of square.slice(0,4)) {
    const a = await pixels(x-2,y-2,5,5)
    check(`corner ${x},${y}: visible line`, null, a.some((_,i)=>i%4===0 && red(a,i)))
  }
  const before = await pixels(954,894,77,77)
  await label('Режим пигмента').selectOption('fill'); await label('Цвет заливки').fill('#0000ff')
  await move([965,932]); await mouse.down(); await mouse.up()
  const dialog = page.getByRole('dialog'); await dialog.waitFor()
  const info = await dialog.locator('p').innerText()
  check('closed contour recognized',info,!info.includes('Открытый контур'))
  assert.equal(await frame(),outline)
  await click('Применить заливку'); await saved()
  const after = await pixels(954,894,77,77)
  let interior=0, outside=0, overwritten=0
  for (let y=894;y<=970;y++) for (let x=954;x<=1030;x++) {
    const i=4*((y-894)*77+x-954), blue=after[i+2]>2*Math.max(after[i],after[i+1])
    if (blue && x>=965 && x<=1019 && y>=905 && y<=959) interior++
    if (blue && (x<960 || x>1024 || y<900 || y>964)) outside++
    if (red(before,i) && before.slice(i,i+4).some((v,j)=>v!==after[i+j])) overwritten++
  }
  check('fill reaches core, no spill or recolored line', {interior,outside,overwritten}, interior===55**2 && outside===0 && overwritten===0)
  const filled = await frame(); assert.notEqual(filled,outline); assert.equal(sha(await field()),contour)
  await click('Шаг назад'); await saved(); assert.equal(await frame(),outline)
  await click('Шаг вперёд'); await saved(); assert.equal(await frame(),filled)
  await page.reload(); await page.getByText('Локальное поле загружено',{exact:true}).waitFor()
  assert.equal(await frame(),filled); assert.equal(sha(await field()),contour)
  console.log(JSON.stringify({undoRedoAndLocalReopen:true, rgba:filled, tfd:contour}))
  assert.deepEqual(errors,[]); assert.deepEqual(failures,[])
} finally {
  try { await browser?.close() } finally { await server.close() }
}
