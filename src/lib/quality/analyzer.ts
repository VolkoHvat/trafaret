import type { VectorObject } from '../../types'

export type QualityPoint = readonly [number, number, number?] | {
  x: number
  y: number
  pressure?: number
  time?: number
}

export interface QualityDocument {
  width: number
  height: number
}

export interface QualitySamples {
  points: readonly QualityPoint[]
  closed?: boolean
}

export interface QualityInput {
  points?: readonly QualityPoint[]
  object?: VectorObject
  objects?: readonly VectorObject[]
  document: QualityDocument
  samples?: QualitySamples
  closed?: boolean
  width?: number | readonly number[]
  options?: Partial<QualityOptions>
}

export interface QualityOptions {
  angleThreshold: number
  shortSegmentRatio: number
  shortSegmentAbsolute: number
  continuityGapRatio: number
  continuityGapAbsolute: number
}

export type QualityLevel = 'excellent' | 'good' | 'review' | 'poor'

export interface QualityMetric {
  score: number
  available: boolean
  count: number
  total?: number
  value?: number
}

export interface QualityReport {
  score: number
  level: QualityLevel
  metrics: {
    continuity: QualityMetric
    sharpTurns: QualityMetric & { minimumAngle?: number }
    thickness: QualityMetric & { variation?: number }
    motion: QualityMetric & { speedVariation?: number; pressureVariation?: number }
    intersections: QualityMetric
    noise: QualityMetric
    bounds: QualityMetric & { outsideDistance?: number }
  }
  recommendations: string[]
  analyzedPoints: number
  analyzedSegments: number
}

interface NormalizedPoint {
  x: number
  y: number
  pressure?: number
  time?: number
}

interface StrokeData {
  points: NormalizedPoint[]
  widths: number[]
  closed: boolean
}

const DEFAULT_OPTIONS: QualityOptions = {
  angleThreshold: 55,
  shortSegmentRatio: 0.2,
  shortSegmentAbsolute: 0.5,
  continuityGapRatio: 3,
  continuityGapAbsolute: 24,
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const finite = (value: number | undefined, fallback = 0) => Number.isFinite(value) ? value! : fallback

function isTuplePoint(point: QualityPoint): point is Extract<QualityPoint, readonly unknown[]> {
  return Array.isArray(point)
}

function pointValue(point: QualityPoint): NormalizedPoint {
  if (isTuplePoint(point)) return { x: finite(point[0]), y: finite(point[1]), pressure: point[2] }
  return { x: finite(point.x), y: finite(point.y), pressure: point.pressure, time: point.time }
}

function transformPoint(point: QualityPoint, object: VectorObject): NormalizedPoint {
  const local = pointValue(point)
  const origin = object.origin ?? { x: 0, y: 0 }
  const angle = object.transform.rotation * Math.PI / 180
  const dx = (local.x - origin.x) * object.transform.scale
  const dy = (local.y - origin.y) * object.transform.scale
  return {
    x: origin.x + object.transform.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: origin.y + object.transform.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    pressure: local.pressure,
    time: local.time,
  }
}

function median(values: readonly number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function variation(values: readonly number[]) {
  if (values.length < 2) return 0
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  if (!average) return 0
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length)
  return deviation / average
}

function scoreMetric(score: number, count: number, total: number, value?: number): QualityMetric {
  return { score: clamp(score), available: true, count, total, ...(value === undefined ? {} : { value }) }
}

function toStrokeData(points: readonly QualityPoint[], closed: boolean, width: number | readonly number[] | undefined, object?: VectorObject): StrokeData {
  const normalized = object ? points.map(point => transformPoint(point, object)) : points.map(pointValue)
  const baseWidth = object?.brush.size ?? (typeof width === 'number' ? width : 1)
  const widths = normalized.map((_, index) => {
    const profile = object?.widthProfile?.[index] ?? (Array.isArray(width) ? width[index] : undefined) ?? 1
    return Math.max(0.01, baseWidth * finite(profile, 1))
  })
  return { points: normalized, widths, closed }
}

function segments(stroke: StrokeData) {
  const result: { a: NormalizedPoint; b: NormalizedPoint; width: number }[] = []
  for (let index = 1; index < stroke.points.length; index++) {
    result.push({
      a: stroke.points[index - 1], b: stroke.points[index],
      width: (stroke.widths[index - 1] + stroke.widths[index]) / 2,
    })
  }
  if (stroke.closed && stroke.points.length > 2) {
    result.push({
      a: stroke.points[stroke.points.length - 1], b: stroke.points[0],
      width: (stroke.widths[stroke.widths.length - 1] + stroke.widths[0]) / 2,
    })
  }
  return result
}

function orientation(a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSegment(a: NormalizedPoint, b: NormalizedPoint, p: NormalizedPoint) {
  return Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x)
    && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)
}

