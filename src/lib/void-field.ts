export interface FieldPoint { x: number; y: number }

export interface PenLaw {
  width: number
  diffusion: number
  strength: number
  aspect: number
  angle: number
  drift: FieldPoint
  refill?: number
  compression?: number
  buffer?: number
  reverseInertia?: number
  damping?: number
}

export interface VoidSource {
  point: FieldPoint
  time: number
  pressure: number
  law: PenLaw
  predicted?: boolean
}

export interface RemodelPoint {
  point: FieldPoint
  pressure: number
}

export interface SaturationMeasurement {
  density: number
  saturation: number
  compression: number
  rarefaction: number
  densityRate: number
  saturationRate: number
  rarefactionRate: number
}

export interface ContourMeasurement {
  found: boolean
  inner?: number
  outer?: number
  width: number
  peakCompression: number
}

export interface EnergyMeasurement {
  curveSpeed: number
  fieldSpeed: number
  rarefactionRadius: number
  bufferWidth: number
  energy: number
}

export interface ObservationRegion {
  minX: number
  minY: number
  columns: number
  rows: number
  step: number
}

export interface StaticObservation extends ObservationRegion {
  time: number
  saturation: Float64Array
}

const finite = (value: number) => Number.isFinite(value)

function validateLaw(law: PenLaw) {
  if (!finite(law.width) || law.width <= 0 || !finite(law.diffusion) || law.diffusion < 0
    || !finite(law.strength) || law.strength < 0 || !finite(law.aspect) || law.aspect < 1
    || !finite(law.angle) || !finite(law.drift.x) || !finite(law.drift.y)
    || !finite(law.refill ?? 0) || (law.refill ?? 0) < 0
    || !finite(law.compression ?? 1) || (law.compression ?? 1) < 0 || (law.compression ?? 1) > 1
    || !finite(law.buffer ?? 1.8) || (law.buffer ?? 1.8) < 1
    || !finite(law.reverseInertia ?? 0) || (law.reverseInertia ?? 0) < 0
    || !finite(law.damping ?? 0) || (law.damping ?? 0) < 0) {
    throw new Error('Invalid pen law')
  }
}

function sourceMotion(law: PenLaw, age: number) {
  const inertia = law.reverseInertia ?? 0
  const damping = law.damping ?? 0
  let displacement: number, velocity: number
  if (inertia > 0) {
    const decay = Math.exp(-damping * age)
    const sine = Math.sin(inertia * age)
    displacement = decay * sine / inertia
    velocity = decay * (Math.cos(inertia * age) - damping * sine / inertia)
  } else if (damping > 0) {
    const decay = Math.exp(-damping * age)
    displacement = (1 - decay) / damping
    velocity = decay
  } else {
    displacement = age
    velocity = 1
  }
  return {
    x: law.drift.x * displacement, y: law.drift.y * displacement,
    velocityX: law.drift.x * velocity, velocityY: law.drift.y * velocity,
  }
}

function kernel(
  major: number, minor: number, velocityMajor: number, velocityMinor: number,
  law: PenLaw, age: number, amplitude: number, scale: number, ring: boolean,
) {
  const a = law.width * law.width * law.aspect * law.aspect * scale * scale + 2 * law.diffusion * age
  const b = law.width * law.width * scale * scale + 2 * law.diffusion * age
  const q = major * major / a + minor * minor / b
  const qRate = 2 * (law.diffusion * (major * major / (a * a) + minor * minor / (b * b))
    + velocityMajor * major / a + velocityMinor * minor / b)
  if (ring) {
    if (q >= 1) return { value: 0, rate: 0 }
    const normalization = 6 * amplitude / (Math.PI * Math.sqrt(a * b))
    const shape = q * (1 - q)
    const logRate = -law.diffusion * (1 / a + 1 / b) - (law.refill ?? 0)
    return {
      value: normalization * shape,
      rate: normalization * ((1 - 2 * q) * qRate + shape * logRate),
    }
  }
  const gaussian = amplitude * Math.exp(-q / 2) / (2 * Math.PI * Math.sqrt(a * b))
  const logRate = law.diffusion * (major * major / (a * a) + minor * minor / (b * b) - 1 / a - 1 / b)
    + velocityMajor * major / a + velocityMinor * minor / b - (law.refill ?? 0)
  return { value: gaussian, rate: gaussian * logRate }
}

