import { performance } from 'node:perf_hooks'
import { mkdir, writeFile } from 'node:fs/promises'
import { VoidProcess } from '../src/lib/void-field.ts'

const law = {
  width: 2, diffusion: 4, strength: 0.1, aspect: 1, angle: 0, refill: 0,
  drift: { x: 0, y: 0 },
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const mb = bytes => Math.round(bytes / 1024 / 1024 * 100) / 100
const makeProcess = count => {
  const started = performance.now()
  const process = new VoidProcess()
  for (let index = 0; index < count; index++) {
    process.append({
      point: { x: (index % 100) * 0.2, y: Math.sin(index * 0.01) * 10 },
      time: index / Math.max(1, count) * 0.1,
      pressure: 0.5 + index % 50 / 100,
      law,
    })
  }
  return { process, appendMs: performance.now() - started }
}
const results = []
for (const sourceCount of [100, 1000, 5000]) {
  const { process: model, appendMs } = makeProcess(sourceCount)
  for (const size of [[64, 48], [128, 128]]) {
    const [columns, rows] = size
    const region = { minX: -10, minY: -20, columns, rows, step: 1 }
    model.observe(region, 0.2)
    globalThis.gc?.()
    const rssBefore = process.memoryUsage().rss
    const heapBefore = process.memoryUsage().heapUsed
    const times = []
    for (let repeat = 0; repeat < 3; repeat++) {
      const started = performance.now()
      model.observe(region, 0.2)
      times.push(performance.now() - started)
    }
    globalThis.gc?.()
    const memoryAfter = process.memoryUsage()
    results.push({
      sourceCount,
      queryCells: columns * rows,
      appendMs: Math.round(appendMs * 100) / 100,
      medianObservationMs: Math.round(median(times) * 100) / 100,
      minObservationMs: Math.round(Math.min(...times) * 100) / 100,
      maxObservationMs: Math.round(Math.max(...times) * 100) / 100,
      rssTotalMb: mb(memoryAfter.rss),
      heapUsedTotalMb: mb(memoryAfter.heapUsed),
      arrayBuffersTotalMb: mb(memoryAfter.arrayBuffers),
      rssDeltaMb: mb(memoryAfter.rss - rssBefore),
      heapDeltaMb: mb(memoryAfter.heapUsed - heapBefore),
      outputMb: mb(columns * rows * 8),
    })
  }
}
const { process: leakModel } = makeProcess(1000)
const leakRegion = { minX: -10, minY: -20, columns: 64, rows: 48, step: 1 }
const guides = [
  { point: { x: 22, y: 8 }, pressure: 0.8 },
  { point: { x: 24, y: 0 }, pressure: 0.7 },
]
const cycle = () => {
  leakModel.observe(leakRegion, 0.2)
  leakModel.remodel(guides, undefined, 0.02, 0.01).observe(leakRegion, 0.22)
}
for (let index = 0; index < 40; index++) cycle()
globalThis.gc?.()
const memorySnapshot = () => {
  const memory = process.memoryUsage()
  return {
    rssMb: mb(memory.rss), heapUsedMb: mb(memory.heapUsed), heapTotalMb: mb(memory.heapTotal),
    externalMb: mb(memory.external), arrayBuffersMb: mb(memory.arrayBuffers),
  }
}
const baseline = memorySnapshot()
const samples = []
for (let index = 1; index <= 40; index++) {
  cycle()
  if (index % 10 === 0) {
    globalThis.gc?.()
    samples.push({ cycle: index, ...memorySnapshot() })
  }
}
globalThis.gc?.()
const finalMemory = memorySnapshot()
const growth = {
  rssMb: Math.round((finalMemory.rssMb - baseline.rssMb) * 100) / 100,
  heapUsedMb: Math.round((finalMemory.heapUsedMb - baseline.heapUsedMb) * 100) / 100,
  arrayBuffersMb: Math.round((finalMemory.arrayBuffersMb - baseline.arrayBuffersMb) * 100) / 100,
}
const leakCheck = {
  warmupCycles: 40,
  cycles: 40,
  baseline,
  samples,
  final: finalMemory,
  growth,
  sourceCount: leakModel.sourceCount,
  predictedCount: leakModel.predictedCount,
  pass: growth.rssMb <= 16 && growth.heapUsedMb <= 8 && growth.arrayBuffersMb <= 1
    && leakModel.sourceCount === 1000 && leakModel.predictedCount === 0,
}
const report = {
  runtime: process.version,
  platform: process.platform,
  model: 'Gaussian cavity + compact compression buffer + reverse inertia, all sources × all observation cells',
  complexity: { append: 'O(N)', memory: 'O(N + Q)', observation: 'O(N × Q)' },
  results,
  leakCheck,
}
await mkdir('.tools/void-probe', { recursive: true })
await writeFile('.tools/void-probe/void-benchmark.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (!leakCheck.pass) process.exitCode = 1