function intersects(first: { a: NormalizedPoint; b: NormalizedPoint }, second: { a: NormalizedPoint; b: NormalizedPoint }) {
  const ab = orientation(first.a, first.b, second.a)
  const ac = orientation(first.a, first.b, second.b)
  const cd = orientation(second.a, second.b, first.a)
  const ce = orientation(second.a, second.b, first.b)
  const epsilon = 1e-9
  if (Math.abs(ab) < epsilon && onSegment(first.a, first.b, second.a)) return true
  if (Math.abs(ac) < epsilon && onSegment(first.a, first.b, second.b)) return true
  if (Math.abs(cd) < epsilon && onSegment(second.a, second.b, first.a)) return true
  if (Math.abs(ce) < epsilon && onSegment(second.a, second.b, first.b)) return true
  return (ab > 0) !== (ac > 0) && (cd > 0) !== (ce > 0)
}

function analyzeStroke(stroke: StrokeData, document: QualityDocument, options: QualityOptions) {
  const lines = segments(stroke)
  const lengths = lines.map(line => Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y))
  const typicalLength = median(lengths.filter(length => length > 0)) || 1
  const gaps = lengths.filter(length => length > Math.max(options.continuityGapAbsolute, typicalLength * options.continuityGapRatio)).length
  const continuity = scoreMetric(1 - gaps / Math.max(1, lengths.length), gaps, lengths.length, gaps ? gaps / lengths.length : 0)

  const angles: number[] = []
  for (let index = 1; index < stroke.points.length - 1; index++) {
    const previous = stroke.points[index - 1], current = stroke.points[index], next = stroke.points[index + 1]
    const incomingLength = Math.hypot(previous.x - current.x, previous.y - current.y)
    const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y)
    const cosine = incomingLength && outgoingLength
      ? ((previous.x - current.x) * (next.x - current.x) + (previous.y - current.y) * (next.y - current.y)) / (incomingLength * outgoingLength)
      : 1
    angles.push(Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI)
  }
  const sharp = angles.filter(angle => angle < options.angleThreshold)
  const sharpTurns = { ...scoreMetric(1 - sharp.length / Math.max(1, angles.length), sharp.length, angles.length), minimumAngle: angles.length ? Math.min(...angles) : undefined }

  const thicknessVariation = variation(lines.map(line => line.width))
  const thickness = { ...scoreMetric(1 / (1 + thicknessVariation), thicknessVariation > 0 ? 1 : 0, lines.length, thicknessVariation), variation: thicknessVariation }

  let intersections = 0
  for (let first = 0; first < lines.length; first++) {
    for (let second = first + 1; second < lines.length; second++) {
      const adjacent = second === first + 1 || (stroke.closed && first === 0 && second === lines.length - 1)
      if (!adjacent && intersects(lines[first], lines[second])) intersections++
    }
  }
  const intersectionMetric = scoreMetric(intersections ? 0 : 1, intersections, Math.max(1, lines.length))

  const short = lengths.filter(length => length > 0 && length < Math.max(options.shortSegmentAbsolute, typicalLength * options.shortSegmentRatio)).length
  const noise = scoreMetric(1 - short / Math.max(1, lengths.length), short, lengths.length, short ? short / lengths.length : 0)

  const outside = stroke.points.reduce((distance, point) => {
    const dx = Math.max(0, -point.x, point.x - document.width)
    const dy = Math.max(0, -point.y, point.y - document.height)
    return distance + Math.hypot(dx, dy)
  }, 0)
  const outsideCount = stroke.points.filter(point => point.x < 0 || point.y < 0 || point.x > document.width || point.y > document.height).length
  const bounds = { ...scoreMetric(outsideCount ? 0 : 1, outsideCount, stroke.points.length, outsideCount / Math.max(1, stroke.points.length)), outsideDistance: outside }

  return { lines, continuity, sharpTurns, thickness, intersectionMetric, noise, bounds }
}