function contribution(source: VoidSource, point: FieldPoint, time: number) {
  const age = time - source.time
  if (age < 0 || source.pressure === 0 || source.law.strength === 0) return { value: 0, rate: 0 }
  const { law } = source
  const motion = sourceMotion(law, age)
  const dx = point.x - source.point.x - motion.x, dy = point.y - source.point.y - motion.y
  const cos = Math.cos(law.angle), sin = Math.sin(law.angle)
  const major = cos * dx + sin * dy
  const minor = -sin * dx + cos * dy
  const velocityMajor = cos * motion.velocityX + sin * motion.velocityY
  const velocityMinor = -sin * motion.velocityX + cos * motion.velocityY
  const amplitude = law.strength * source.pressure * Math.exp(-(law.refill ?? 0) * age)
  const central = kernel(major, minor, velocityMajor, velocityMinor, law, age, amplitude, 1, false)
  const compression = law.compression ?? 1
  if (compression === 0) return central
  const buffer = kernel(major, minor, velocityMajor, velocityMinor, law, age, amplitude, law.buffer ?? 1.8, true)
  return { value: central.value - compression * buffer.value, rate: central.rate - compression * buffer.rate }
}

export class VoidProcess {
  readonly baseSaturation: number
  private readonly sources: VoidSource[] = []

  constructor(baseSaturation = 1, sources: VoidSource[] = []) {
    if (!finite(baseSaturation) || baseSaturation <= 0) throw new Error('Invalid base saturation')
    this.baseSaturation = baseSaturation
    sources.forEach(source => this.append(source))
  }

  get sourceCount() { return this.sources.length }
  get predictedCount() { return this.sources.filter(source => source.predicted).length }

  prune(time: number, minAge = 1) {
    if (!finite(time) || !finite(minAge) || minAge < 0) throw new Error('Invalid prune time')
    const remaining = this.sources.filter(source => {
      const age = time - source.time
      const refill = source.law.refill ?? 0
      return source.predicted || age < minAge || refill === 0 || Math.exp(-refill * age) >= 0.02
    })
    const removed = this.sources.length - remaining.length
    this.sources.splice(0, this.sources.length, ...remaining)
    return removed
  }

  append(source: VoidSource) {
    validateLaw(source.law)
    if (!finite(source.point.x) || !finite(source.point.y) || !finite(source.time) || source.time < 0
      || !finite(source.pressure) || source.pressure < 0 || source.pressure > 1) {
      throw new Error('Invalid void source')
    }
    const last = this.sources[this.sources.length - 1]
    if (last && source.time < last.time) throw new Error('Void sources must be causal')
    this.sources.push({
      point: { ...source.point }, time: source.time, pressure: source.pressure,
      law: { ...source.law, drift: { ...source.law.drift } }, predicted: source.predicted,
    })
  }

  measure(point: FieldPoint, time: number): SaturationMeasurement {
    if (!finite(point.x) || !finite(point.y) || !finite(time)) throw new Error('Invalid measurement')
    let rarefaction = 0, rarefactionRate = 0
    for (const source of this.sources) {
      const current = contribution(source, point, time)
      rarefaction += current.value
      rarefactionRate += current.rate
    }
    const rawDensity = this.baseSaturation - rarefaction
    const density = Math.max(0, rawDensity)
    const densityRate = rawDensity <= 0 ? Math.max(0, -rarefactionRate) : -rarefactionRate
    const saturation = density / this.baseSaturation
    return {
      density, saturation, compression: Math.max(0, saturation - 1), rarefaction,
      densityRate: densityRate || 0, saturationRate: densityRate / this.baseSaturation || 0, rarefactionRate,
    }
  }

  measureContour(origin: FieldPoint, time: number, angle: number, maxDistance = 64, step = 0.25): ContourMeasurement {
    if (!finite(origin.x) || !finite(origin.y) || !finite(time) || !finite(angle)
      || !finite(maxDistance) || maxDistance <= 0 || !finite(step) || step <= 0 || maxDistance / step > 100_000) {
      throw new Error('Invalid contour measurement')
    }
    const sample = (distance: number) => this.measure({
      x: origin.x + Math.cos(angle) * distance,
      y: origin.y + Math.sin(angle) * distance,
    }, time).saturation
    const crossing = (a: number, b: number, ra: number, rb: number) => ra + (1 - a) / (b - a) * (rb - ra)
    let previousDistance = 0, previous = sample(0)
    let inner: number | undefined = previous > 1 ? 0 : undefined, outer: number | undefined, peakCompression = 0
    for (let distance = step; distance <= maxDistance; distance += step) {
      const current = sample(distance)
      peakCompression = Math.max(peakCompression, Math.max(0, current - 1))
      if (inner === undefined && previous <= 1 && current > 1) inner = crossing(previous, current, previousDistance, distance)
      else if (inner !== undefined && previous > 1 && current <= 1) {
        outer = crossing(previous, current, previousDistance, distance)
        break
      }
      previousDistance = distance
      previous = current
    }
    return {
      found: inner !== undefined && outer !== undefined,
      inner, outer, width: inner !== undefined && outer !== undefined ? outer - inner : 0,
      peakCompression,
    }
  }

