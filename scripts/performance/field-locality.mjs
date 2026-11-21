import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ configFile: false, envFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
try {
  const { Transfer, PathInput, freshField } = await vite.ssrLoadModule('/src/lib/density-transfer.ts')
  const { PigmentField, PIGMENT_TILE: tile } = await vite.ssrLoadModule('/src/lib/pigment.ts')
  const color = { r: 190, g: 10, b: 30, opacity: 255 }
  const brush = { radius: 8, buffer: 6 }
  const start = { x: 60, y: 64 }, end = { x: 69, y: 64 }
  const rect = { left: 46, right: 83, top: 50, bottom: 78 }
  const inside = (x, y) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  function* line(width, left, right, y) {
    for (let x = left; x <= right; x++) yield y * width + x
  }

  function run(width, height, long) {
    const rho = freshField({ width, height }), pigment = new PigmentField(width, height)
    let previousStamps = 0
    if (long) {
      const kernel = new Transfer(brush)
      for (let y = 112; y <= 224; y += 16) {
        previousStamps += 1 + new PathInput(rho, kernel, { x: 16, y }).move({ x: 352, y }).count
        pigment.paint('line', line(width, 16, 352, y), color)
      }
    }
    const baseline = rho.slice(), previous = pigment.snapshot()
    const work = { stamps: 0, reads: 0, writes: 0, cells: 0, indices: 0, tileGets: 0, tileSets: 0, deltaTiles: 0 }
    const touched = new Set()
    function access(key) {
      const i = Number(key)
      assert.ok(Number.isSafeInteger(i) && i >= 0 && i < rho.length && inside(i % width, Math.floor(i / width)), `rho access ${String(key)}`)
      touched.add(i)
    }
    const watched = new Proxy(rho, {
      get(target, key) { if (key !== 'length') { access(key); work.reads++ } return target[key] },
      set(target, key, value) { access(key); work.writes++; target[key] = value; return true },
    })
    const transfer = new Transfer(brush, bounds => {
      assert.ok(inside(bounds.left, bounds.top) && inside(bounds.right, bounds.bottom)); work.stamps++
    })
    const move = new PathInput(watched, transfer, start).move(end)
    assert.equal(move.count, 3)
    work.cells = touched.size

    // Guard the real backing maps during paint only: no remote tile access or enumeration.
    const stride = Math.ceil(width / tile), tileId = x => Math.floor(start.y / tile) * stride + Math.floor(x / tile)
    const allowed = new Set([tileId(start.x), tileId(end.x)])
    const originals = { ...pigment.layers }
    for (const channel of ['line', 'fill']) pigment.layers[channel] = new Proxy(originals[channel], {
      get(map, key) {
        assert.ok(channel === 'line' && (key === 'get' || key === 'set'), `unexpected ${channel} map access: ${String(key)}`)
        return (id, ...args) => {
          assert.ok(allowed.has(id)); if (key === 'get') work.tileGets++; else work.tileSets++
          return map[key](id, ...args)
        }
      },
    })
    let delta
    try {
      delta = pigment.paint('line', (function* () {
        for (const i of line(width, start.x, end.x, start.y)) { work.indices++; yield i }
      })(), color)
    } finally { Object.assign(pigment.layers, originals) }
    work.deltaTiles = delta.tiles.length
    assert.deepEqual(new Set(delta.tiles.map(t => t.id)), allowed)
    assert.equal(work.stamps, 4); assert.equal(work.indices, 10); assert.equal(work.deltaTiles, 2)
    assert.ok(work.reads > 0 && work.reads <= 4 * 2 * 29 ** 2)
    assert.ok(work.writes > 0 && work.writes <= 4 * 29 ** 2)
    assert.ok(work.tileGets <= work.indices + work.deltaTiles && work.tileSets === 2)

    // Offline oracle. Neither the full baseline nor snapshots are traversed by the hot calls.
    let changed = 0
    for (let i = 0; i < rho.length; i++) if (rho[i] !== baseline[i]) {
      assert.ok(inside(i % width, Math.floor(i / width))); changed++
    }
    assert.ok(changed > 0)
    const after = pigment.snapshot()
    const local = t => t.channel === 'line' && allowed.has(t.id)
    assert.deepEqual(after.tiles.filter(t => !local(t)), previous.tiles)
    for (const t of after.tiles.filter(local)) for (let j = 0; j < tile ** 2; j++) {
      const x = (t.id % stride) * tile + j % tile, y = Math.floor(t.id / stride) * tile + Math.floor(j / tile)
      const painted = y === start.y && x >= start.x && x <= end.x
      assert.equal(t.pixels[j], painted ? 0xffbe0a1e : 0)
    }
    assert.equal(after.tiles.filter(local).length, allowed.size)
    console.log(JSON.stringify({ width, height, previousStamps, previousTiles: previous.tiles.length, rect, ...work, changed }))
    return { ...work, changed }
  }
  const reference = run(384, 240, false)
  for (const args of [[384, 240, true], [2048, 2048, false], [2048, 2048, true]]) assert.deepEqual(run(...args), reference)
  console.log('PASS core locality: round transfer and line paint; not fill, UI, timing or whole-gesture integration')
} finally { await vite.close() }
