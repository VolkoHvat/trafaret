import { FixedEnergyInput, MeasuredEnergyInput, type EnergyImpulse, type EnergyInputSample } from './lib/input-energy.ts'
import { VoidProcess, type PenLaw, type StaticObservation } from './lib/void-field.ts'
import { wyvernSamples, wyvernSvg } from './lib/wyvern-artwork.ts'
import { silentiumSamples, silentiumSvg } from './lib/silentium-artwork.ts'

const BASE_REGION = { minX: 0, minY: 0, columns: 64, rows: 40, step: 1 }
let REGION = { ...BASE_REGION }
const CELL = 10
const standardCanvas = document.querySelector<HTMLCanvasElement>('#standard-canvas')!
const energyCanvas = document.querySelector<HTMLCanvasElement>('#energy-canvas')!
const brushSelect = document.querySelector<HTMLSelectElement>('#brush')!
const gainInput = document.querySelector<HTMLInputElement>('#gain')!
const reportElement = document.querySelector<HTMLPreElement>('#report')!
const text = (selector: string, value: string | number) => {
  document.querySelector(selector)!.textContent = String(value)
}
const rounded = (value: number) => Math.round(value * 1000) / 1000

interface BrushPreset { law: PenLaw; strength: number; energy: number }
function preset(): BrushPreset {
  if (brushSelect.value === 'silentium') {
    const width = 0.16
    return {
      strength: 2 * Math.PI * width * width, energy: 1,
      law: {
        width, diffusion: 0.02, strength: 1, aspect: 1, angle: 0, refill: 0,
        compression: 1, buffer: 1.2, reverseInertia: 0, damping: 0, drift: { x: 0, y: 0 },
      },
    }
  }
  if (brushSelect.value === 'wyvern') {
    const width = 0.16
    return {
      strength: 2 * Math.PI * width * width, energy: 1,
      law: {
        width, diffusion: 0.03, strength: 1, aspect: 1, angle: 0, refill: 0,
        compression: 1, buffer: 1.25, reverseInertia: 0, damping: 0, drift: { x: 0, y: 0 },
      },
    }
  }
  const definitions = {
    fineline: { width: 0.8, diffusion: 1.2, refill: 2, buffer: 1.8, aspect: 1, angle: 0, energy: 1 },
    shader: { width: 1.6, diffusion: 3, refill: 3, buffer: 2, aspect: 1, angle: 0, energy: 1.6 },
    flat: { width: 0.9, diffusion: 1.5, refill: 2.4, buffer: 1.6, aspect: 2.4, angle: Math.PI / 4, energy: 1.3 },
    pulse: { width: 0.45, diffusion: 0.4, refill: 5, buffer: 1.5, aspect: 1, angle: 0, energy: 0.65 },
    recoil: { width: 0.9, diffusion: 1.4, refill: 2.2, buffer: 1.8, aspect: 1, angle: 0, energy: 1.5 },
  }
  const selected = definitions[brushSelect.value as keyof typeof definitions] ?? definitions.fineline
  const strength = 2 * Math.PI * selected.width * selected.width * selected.aspect * selected.energy
  return {
    strength, energy: selected.energy,
    law: {
      width: selected.width, diffusion: selected.diffusion, strength: 1,
      aspect: selected.aspect, angle: selected.angle, refill: selected.refill,
      compression: 1, buffer: selected.buffer,
      reverseInertia: brushSelect.value === 'recoil' ? 8 : 0,
      damping: brushSelect.value === 'recoil' ? 2 : 0,
      drift: brushSelect.value === 'recoil' ? { x: 0.4, y: 0 } : { x: 0, y: 0 },
    },
  }
}

let standard = new VoidProcess()
let dynamic = new VoidProcess()
let fixed = new FixedEnergyInput(1)
let measured = new MeasuredEnergyInput()
let activePointer: number | null = null
let currentTime = 0
let lastPoint = { x: 0, y: 0 }
let totalWork = 0
let lastImpulse: EnergyImpulse = { energy: 0, power: 0, speed: 0, source: 'velocity-only', confidence: 'modelled' }
let strengths: number[] = []
let speeds: number[] = []
let runGain: number | undefined
let pruneEnabled = true
let renderTimer: number | undefined
let dirty = false

function gain() {
  const value = Number(gainInput.value)
  return Number.isFinite(value) ? Math.max(0, Math.min(0.5, value)) : 0.1
}

function renderCanvas(canvas: HTMLCanvasElement, observation: StaticObservation) {
  const ctx = canvas.getContext('2d')!
  let index = 0
  for (let row = 0; row < observation.rows; row++) {
    for (let column = 0; column < observation.columns; column++) {
      const saturation = observation.saturation[index++]
      if (saturation > 1) {
        const compression = Math.min(1, (saturation - 1) * 4)
        ctx.fillStyle = `rgb(${Math.round(180 + 75 * compression)},${Math.round(30 + 40 * compression)},24)`
      } else {
        const value = Math.round(232 - saturation * 211)
        ctx.fillStyle = `rgb(${value},${Math.max(0, value - 4)},${Math.max(0, value - 2)})`
      }
      ctx.fillRect(column * CELL, row * CELL, CELL, CELL)
    }
  }
}