  measureEnergy(origin: FieldPoint, time: number, angle = 0): EnergyMeasurement {
    const contour = this.measureContour(origin, time, angle)
    const last = this.sources[this.sources.length - 1]
    if (!last || !contour.found || contour.inner === undefined || contour.outer === undefined) {
      return { curveSpeed: 0, fieldSpeed: 0, rarefactionRadius: 0, bufferWidth: 0, energy: 0 }
    }
    const previous = this.sources[this.sources.length - 2]
    let curveSpeed: number
    if (previous && last.time > previous.time) {
      curveSpeed = Math.hypot(last.point.x - previous.point.x, last.point.y - previous.point.y) / (last.time - previous.time)
    } else {
      const motion = sourceMotion(last.law, Math.max(0, time - last.time))
      curveSpeed = Math.hypot(motion.velocityX, motion.velocityY)
    }
    const delta = 0.001
    const before = Math.max(0, time - delta)
    const after = time + delta
    const outerBefore = this.measureContour(origin, before, angle).outer
    const outerAfter = this.measureContour(origin, after, angle).outer
    const fieldSpeed = outerBefore !== undefined && outerAfter !== undefined
      ? Math.abs(outerAfter - outerBefore) / (after - before) : 0
    const rarefactionRadius = contour.inner
    const bufferWidth = contour.outer - contour.inner
    return {
      curveSpeed, fieldSpeed, rarefactionRadius, bufferWidth,
      energy: curveSpeed * fieldSpeed * rarefactionRadius * bufferWidth,
    }
  }

  observe(region: ObservationRegion, time: number): StaticObservation {
    if (!finite(region.minX) || !finite(region.minY) || !finite(region.step) || region.step <= 0
      || !Number.isInteger(region.columns) || !Number.isInteger(region.rows)
      || region.columns <= 0 || region.rows <= 0 || region.columns * region.rows > 1_000_000) {
      throw new Error('Invalid observation region')
    }
    const saturation = new Float64Array(region.columns * region.rows)
    let index = 0
    for (let row = 0; row < region.rows; row++) {
      for (let column = 0; column < region.columns; column++) {
        saturation[index++] = this.measure({
          x: region.minX + column * region.step,
          y: region.minY + row * region.step,
        }, time).saturation
      }
    }
    return { ...region, time, saturation }
  }

  remodel(guides: RemodelPoint[], law: PenLaw | undefined, horizon: number, step = 1 / 120): VoidProcess {
    if (!finite(horizon) || horizon <= 0 || !finite(step) || step <= 0 || horizon / step > 10_000) {
      throw new Error('Invalid remodeling horizon')
    }
    const remodeled = new VoidProcess(this.baseSaturation, this.sources)
    const last = this.sources[this.sources.length - 1]
    const activeLaw = last?.law ?? law
    if (!activeLaw || !guides.length) throw new Error('Remodeling requires a law and guide points')
    const start = last ?? { point: guides[0].point, pressure: guides[0].pressure }
    const points = [start, ...(last ? guides : guides.slice(1))]
    if (points.length < 2) throw new Error('Remodeling requires a possible path')
    const samples: RemodelPoint[] = []
    for (let index = 0; index + 1 < points.length; index++) {
      const p0 = points[Math.max(0, index - 1)].point
      const p1 = points[index].point
      const p2 = points[index + 1].point
      const p3 = points[Math.min(points.length - 1, index + 2)].point
      for (let part = 0; part < 32; part++) {
        const t = part / 32, t2 = t * t, t3 = t2 * t
        const coordinate = (a: number, b: number, c: number, d: number) => 0.5
          * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
        samples.push({
          point: { x: coordinate(p0.x, p1.x, p2.x, p3.x), y: coordinate(p0.y, p1.y, p2.y, p3.y) },
          pressure: points[index].pressure + (points[index + 1].pressure - points[index].pressure) * t,
        })
      }
    }
    samples.push(points[points.length - 1])
    const distances = [0]
    for (let index = 1; index < samples.length; index++) {
      distances.push(distances[index - 1] + Math.hypot(samples[index].point.x - samples[index - 1].point.x,
        samples[index].point.y - samples[index - 1].point.y))
    }
    const length = distances[distances.length - 1]
    if (!(length > 0)) throw new Error('Remodeling path must have length')
    const baseTime = last?.time ?? 0
    const count = Math.max(1, Math.ceil(horizon / step))
    let sampleIndex = 0
    for (let part = 1; part <= count; part++) {
      const elapsed = horizon * part / count
      const target = length * part / count
      while (sampleIndex + 1 < distances.length - 1 && distances[sampleIndex + 1] < target) sampleIndex++
      const span = distances[sampleIndex + 1] - distances[sampleIndex]
      const ratio = span ? (target - distances[sampleIndex]) / span : 0
      const a = samples[sampleIndex], b = samples[sampleIndex + 1]
      remodeled.append({
        point: { x: a.point.x + (b.point.x - a.point.x) * ratio, y: a.point.y + (b.point.y - a.point.y) * ratio },
        time: baseTime + elapsed, pressure: a.pressure + (b.pressure - a.pressure) * ratio,
        law: activeLaw, predicted: true,
      })
    }
    return remodeled
  }
}
