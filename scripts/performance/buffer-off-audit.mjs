import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runnerImport } from 'vite'

const lib = async name => (await runnerImport(resolve(`src/lib/${name}.ts`), { configFile: false })).module
const { LARGE } = await lib('field-size')
const { Transfer, PathInput, freshField, project } = await lib('density-transfer')
const { fineBrush } = await lib('fine-line')
const { sections, makeSection, tattooUV } = await lib('local-surface')
const widthMm = 100, pitch = widthMm / LARGE.width, mid = LARGE.width / 2
const arm = makeSection('forearm', sections.forearm.mm)

function section(classify, lo, hi) {
  const runs = []
  for (let i = lo; i <= hi; i++) {
    if (!classify(i)) continue
    if (runs.at(-1)?.end === i - 1) runs.at(-1).end = i
    else runs.push({ start: i, end: i })
  }
  assert.equal(runs.length, 2, 'expected two separated bands')
  return { widths: runs.map(r => r.end - r.start + 1), gap: runs[1].start - runs[0].end - 1 }
}

function draw(field, kernel) {
  for (const y of [mid - 10, mid + 10]) {
    new PathInput(field, kernel, { x: mid - 80, y }).move({ x: mid + 80, y })
  }
}

function rhoStats(before, after) {
  let donorLoss = 0, receiverGain = 0, changedCells = 0, maxDelta = 0
  for (let i = 0; i < after.length; i++) {
    const delta = after[i] - before[i]
    maxDelta = Math.max(maxDelta, Math.abs(delta))
    changedCells += Number(delta !== 0)
    donorLoss += Math.max(0, -delta)
    receiverGain += Math.max(0, delta)
  }
  return { donorLoss, receiverGain, changedCells, maxDelta }
}

const measurements = [0.15, 0.25, 0.5].map(targetMm => {
  const brush = fineBrush(targetMm, pitch, 'off')
  const fullBrush = { ...brush, bufferMode: 'full' }
  const offBrush = { ...brush, bufferMode: 'off' }
  const seeded = freshField(LARGE)
  draw(seeded, new Transfer({ ...fullBrush, radius: Math.max(1, brush.radius - 1) }))
  const beforeOff = seeded.slice(), core = new Set(), off = new Transfer(offBrush)
  off.markCore = index => core.add(index)
  draw(seeded, off)
  const offRho = rhoStats(beforeOff, seeded)
  assert.equal(offRho.maxDelta, 0, 'buffer off changed existing rho')
  assert.equal(offRho.changedCells, 0, 'buffer off changed rho cells')
  assert.equal(offRho.donorLoss, 0, 'buffer off removed mass')
  assert.equal(offRho.receiverGain, 0, 'buffer off added mass')
  assert.ok(core.size > 0, 'buffer off did not mark pigment core')

  const full = freshField(LARGE), fullBefore = full.slice(), fullCore = new Set(), fullKernel = new Transfer(fullBrush)
  fullKernel.markCore = index => fullCore.add(index)
  draw(full, fullKernel)
  const fullRho = rhoStats(fullBefore, full)
  assert.ok(fullRho.donorLoss > 0 && fullRho.receiverGain > 0)
  assert.ok(Math.abs(fullRho.donorLoss - fullRho.receiverGain) < 1e-9)

  const at = y => full[y * LARGE.width + mid]
  const line = section(y => at(y) < 1, mid - 25, mid + 25)
  const fullSection = section(y => at(y) !== 1, mid - 25, mid + 25)
  const offLine = section(y => core.has(y * LARGE.width + mid), mid - 25, mid + 25)
  assert.ok(offLine.widths.every((width, i) => width >= line.widths[i]))
  assert.ok(fullSection.gap < line.gap)
  const offStencilCells = [...core].filter(index => project(beforeOff[index], 'stencil') !== project(seeded[index], 'stencil')).length
  assert.equal(offStencilCells, 0)

  const views = [0, 45].map(degrees => {
    const yaw = degrees * Math.PI / 180
    const rMid = (sections.forearm.mm[0] + sections.forearm.mm[1]) / (4 * Math.PI)
    const hitIndex = tick => {
      const hit = arm.sample(-rMid * Math.sin(yaw), arm.height / 2 + tick * pitch, yaw)
      assert.ok(hit)
      const { u, v } = tattooUV(hit.x, hit.y, 0, 0, 1, 0, widthMm)
      return Math.floor(v * LARGE.height) * LARGE.width + Math.floor(u * LARGE.width)
    }
    const ink = section(t => core.has(hitIndex(t)), -25, 25)
    const support = section(t => full[hitIndex(t)] !== 1, -25, 25)
    assert.ok(support.gap > 0 && support.gap < ink.gap)
    return { degrees, offLineGapSamples: ink.gap, fullGapSamples: support.gap }
  })
  return {
    targetMm, brush: offBrush, line: offLine, full: fullSection,
    measuredLineMm: offLine.widths.map(n => n * pitch),
    off: { oldRho: offRho, pigmentCoreCells: core.size, stencilCells: offStencilCells },
    full: { rho: fullRho, stencilCells: [...fullCore].filter(index => project(full[index], 'stencil') !== blankStencil).length },
    views,
  }
})

console.log(JSON.stringify({ node: process.version, field: LARGE, widthMm, pitch, measurements,
  bufferMode: { off: 'PASS', full: 'PASS' },
  claims: {
    offDoesNotChangeRho: 'PASS', offTransfersMass: 'NOT_CLAIMED',
    offWritesPigmentCore: 'PASS', offAppearsInStencil: 'NOT_CLAIMED',
    fullTransfersMass: 'PASS', physicalWidth: 'NOT_TESTED', artistAcceptance: 'NOT_TESTED',
  },
}, null, 2))