function updateMetrics() {
  const current = preset()
  text('#standard-sources', standard.sourceCount)
  text('#energy-sources', dynamic.sourceCount)
  text('#standard-strength', rounded(current.strength))
  text('#energy-work', rounded(totalWork))
  text('#energy-power', rounded(lastImpulse.power))
  text('#energy-speed', rounded(lastImpulse.speed))
  text('#energy-strength', strengths.length ? `${rounded(Math.min(...strengths))}–${rounded(Math.max(...strengths))}` : '—')
  text('#energy-source', `${lastImpulse.source} / ${lastImpulse.confidence}`)
}

function render() {
  renderTimer = undefined
  if (!dirty) return
  dirty = false
  renderCanvas(standardCanvas, standard.observe(REGION, currentTime))
  renderCanvas(energyCanvas, dynamic.observe(REGION, currentTime))
  for (const canvas of [standardCanvas, energyCanvas]) {
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ef4b3e'
    ctx.beginPath()
    ctx.arc(lastPoint.x * CELL, lastPoint.y * CELL, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  updateMetrics()
}

function scheduleRender() {
  dirty = true
  if (renderTimer === undefined) renderTimer = window.setTimeout(render, 120)
}

function applySample(sample: EnergyInputSample, deferRender = true) {
  const current = preset()
  fixed.next()
  const impulse = measured.next(sample)
  const strength = current.strength * (1 + (runGain ?? gain()) * impulse.energy)
  const pressure = sample.pressure ?? 1
  standard.append({ point: { x: sample.x, y: sample.y }, time: sample.time, pressure, law: { ...current.law, strength: current.strength } })
  dynamic.append({ point: { x: sample.x, y: sample.y }, time: sample.time, pressure, law: { ...current.law, strength } })
  if (pruneEnabled && standard.sourceCount > 80) standard.prune(sample.time)
  if (pruneEnabled && dynamic.sourceCount > 80) dynamic.prune(sample.time)
  currentTime = sample.time
  lastPoint = { x: sample.x, y: sample.y }
  totalWork += impulse.energy
  lastImpulse = impulse
  strengths.push(strength)
  speeds.push(impulse.speed)
  if (deferRender) scheduleRender()
}

function reset() {
  if (renderTimer !== undefined) window.clearTimeout(renderTimer)
  renderTimer = undefined
  standard = new VoidProcess()
  dynamic = new VoidProcess()
  fixed = new FixedEnergyInput(1)
  measured = new MeasuredEnergyInput()
  activePointer = null
  currentTime = 0
  lastPoint = { x: 0, y: 0 }
  totalWork = 0
  lastImpulse = { energy: 0, power: 0, speed: 0, source: 'velocity-only', confidence: 'modelled' }
  strengths = []
  speeds = []
  runGain = undefined
  pruneEnabled = true
  dirty = true
  document.body.dataset.complete = 'false'
  reportElement.textContent = 'Выполните эмуляцию или нарисуйте линию на любом полотне.'
  render()
}

function runSamples(samples: EnergyInputSample[], meta: Record<string, string | number>, gainOverride?: number,
  viewport = BASE_REGION, prune = true) {
  REGION = { ...viewport }
  for (const canvas of [standardCanvas, energyCanvas]) {
    canvas.width = REGION.columns * CELL
    canvas.height = REGION.rows * CELL
  }
  reset()
  pruneEnabled = prune
  runGain = gainOverride
  samples.forEach(sample => applySample(sample, false))
  dirty = true
  render()
  const report = {
    ...meta,
    standard: { sourceCount: standard.sourceCount, fixedStrength: preset().strength, energyConstant: preset().energy },
    energy: {
      sourceCount: dynamic.sourceCount,
      totalWork: rounded(totalWork),
      lastPower: rounded(lastImpulse.power),
      lastSpeed: rounded(lastImpulse.speed),
      minSpeed: rounded(Math.min(...speeds)),
      maxSpeed: rounded(Math.max(...speeds)),
      minStrength: rounded(Math.min(...strengths)),
      maxStrength: rounded(Math.max(...strengths)),
      source: lastImpulse.source,
      confidence: lastImpulse.confidence,
    },
    different: Math.min(...strengths) !== Math.max(...strengths) && totalWork > 0,
    gain: runGain ?? gain(),
  }
  reportElement.textContent = JSON.stringify(report, null, 2)
  document.body.dataset.complete = 'true'
}

function baselineSamples() {
  return Array.from({ length: 64 }, (_, index) => ({
    x: 2 + index * 0.9,
    y: 20 + Math.sin(index / 6) * 10,
    time: index / 30,
    pressure: 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(index / 8)),
    pointerType: 'pen' as const,
  }))
}

function dynamicSamples() {
  const samples: EnergyInputSample[] = []
  let time = 0
  for (let index = 0; index < 100; index++) {
    const duration = index < 20 ? 0.05 : index < 40 ? 0.004 : index < 45 ? 0.2 : index < 50 ? 0.004 : index < 90 ? 0.006 : 0.004
    let x: number, y: number
    if (index < 20) {
      x = 2 + index * 0.4
      y = 20 + Math.sin(index / 4) * 2
    } else if (index < 40) {
      const part = index - 20
      x = 10 + part * 1.4
      y = 18 + Math.sin(part) * 5
    } else if (index < 45) {
      const part = index - 40
      x = 55 - part * 4
      y = 18 + part * 2
    } else if (index < 50) {
      x = index % 2 ? 58 : 6
      y = index % 2 ? 34 : 6
    } else if (index < 90) {
      const angle = (index - 50) / 40 * Math.PI * 2
      x = 32 + Math.cos(angle) * 18
      y = 20 + Math.sin(angle) * 12
    } else {
      const part = index - 90
      x = 6 + part * 5
      y = 20 + Math.sin(part) * 12
    }
    samples.push({ x, y, time, pressure: 0.2 + 0.8 * Math.abs(Math.sin(index / 4)), pointerType: 'pen' })
    time += duration
  }
  return samples
}

function shapeSamples(kind: string) {
  const samples: EnergyInputSample[] = []
  const add = (x: number, y: number, time: number) => samples.push({ x, y, time, pressure: 0.55, pointerType: 'pen' })
  if (kind === 'line') {
    for (let index = 0; index <= 48; index++) add(8 + index, 32 - index * 0.45, index / 40)
  } else if (kind === 'rectangle') {
    const corners = [[12, 10], [52, 10], [52, 30], [12, 30], [12, 10]]
    for (let side = 0; side < 4; side++) {
      const [ax, ay] = corners[side], [bx, by] = corners[side + 1]
      for (let index = 0; index < 16; index++) {
        const ratio = index / 16
        add(ax + (bx - ax) * ratio, ay + (by - ay) * ratio, (side * 16 + index) / 40)
      }
    }
    add(12, 10, 64 / 40)
  } else {
    const radiusX = kind === 'ellipse' ? 16 : 12
    const radiusY = kind === 'ellipse' ? 8 : 12
    for (let index = 0; index <= 72; index++) {
      const angle = index / 72 * Math.PI * 2
      add(32 + Math.cos(angle) * radiusX, 20 + Math.sin(angle) * radiusY, index / 40)
    }
  }
  return samples
}

function pointFrom(event: PointerEvent, canvas: HTMLCanvasElement): EnergyInputSample {
  const bounds = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) / bounds.width * REGION.columns,
    y: (event.clientY - bounds.top) / bounds.height * REGION.rows,
    time: event.timeStamp / 1000,
    pressure: event.pointerType === 'pen' ? event.pressure || 0.5 : undefined,
    pointerType: event.pointerType === 'pen' ? 'pen' : event.pointerType === 'touch' ? 'touch' : 'mouse',
  }
}

