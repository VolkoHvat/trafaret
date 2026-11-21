#!/usr/bin/env node
// Deterministic, browser-free probe for incremental stroke append and quality analysis.
// Timing and memory values are diagnostic; structural checks are the pass/fail contract.
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { registerHooks } from 'node:module'

// Node 22.15+: match the project's extensionless relative TS imports, in src/ only.
const src = new URL('../../src/', import.meta.url).href
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(src) && /^\.{1,2}\/[^.]+$/.test(specifier)) {
    return nextResolve(`${specifier}.ts`, context)
  }
  return nextResolve(specifier, context)
} })
const { DEFAULT_BRUSHES } = await import('../../src/lib/brushes.ts')
const { StrokeSession } = await import('../../src/lib/stroke-session.ts')
const { analyzeQuality } = await import('../../src/lib/quality/analyzer.ts')
hook.deregister()

const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const memory = () => {
  const value = process.memoryUsage()
  return {
    rssMb: round(value.rss / 1024 / 1024, 2),
    heapUsedMb: round(value.heapUsed / 1024 / 1024, 2),
    arrayBuffersMb: round(value.arrayBuffers / 1024 / 1024, 2),
  }
}
const collect = () => globalThis.gc?.()

function makeSession() {
  return new StrokeSession({
    pointerId: 1,
    layerId: 'probe-layer',
    channel: 'content',
    point: [10, 40, 0.5],
    pen: true,
    brush: DEFAULT_BRUSHES.fineline,
    color: '#000000',
    eraser: false,
    line: false,
    vector: true,
    symmetry: 'radial',
    radialCount: 4,
    doc: { width: 2048, height: 2048, title: 'Probe', dpi: 300 },
  })
}

function pointAt(index) {
  return [10 + index * 2, 40 + Math.sin(index * 0.07) * 12, 0.35 + (index % 20) / 40]
}

function appendBatch(count) {
  const session = makeSession()
  const sets = session.pointSets()
  const arrays = [...sets]
  const inputs = Array.from({ length: count }, (_, i) => pointAt(i + 1))
  const times = []
  let accepted = 0
  for (let repeat = 0; repeat < 4; repeat++) {
    const target = repeat === 3 ? session : makeSession()
    const started = performance.now()
    accepted = 0
    for (const point of inputs) if (target.addPoint(point)) accepted++
    if (repeat > 0) times.push(performance.now() - started)
  }
  const elapsedMs = median(times)
  // Separately exercise a hot append with an instrumented, non-tail history slot.
  let historyReads = 0
  const prefixes = arrays.map(set => set.slice())
  for (const set of arrays) {
    const point = set[0]
    Object.defineProperty(set, 0, { configurable: true, get() { historyReads++; return point } })
  }
  const extraAccepted = session.addPoint(pointAt(count + 1))
  const afterSets = session.previewPointSets()
  const readsDuringAppendAndPreview = historyReads
  const stableArrays = afterSets === sets && afterSets.length === 4 && arrays.every((set, index) => set === afterSets[index])
  const stablePrefix = arrays.every((set, index) => prefixes[index].every((point, i) => set[i] === point))
  const expectedPointCount = count + 2 // seed, timed samples, extra instrumented append
  const pointCounts = afterSets.map(set => set.length)
  return {
    requestedSamples: count,
    acceptedSamples: accepted,
    elapsedMs: round(elapsedMs),
    microsecondsPerAcceptedSample: round(elapsedMs * 1000 / Math.max(1, accepted), 2),
    createdPointCounts: pointCounts,
    expectedPointCount,
    symmetrySetCount: afterSets.length,
    stableArrays,
    stablePrefix,
    appendHistoryReads: readsDuringAppendAndPreview,
    extraAcceptedSample: extraAccepted,
    incrementalCacheInvariant: stableArrays && stablePrefix && readsDuringAppendAndPreview === 0 && accepted === count
      && extraAccepted && pointCounts.every(value => value === expectedPointCount),
  }
}

function makeQualityPoints(count) {
  return Array.from({ length: count }, (_, index) => ({
    x: 80 + index * 2,
    y: 300 + Math.sin(index * 0.05) * 18,
    pressure: 0.45 + (index % 10) / 25,
    time: index * 8,
  }))
}

function qualitySmoke(count = 256) {
  const points = makeQualityPoints(count)
  const input = {
    points,
    document: { width: 2048, height: 2048 },
    width: points.map(point => 3 + point.pressure),
    samples: { points },
  }
  const firstStarted = performance.now()
  const first = analyzeQuality(input)
  const firstElapsedMs = performance.now() - firstStarted
  const secondStarted = performance.now()
  const second = analyzeQuality(input)
  const secondElapsedMs = performance.now() - secondStarted
  const deterministic = JSON.stringify(first) === JSON.stringify(second)
  const finite = Number.isFinite(first.score)
    && Number.isFinite(first.metrics.motion.score)
    && first.analyzedPoints === count
    && first.analyzedSegments === count - 1
  return {
    inputPoints: count,
    firstElapsedMs: round(firstElapsedMs),
    secondElapsedMs: round(secondElapsedMs),
    score: first.score,
    level: first.level,
    analyzedPoints: first.analyzedPoints,
    analyzedSegments: first.analyzedSegments,
    motionAvailable: first.metrics.motion.available,
    deterministic,
    finite,
    pass: deterministic && finite,
  }
}

function memorySmoke() {
  collect()
  const before = memory()
  const sessions = []
  for (let batch = 0; batch < 8; batch++) {
    const session = makeSession()
    for (let index = 1; index <= 512; index++) session.addPoint(pointAt(batch * 512 + index))
    sessions.push(session)
  }
  collect()
  const after = memory()
  const heapDeltaMb = round(after.heapUsedMb - before.heapUsedMb, 2)
  const rssDeltaMb = round(after.rssMb - before.rssMb, 2)
  return {
    before,
    after,
    heapDeltaMb,
    rssDeltaMb,
    retainedSessionCount: sessions.length,
    gcExposed: typeof globalThis.gc === 'function',
    pass: Number.isFinite(heapDeltaMb) && Number.isFinite(rssDeltaMb) && heapDeltaMb < 64 && rssDeltaMb < 128,
  }
}

const started = performance.now()
const appendResults = [256, 1024, 4096].map(appendBatch)
const quality = qualitySmoke()
const memoryCheck = memorySmoke()
const report = {
  runtime: process.version,
  platform: process.platform,
  deterministicInputs: true,
  browserRequired: false,
  complexityContract: {
    strokeAppend: 'incremental cached point-set append; no full point-set reconstruction',
    qualityAnalyzer: 'pure in-memory analyzer; intersections remain O(N^2) by design',
  },
  appendResults,
  quality,
  memory: memoryCheck,
  durationMs: round(performance.now() - started),
}
report.summary = {
  appendInvariantPass: appendResults.every(result => result.incrementalCacheInvariant),
  qualitySmokePass: quality.pass,
  memorySmokePass: memoryCheck.pass,
  pass: appendResults.every(result => result.incrementalCacheInvariant) && quality.pass && memoryCheck.pass,
  note: 'Timing and memory measurements are informational and should be compared across runs on the same machine.',
}
console.log(JSON.stringify(report, null, 2))
if (!report.summary.pass) process.exitCode = 1
