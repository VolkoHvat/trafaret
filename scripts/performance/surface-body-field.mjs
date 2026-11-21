import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export const digest = data => createHash('sha256').update(data).digest('hex')
export async function downloadField(page, button, decodeField) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  assert.match(download.suggestedFilename(), /\.tfd$/i)
  const bytes = await readFile(await download.path())
  const field = decodeField(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  return { field, width: bytes.readUInt32LE(12), height: bytes.readUInt32LE(16), hash: digest(bytes) }
}

export function surfaceControls(page) {
  const model = page.getByLabel('3D-модель тела', { exact: true })
  const atlas = page.getByLabel('Развёртка поля', { exact: true })
  const show = async canvas => {
    const is3D = canvas === model
    await page.getByRole('button', { name: is3D ? '3D фигура' : '2D развёртка', exact: true }).click()
    await canvas.waitFor({ state: 'visible' })
    await (is3D ? atlas : model).waitFor({ state: 'hidden' })
  }
  const drag = async (canvas, start, end, cancel = false) => {
    await canvas.scrollIntoViewIfNeeded()
    const b = await canvas.boundingBox()
    const move = (p, steps) => page.mouse.move(b.x + b.width * p[0], b.y + b.height * p[1], { steps })
    await move(start, 1)
    await page.mouse.down()
    try {
      await move(end, 6)
      if (cancel) await page.keyboard.press('Escape')
    } finally { await page.mouse.up() }
  }
  return { model, atlas, show, drag }
}

export function centerOfPart(probe, parts, part) {
  let best = Infinity, index = -1
  for (let i = 0; i < probe.ids.length; i++) {
    if (parts[probe.ids[i]] !== part) continue
    const d = (probe.uv[2*i]-.5)**2 + (probe.uv[2*i+1]-.5)**2
    if (d < best) { best = d; index = i }
  }
  assert.ok(index >= 0, `No visible pixels for ${part}`)
  return [(index%probe.w+.5)/probe.w, (Math.floor(index/probe.w)+.5)/probe.h]
}

export function assertIsolated(before, after, part, ownerAt) {
  assert.equal(after.width, before.width)
  assert.equal(after.height, before.height)
  let changed = 0
  for (let i = 0; i < after.field.length; i++) {
    if (after.field[i] === before.field[i]) continue
    const x = i % after.width, y = Math.floor(i / after.width)
    assert.equal(ownerAt(x, y), part, `Stroke on ${part}: unexpected density change at ${x},${y}`)
    changed++
  }
  assert.ok(changed > 0, `Stroke on ${part} did not change exported density`)
}
