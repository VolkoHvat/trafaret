import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { preview, runnerImport } from 'vite'
import { assertIsolated, digest, downloadField, surfaceControls } from './surface-body-field.mjs'

// The app is served only from the integrator's production outDir. The source
// contract on the Node side is the oracle, not an alternate app under test.
const contract = async file => (await runnerImport(resolve(`src/lib/${file}.ts`), { configFile: false })).module
const { parts, names, defaults, measurementsDefs, flatHit, fromUV } = await contract('surface-model')
const { decodeField } = await contract('field-document')
const findPart = (...terms) => {
  const part = parts.find(p => terms.every(term => term.test(names[p])))
  assert.ok(part, `Missing body part: ${terms.join(' + ')} (${parts.map(p => names[p]).join(', ')})`)
  return part
}
const left = findPart(/лев/i, /предплеч/i), right = findPart(/прав/i, /предплеч/i)
const head = findPart(/голов/i), torso = findPart(/торс|грудн.*клет/i)
const server = await preview({ build: { outDir: process.argv[2] || 'dist' }, preview: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() })
  const page = await browser.newPage({ viewport: { width: 1150, height: 940 }, serviceWorkers: 'block' })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const button = name => page.getByRole('button', { name, exact: true })
  const field = name => downloadField(page, button(name), decodeField)
  const snapshot = () => field('Скачать поле .tfd')
  const pixels = canvas => canvas.evaluate(c => c.toDataURL()).then(digest)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.getByRole('button', {name:'Импорт поля',exact:true}).waitFor()
  const original = await field('Экспорт поля')
  await page.getByRole('link', { name: 'Открыть режим рисования на 3D-модели' }).click()
  const { model, atlas, show, drag } = surfaceControls(page)
  assert.equal(new Set(parts).size, 16)
  assert.equal(new Set(measurementsDefs.map(d => d.key)).size, 20)
  const area = page.getByRole('combobox', { name: /область/i })
  await area.waitFor()
  for (const part of parts) assert.equal(await area.getByRole('option', { name: names[part], exact: true }).count(), 1, `Missing ${names[part]}: check the production outDir`)

  const body = { ...defaults }
  const initial = await pixels(model)
  for (const { key, label, step, max } of measurementsDefs) {
    const control = page.getByRole('spinbutton', { name: label, exact: true })
    assert.equal(Number(await control.inputValue()), defaults[key], label)
    body[key] = defaults[key] + (defaults[key] + 2 * step <= max ? 2 : -2) * step
    await control.fill(String(body[key]))
    await control.press('Tab')
    assert.equal(Number(await control.inputValue()), body[key], label)
  }
  assert.notEqual(await pixels(model), initial, 'Custom measurements must change the silhouette')

  const focus = async part => {
    await button('Вся фигура').click()
    const before = await pixels(model)
    await area.selectOption({ label: names[part] })
    await button('Приблизить область').click()
    assert.notEqual(await pixels(model), before, `Focus ${names[part]}`)
  }
  const owner = (x,y) => flatHit(x,y,body)?.part
  let previous = await snapshot()
  const blank = previous
  const stroke = async (part, canvas, start, end) => {
    await show(atlas)
    const flatBefore = await pixels(atlas)
    await show(model)
    const viewBefore = await pixels(model)
    if (canvas === atlas) await show(atlas)
    await drag(canvas, start, end)
    await show(atlas)
    assert.notEqual(await pixels(atlas), flatBefore, 'Atlas must show the stroke')
    await show(model)
    assert.equal(await area.inputValue(), part, `Missed ${names[part]}`)
    assert.notEqual(await pixels(model), viewBefore, 'Model must show the stroke')
    const next = await snapshot()
    assertIsolated(previous, next, part, owner)
    previous = next
  }
  for (const part of [left, right, head]) {
    await focus(part)
    await stroke(part, model, [.5,.49], [.515,.505])
  }
  const limbsAndHead = previous
  await focus(torso)
  const frontInk = await pixels(model)
  await button('Разворот 180°').click()
  await stroke(torso, model, [.54,.49], [.565,.505])
  const backInk = previous, backView = await pixels(model)
  await button('Разворот 180°').click()
  assert.equal(await pixels(model), frontInk, 'Rear stroke leaked to the front')
  await button('Отменить').click()
  assert.equal((await snapshot()).hash, limbsAndHead.hash, 'Undo must restore the exact previous field')
  await button('Повторить').click()
  assert.equal((await snapshot()).hash, backInk.hash)
  await button('Разворот 180°').click()
  assert.equal(await pixels(model), backView)
  await button('Орбита').click()
  await drag(model, [.5,.5], [.62,.55])
  assert.notEqual(await pixels(model), backView)
  await focus(head)
  assert.equal((await snapshot()).hash, backInk.hash, 'Orbit and focus must not alter density')
  await button('Кисть').click()
  await drag(model, [.5,.48], [.53,.51], true)
  assert.equal((await snapshot()).hash, backInk.hash, 'Escape must not commit partial ink')
  const uv = (u,v) => {
    const p = fromUV(head,u,v,body)
    return [p.x/previous.width, p.y/previous.height]
  }
  // A broad brush near the chart boundary must not write even into the gutter.
  await page.getByRole('slider', { name: /Радиус кисти/ }).press('End')
  await stroke(head, atlas, uv(.48,.04), uv(.55,.06))
  await button('Отменить').click()
  assert.equal((await snapshot()).hash, backInk.hash)
  assert.notEqual(backInk.hash, blank.hash)
  // Reopen the client's project after undoing a stroke, not over identical state.
  const [saved] = await Promise.all([page.waitForEvent('download'), button('Сохранить проект .tfs').click()])
  assert.match(saved.suggestedFilename(), /\.tfs$/i)
  await button('Отменить').click()
  assert.equal((await snapshot()).hash, limbsAndHead.hash)
  await page.reload()
  assert.notEqual((await snapshot()).hash, backInk.hash)
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('Открыть проект .tfs').setInputFiles(await saved.path())
  await page.getByRole('status').filter({ hasText: /проект поверхности открыт/i }).waitFor()
  assert.equal((await snapshot()).hash, backInk.hash, 'Reopening the project must restore exact density')
  for (const { key, label } of measurementsDefs) {
    const input = page.getByRole('spinbutton', { name: label, exact: true })
    assert.equal(Number(await input.inputValue()), body[key], label)
    assert.equal(await input.isDisabled(), true, `Inked profile must protect ${label}`)
  }
  previous = backInk
  for (const part of parts.filter(p => ![left,right,head,torso].includes(p))) {
    await focus(part)
    await stroke(part, model, [.5,.5], [.509,.506])
  }
  await page.getByRole('link', { name: 'Вернуться в поле' }).click()
  assert.equal((await field('Экспорт поля')).hash, original.hash, 'Surface mode overwrote the original workspace')
  assert.deepEqual(errors, [])
  console.log('PASS surface body: centimetres, left/right forearms, head, back, atlas isolation, orbit/focus, Escape, Undo/Redo, lossless export and original field')
} finally {
  try { await browser?.close() } finally { await new Promise(resolve => server.httpServer.close(resolve)) }
}