function analyzeMotion(samples: QualitySamples | undefined): QualityMetric & { speedVariation?: number; pressureVariation?: number } {
  if (!samples || samples.points.length < 2) return { score: 0, available: false, count: 0 }
  const points = samples.points.map(pointValue)
  const speeds: number[] = []
  for (let index = 1; index < points.length; index++) {
    const distance = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
    const deltaTime = points[index].time !== undefined && points[index - 1].time !== undefined
      ? Math.max(0.001, points[index].time! - points[index - 1].time!) : 1
    speeds.push(distance / deltaTime)
  }
  const pressures = points.map(point => point.pressure).filter((pressure): pressure is number => pressure !== undefined && Number.isFinite(pressure))
  const speedVariation = variation(speeds)
  const pressureVariation = pressures.length > 1 ? variation(pressures) : undefined
  const combined = pressureVariation === undefined ? speedVariation : (speedVariation + pressureVariation) / 2
  return { ...scoreMetric(1 / (1 + combined), 0, samples.points.length, combined), speedVariation, pressureVariation }
}

function recommendationList(report: Omit<QualityReport, 'recommendations'>) {
  const recommendations: string[] = []
  if (report.metrics.continuity.score < 0.8) recommendations.push('Проверьте разрывы и переходы между точками; ведите линию более непрерывно.')
  if (report.metrics.sharpTurns.score < 0.8) recommendations.push('Смягчите резкие изломы или добавьте контрольную точку перед сменой направления.')
  if (report.metrics.thickness.score < 0.8) recommendations.push('Стабилизируйте давление или профиль толщины на этом участке.')
  if (report.metrics.motion.available && report.metrics.motion.score < 0.8) recommendations.push('Выровняйте скорость прохода и давление пера.')
  if (report.metrics.intersections.count) recommendations.push('Проверьте пересечения: разделите линии или измените траекторию.')
  if (report.metrics.noise.count) recommendations.push('Удалите короткие шумовые сегменты и лишние точки.')
  if (report.metrics.bounds.count) recommendations.push('Переместите линию внутрь границ документа.')
  return recommendations
}

export function analyzeQuality(input: QualityInput): QualityReport {
  const options = { ...DEFAULT_OPTIONS, ...input.options }
  const objectList = input.objects ?? (input.object ? [input.object] : [])
  const strokes = objectList.length
    ? objectList.map(object => toStrokeData(object.points, Boolean(object.closed), undefined, object))
    : input.points ? [toStrokeData(input.points, Boolean(input.closed), input.width)] : []
  const combined = strokes.length ? strokes : [{ points: [], widths: [], closed: false }]
  const analyses = combined.map(stroke => analyzeStroke(stroke, input.document, options))
  const allLines = analyses.flatMap(analysis => analysis.lines)
  const aggregate = (key: 'continuity' | 'sharpTurns' | 'thickness' | 'noise' | 'bounds') => {
    const metrics = analyses.map(analysis => analysis[key])
    const score = metrics.reduce((sum, metric) => sum + metric.score, 0) / Math.max(1, metrics.length)
    return { ...metrics[0], score, count: metrics.reduce((sum, metric) => sum + metric.count, 0), total: metrics.reduce((sum, metric) => sum + (metric.total ?? 0), 0) }
  }
  const motion = analyzeMotion(input.samples)
  let intersections = analyses.reduce((sum, analysis) => sum + analysis.intersectionMetric.count, 0)
  for (let first = 0; first < analyses.length; first++) {
    for (let second = first + 1; second < analyses.length; second++) {
      for (const firstLine of analyses[first].lines) {
        for (const secondLine of analyses[second].lines) {
          if (intersects(firstLine, secondLine)) intersections++
        }
      }
    }
  }
  const metricScores = [aggregate('continuity').score, aggregate('sharpTurns').score, aggregate('thickness').score, aggregate('noise').score, aggregate('bounds').score, intersections ? 0 : 1]
  if (motion.available) metricScores.push(motion.score)
  const score = Math.round(metricScores.reduce((sum, value) => sum + value, 0) / metricScores.length * 100) / 100
  const level: QualityLevel = score >= 0.9 ? 'excellent' : score >= 0.75 ? 'good' : score >= 0.55 ? 'review' : 'poor'
  const withoutRecommendations = {
    score,
    level,
    metrics: {
      continuity: aggregate('continuity'),
      sharpTurns: aggregate('sharpTurns'),
      thickness: aggregate('thickness'),
      motion,
      intersections: scoreMetric(intersections ? 0 : 1, intersections, Math.max(1, allLines.length)),
      noise: aggregate('noise'),
      bounds: aggregate('bounds'),
    },
    analyzedPoints: combined.reduce((sum, stroke) => sum + stroke.points.length, 0),
    analyzedSegments: allLines.length,
  }
  return { ...withoutRecommendations, recommendations: recommendationList(withoutRecommendations) }
}