for (const canvas of [standardCanvas, energyCanvas]) {
  canvas.addEventListener('pointerdown', event => {
    event.preventDefault()
    if (activePointer !== null) return
    activePointer = event.pointerId
    canvas.setPointerCapture(event.pointerId)
    measured.reset()
    applySample(pointFrom(event, canvas))
  })
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer) return
    event.preventDefault()
    const samples = event.getCoalescedEvents?.() ?? [event]
    for (const sample of samples) applySample(pointFrom(sample, canvas))
  })
  canvas.addEventListener('pointerup', event => {
    if (event.pointerId !== activePointer) return
    applySample(pointFrom(event, canvas))
    activePointer = null
    dirty = true
    render()
  })
  canvas.addEventListener('pointercancel', event => {
    if (event.pointerId !== activePointer) return
    activePointer = null
    measured.reset()
    dirty = true
    render()
  })
}

document.querySelector('#emulate')!.addEventListener('click', () => runSamples(baselineSamples(), { pattern: 'baseline' }))
document.querySelector('#emulate-dynamic')!.addEventListener('click', () => runSamples(dynamicSamples(), { pattern: 'dynamic' }, 1))
document.querySelector('#emulate-artwork')!.addEventListener('click', () => {
  runSamples(wyvernSamples(), { pattern: 'wyvern' }, 0.1, { ...BASE_REGION, columns: 96, rows: 60 }, false)
})
document.querySelector('#emit-shape')!.addEventListener('click', () => {
  const shape = document.querySelector<HTMLSelectElement>('#shape')!.value
  runSamples(shapeSamples(shape), { shape })
})
document.querySelector('#emulate-silentium')!.addEventListener('click', () => {
  runSamples(silentiumSamples(), { pattern: 'silentium' }, 0.1, { ...BASE_REGION, columns: 160, rows: 60 }, false)
})
function downloadSvg(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}
document.querySelector('#download-wyvern')!.addEventListener('click', () => downloadSvg(wyvernSvg(), 'wyvern-back.svg'))
document.querySelector('#download-silentium')!.addEventListener('click', () => downloadSvg(silentiumSvg(), 'silentium.svg'))
document.querySelector('#clear')!.addEventListener('click', reset)
brushSelect.addEventListener('change', reset)
reset()
