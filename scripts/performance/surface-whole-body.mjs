import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { preview, runnerImport } from 'vite'
import { assertIsolated, centerOfPart, digest, downloadField, surfaceControls } from './surface-body-field.mjs'

const contract = async file => (await runnerImport(resolve(`src/lib/${file}.ts`), { configFile: false })).module
const { scene, front, defaults, parts, flatHit, atlasSize } = await contract('surface-model')
const { decodeField } = await contract('field-document')
const server = await preview({ build: { outDir: process.argv[2] || 'dist' }, preview: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() })
  const page = await browser.newPage({ viewport: { width: 1150, height: 940 }, serviceWorkers: 'block' })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const button = name => page.getByRole('button', { name, exact: typeof name === 'string' })
  const snapshot = () => downloadField(page, button('Скачать поле .tfd'), decodeField)
  const projectHash = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), button('Сохранить проект .tfs').click()])
    assert.match(file.suggestedFilename(), /\.tfs$/i)
    return digest(await readFile(await file.path()))
  }
  const { model, atlas, show, drag } = surfaceControls(page)
  const pixels = canvas => canvas.evaluate(c => c.toDataURL()).then(digest)
  const undo = button('Отменить'), redo = button('Повторить')
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  await page.getByRole('link', { name: 'Открыть режим рисования на 3D-модели' }).click()
  await model.waitFor()
  const focus = page.getByRole('combobox', { name: 'Область фокуса 3D' })
  assert.equal(await focus.inputValue(), '', 'Surface workspace must open on the whole figure')
  const blank = await snapshot()
  const [w,h] = await model.evaluate(c => [c.width,c.height])
  const probe = scene(w,h,defaults,front)
  const center = part => centerOfPart(probe,parts,part)
  const owner = (x,y) => flatHit(x,y,defaults)?.part
  let previous = blank, penultimate
  assert.equal(new Set(parts).size, 16)
  // Do not select a part, focus it, or switch tools before these real pointer strokes.
  for (const part of parts) {
    const start = center(part)
    await drag(model, start, [start[0]+2/w,start[1]])
    const next = await snapshot()
    assertIsolated(previous, next, part, owner)
    penultimate = previous
    previous = next
  }
  await undo.click()
  assert.equal((await snapshot()).hash, penultimate.hash)
  const navigation = async action => {
    const before = await pixels(model)
    await action()
    assert.notEqual(await pixels(model), before, 'Navigation did not change the visible model')
    assert.equal((await snapshot()).hash, penultimate.hash, 'Navigation wrote density')
    assert.equal(await redo.isEnabled(), true, 'Navigation destroyed redo branch')
  }
  for (const tool of ['Орбита', 'Панорама']) {
    await button(tool).click()
    await navigation(() => drag(model, [.48,.45], [.57,.49]))
  }
  await navigation(() => page.getByRole('slider', { name: /зум|масштаб/i }).press('End'))
  await button('Вся фигура').click()
  await button('Кисть').click()
  await show(atlas)
  await button('Панорама').click()
  const rect = () => atlas.evaluate(c => { const b=c.getBoundingClientRect(), p=c.parentElement.getBoundingClientRect(); return {x:b.x-p.x,y:b.y-p.y,w:b.width} })
  const fitted = await rect()
  await drag(atlas,[.5,.5],[.56,.54])
  const panned = await rect()
  assert.ok(panned.x > fitted.x && panned.y > fitted.y, '2D pan did not translate the atlas')
  await page.getByRole('slider', { name: /Зум/ }).press('End')
  assert.ok((await rect()).w > panned.w, '2D zoom did not enlarge the atlas')
  await button('Вся фигура').click()
  await button('Кисть').click()
  assert.equal((await snapshot()).hash, penultimate.hash, '2D navigation wrote density')
  await redo.click()
  assert.equal((await snapshot()).hash, previous.hash, 'Redo from 2D did not restore 3D stroke')
  await show(model)
  await undo.click()
  assert.equal((await snapshot()).hash, penultimate.hash, 'Navigation or view switch added an undo entry')

  const mid = center('torso'), hit = probe.hit(mid[0]*w,mid[1]*h)
  const xy = (x,y) => [(x+.5)/atlasSize.width,(y+.5)/atlasSize.height]
  const ax = Math.round(hit.x), ay = Math.round(hit.y)
  const beforeProject = await projectHash()
  const before3D = await pixels(model)
  await show(atlas)
  // Compare actual atlas texels before/after, independently of the runtime zone predicate.
  const rgba = () => atlas.evaluate(c => Array.from(new Uint32Array(c.getContext('2d').getImageData(0,0,c.width,c.height).data.buffer)))
  const before2D = await rgba()
  await show(model)
  const radius = page.getByRole('slider', { name: /Радиус кисти/ })
  await radius.press('End')
  await button('Зона').click()
  await drag(model, mid, [mid[0]+2/w,mid[1]])
  await button('Кисть').click()
  assert.notEqual(await pixels(model), before3D, 'Zone must be visible in draw mode on the model')
  await show(atlas)
  const after2D = await rgba()
  assert.equal(after2D.length, blank.field.length)
  const mask = after2D.map((v,i) => v !== before2D[i])
  const allowed = (x,y) => mask[y*atlasSize.width+x]
  assert.ok(allowed(ax,ay), 'Zone must be visible at the same atlas cell in 2D')
  assert.ok(!allowed(ax,ay+30), 'Zone must end before the 2D drag ends')
  assert.equal(await projectHash(), beforeProject, 'Zone overlay leaked into .tfs')
  assert.equal((await snapshot()).hash, penultimate.hash, 'Zone overlay leaked into .tfd')
  assert.equal(await redo.isEnabled(), true, 'Zone creation mutated density history')
  const checkClipped = async (canvas, a, b) => {
    await drag(canvas,a,b)
    const ink = await snapshot()
    assertIsolated(penultimate, ink, true, allowed)
    await show(canvas === model ? atlas : model)
    await undo.click()
    assert.equal((await snapshot()).hash, penultimate.hash, 'Undo in the other view must restore exact density')
    await redo.click()
    assert.equal((await snapshot()).hash, ink.hash)
    await undo.click()
  }
  // Cross the mask edge from inside with a broad brush in each projection.
  await page.getByRole('slider', { name: /Радиус кисти/ }).press('End')
  await checkClipped(atlas, xy(ax,ay), xy(ax,ay+30))
  const outside = center('head')
  await drag(model, outside, [outside[0]+3/w,outside[1]])
  assert.equal((await snapshot()).hash, penultimate.hash, 'Out-of-zone 3D gesture wrote density')
  assert.equal(await redo.isEnabled(), true, 'Rejected 3D gesture created an undo entry')
  await checkClipped(model, mid, [mid[0],mid[1]+.12])
  const head = probe.hit(outside[0]*w,outside[1]*h)
  await drag(atlas, xy(head.x,head.y),xy(head.x+2,head.y))
  assert.equal((await snapshot()).hash, penultimate.hash, 'Out-of-zone 2D gesture wrote density')
  assert.equal(await redo.isEnabled(), true, 'Rejected 2D gesture created an undo entry')
  assert.deepEqual(errors, [])
  console.log('PASS whole body: 16 parts without selecting, pan/orbit/zoom, visible shared zone, clipped density and cross-view history')
} finally {
  try { await browser?.close() } finally { await new Promise(resolve => server.httpServer.close(resolve)) }
}
