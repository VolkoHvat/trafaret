import { getStroke } from 'perfect-freehand'
import type { BrushConfig, BrushId, PressureCurve } from '../types'

export const DEFAULT_BRUSHES: Record<BrushId, BrushConfig> = {
  fineline: {
    id: 'fineline', name: 'Fineline', family: 'Точный контур', size: 4, opacity: 0.96,
    thinning: 0.68, streamline: 0.68, smoothing: 0.78, taperStart: 8, taperEnd: 16,
    pressureCurve: 'soft', passes: 1, jitter: 0,
  },
  traditional: {
    id: 'traditional', name: 'Traditional', family: 'Упругий лайнер', size: 10, opacity: 1,
    thinning: 0.38, streamline: 0.56, smoothing: 0.7, taperStart: 5, taperEnd: 10,
    pressureCurve: 'linear', passes: 1, jitter: 0,
  },
  blackwork: {
    id: 'blackwork', name: 'Blackwork', family: 'Плотный заливной', size: 30, opacity: 1,
    thinning: 0.08, streamline: 0.42, smoothing: 0.58, taperStart: 0, taperEnd: 0,
    pressureCurve: 'firm', passes: 1, jitter: 0,
  },
  dotwork: {
    id: 'dotwork', name: 'Dotwork', family: 'Точка и стипплинг', size: 5, opacity: 0.9,
    thinning: 0.72, streamline: 0.42, smoothing: 0.55, taperStart: 0, taperEnd: 0,
    pressureCurve: 'soft', passes: 1, jitter: 0.8, strokeMode: 'dotwork',
  },
  whip: {
    id: 'whip', name: 'Whip shade', family: 'Воздушная растяжка', size: 9, opacity: 0.34,
    thinning: 0.84, streamline: 0.62, smoothing: 0.8, taperStart: 0, taperEnd: 34,
    pressureCurve: 'soft', passes: 3, jitter: 1.6, distributeOpacity: true,
  },
  sketch: {
    id: 'sketch', name: 'Sketch', family: 'Свободный карандаш', size: 3, opacity: 0.42,
    thinning: 0.5, streamline: 0.24, smoothing: 0.42, taperStart: 3, taperEnd: 5,
    pressureCurve: 'linear', passes: 2, jitter: 0.7, distributeOpacity: true,
  },
  shader: {
    id: 'shader', name: 'Soft shade', family: 'Мягкая тень', size: 44, opacity: 0.12,
    thinning: 0.24, streamline: 0.52, smoothing: 0.75, taperStart: 0, taperEnd: 20,
    pressureCurve: 'soft', passes: 1, jitter: 0, blurScale: 1 / 9,
  },
}

export const BRUSH_ORDER: BrushId[] = ['fineline', 'traditional', 'blackwork', 'dotwork', 'whip', 'sketch', 'shader']

export type StrokePoint = [number, number, number]

export function brushRendering(brush: BrushConfig) {
  const defaults = DEFAULT_BRUSHES[brush.id]
  return {
    dotwork: (brush.strokeMode ?? defaults.strokeMode) === 'dotwork',
    distributeOpacity: brush.distributeOpacity ?? defaults.distributeOpacity ?? false,
    blurScale: brush.blurScale ?? defaults.blurScale ?? 0,
  }
}

export function pressureEasing(curve: PressureCurve) {
  if (curve === 'soft') return (t: number) => Math.pow(t, 1.55)
  if (curve === 'firm') return (t: number) => Math.pow(t, 0.62)
  return (t: number) => t
}

export function getSvgPathFromStroke(points: number[][], closed = true) {
  const len = points.length
  if (len < 4) return ''
  let a = points[0]
  let b = points[1]
  const c = points[2]
  const average = (x: number, y: number) => (x + y) / 2
  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)} ${average(b[1], c[1]).toFixed(2)} T`
  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i]
    b = points[i + 1]
    result += `${average(a[0], b[0]).toFixed(2)} ${average(a[1], b[1]).toFixed(2)} `
  }
  if (closed) result += 'Z'
  return result
}

export function getStrokePathData(points: StrokePoint[], brush: BrushConfig, complete: boolean, pen: boolean) {
  const outline = getStroke(points, {
    size: brush.size,
    thinning: brush.thinning,
    smoothing: brush.smoothing,
    streamline: brush.streamline,
    easing: pressureEasing(brush.pressureCurve),
    simulatePressure: !pen,
    last: complete,
    start: { cap: true, taper: brush.taperStart },
    end: { cap: true, taper: brush.taperEnd },
  })
  return getSvgPathFromStroke(outline)
}

function pathFromPoints(points: StrokePoint[], brush: BrushConfig, complete: boolean, pen: boolean) {
  const d = getStrokePathData(points, brush, complete, pen)
  return d ? new Path2D(d) : null
}

function drawDotwork(ctx: CanvasRenderingContext2D, points: StrokePoint[], brush: BrushConfig, color: string) {
  if (!points.length) return
  const spacing = Math.max(2.2, brush.size * 0.85)
  let carry = 0
  ctx.fillStyle = color
  if (points.length === 1) {
    const [x, y, pressure] = points[0]
    const curve = pressureEasing(brush.pressureCurve)(pressure)
    const radius = Math.max(0.35, brush.size * (0.18 + curve * brush.thinning) / 2)
    ctx.globalAlpha = brush.opacity * (0.45 + pressure * 0.55)
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const distance = Math.hypot(dx, dy)
    if (!distance) continue
    let traveled = carry
    while (traveled <= distance) {
      const t = traveled / distance
      const pressure = a[2] + (b[2] - a[2]) * t
      const curve = pressureEasing(brush.pressureCurve)(pressure)
      const radius = Math.max(0.35, brush.size * (0.18 + curve * brush.thinning) / 2)
      const seed = i * 17.17 + traveled * 0.73
      const jx = Math.sin(seed) * brush.jitter
      const jy = Math.cos(seed * 1.37) * brush.jitter
      ctx.globalAlpha = brush.opacity * (0.45 + pressure * 0.55)
      ctx.beginPath()
      ctx.arc(a[0] + dx * t + jx, a[1] + dy * t + jy, radius, 0, Math.PI * 2)
      ctx.fill()
      traveled += spacing
    }
    carry = traveled - distance
  }
}

export function renderStroke(
  ctx: CanvasRenderingContext2D,
  points: StrokePoint[],
  brush: BrushConfig,
  color: string,
  complete: boolean,
  pen: boolean,
  eraser = false,
) {
  if (!points.length) return
  const rendering = brushRendering(brush)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'

  if (rendering.dotwork && !eraser) {
    drawDotwork(ctx, points, brush, color)
    ctx.restore()
    return
  }

  const path = pathFromPoints(points, brush, complete, pen)
  if (!path) {
    const p = points[0]
    ctx.globalAlpha = brush.opacity
    ctx.beginPath()
    ctx.arc(p[0], p[1], Math.max(0.5, brush.size / 2), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }

  for (let pass = 0; pass < brush.passes; pass++) {
    ctx.save()
    if (brush.jitter && brush.passes > 1) {
      const seed = pass * 2.31 + points.length * 0.07
      ctx.translate(Math.sin(seed) * brush.jitter, Math.cos(seed) * brush.jitter)
    }
    ctx.globalAlpha = eraser ? 1 : rendering.distributeOpacity
      ? brush.opacity / Math.max(1, brush.passes * 0.65)
      : brush.opacity
    if (rendering.blurScale && !eraser) ctx.filter = `blur(${Math.max(1, brush.size * rendering.blurScale)}px)`
    ctx.fill(path)
    ctx.restore()
  }
  ctx.restore()
}
