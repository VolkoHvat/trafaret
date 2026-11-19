import type {
  BrushConfig, DocModel, SelectionModel, ShapeKind, SymmetryMode, VectorObject,
} from '../types'
import type { StrokePoint } from './brushes'
import { defaultVectorTransform, ensureObjectOrigin, pointsBounds } from './geometry'

export const copyPoints = (points: StrokePoint[]): StrokePoint[] => points.map(([x, y, pressure]) => [x, y, pressure])

function rotatePoint(point: StrokePoint, cx: number, cy: number, angle: number): StrokePoint {
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const dx = point[0] - cx, dy = point[1] - cy
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos, point[2]]
}

function symmetricPointSets(points: StrokePoint[], doc: DocModel, mode: SymmetryMode, radialCount: number) {
  const sets = [points]
  if (mode === 'vertical') {
    sets.push(points.map(([x, y, pressure]) => [doc.width - x, y, pressure]))
  } else if (mode === 'radial') {
    for (let index = 1; index < radialCount; index++) {
      const angle = index * Math.PI * 2 / radialCount
      sets.push(points.map(point => rotatePoint(point, doc.width / 2, doc.height / 2, angle)))
    }
  }
  return sets
}

function symmetricHandles(object: VectorObject, doc: DocModel, mode: SymmetryMode, radialCount: number, setIndex: number) {
  if (!object.handles) return undefined
  const angle = setIndex * Math.PI * 2 / radialCount
  const mapPoint = (point: [number, number]): [number, number] => {
    if (mode === 'vertical') return [doc.width - point[0], point[1]]
    const rotated = rotatePoint([point[0], point[1], 0], doc.width / 2, doc.height / 2, angle)
    return [rotated[0], rotated[1]]
  }
  return Object.fromEntries(Object.entries(object.handles).map(([key, handles]) => [key, {
    in: handles.in && mapPoint(handles.in),
    out: handles.out && mapPoint(handles.out),
  }]))
}

export function symmetricObjects(object: VectorObject, doc: DocModel, mode: SymmetryMode, radialCount: number, idFactory: () => string) {
  const sets = symmetricPointSets(object.points, doc, mode, radialCount)
  return sets.map((points, index) => ensureObjectOrigin({
    ...object,
    id: index === 0 ? object.id : idFactory(),
    points: copyPoints(points),
    handles: index === 0 ? object.handles : symmetricHandles(object, doc, mode, radialCount, index),
    widthProfile: object.widthProfile ? { ...object.widthProfile } : undefined,
    origin: undefined,
    brush: { ...object.brush },
    transform: defaultVectorTransform(),
  }))
}

export interface StrokeSessionOptions {
  pointerId: number
  layerId: string
  channel: 'content' | 'mask'
  point: StrokePoint
  pen: boolean
  brush: BrushConfig
  color: string
  eraser: boolean
  line: boolean
  shape?: ShapeKind
  vector: boolean
  symmetry: SymmetryMode
  radialCount: number
  doc: DocModel
}

export class StrokeSession {
  readonly pointerId: number
  readonly layerId: string
  readonly channel: 'content' | 'mask'
  readonly pen: boolean
  readonly brush: BrushConfig
  readonly color: string
  readonly eraser: boolean
  readonly shape?: ShapeKind
  readonly vector: boolean
  private readonly line: boolean
  private readonly symmetry: SymmetryMode
  private readonly radialCount: number
  private readonly doc: DocModel
  private points: StrokePoint[]

  constructor(options: StrokeSessionOptions) {
    this.pointerId = options.pointerId
    this.layerId = options.layerId
    this.channel = options.channel
    this.pen = options.pen
    this.brush = { ...options.brush }
    this.color = options.color
    this.eraser = options.eraser
    this.line = options.line
    this.shape = options.shape
    this.vector = options.vector
    this.symmetry = options.symmetry
    this.radialCount = options.radialCount
    this.doc = options.doc
    this.points = [copyPoints([options.point])[0]]
  }

  addPoint(point: StrokePoint) {
    if (this.line || this.shape) {
      if (this.points.length === 1) this.points.push(point)
      else this.points[1] = point
      return
    }
    const last = this.points[this.points.length - 1]
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.25) this.points.push(point)
  }

  pointSets(): StrokePoint[][] {
    return symmetricPointSets(this.points, this.doc, this.symmetry, this.radialCount)
  }

  previewPointSets(): StrokePoint[][] {
    const sets = this.pointSets()
    if (this.line || this.shape) return sets
    return sets.map(points => {
      if (points.length < 2) return points
      const a = points[points.length - 2], b = points[points.length - 1]
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const distance = Math.hypot(dx, dy)
      if (!distance) return points
      const predictionDistance = Math.min(32, Math.max(4, distance * 1.5))
      const predicted: StrokePoint = [
        b[0] + dx / distance * predictionDistance,
        b[1] + dy / distance * predictionDistance,
        b[2],
      ]
      return [...points, predicted]
    })
  }

  rasterRect() {
    const pad = this.brush.size * 2 + 24
    const bounds = pointsBounds(this.pointSets().flat(), pad)
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
    const x = clamp(Math.floor(bounds.minX), 0, this.doc.width - 1)
    const y = clamp(Math.floor(bounds.minY), 0, this.doc.height - 1)
    return {
      x, y,
      width: clamp(Math.ceil(bounds.maxX) - x, 1, this.doc.width - x),
      height: clamp(Math.ceil(bounds.maxY) - y, 1, this.doc.height - y),
    }
  }

  vectorObjects(clips: SelectionModel[] | undefined, idFactory: () => string): VectorObject[] {
    const object: VectorObject = {
      id: idFactory(), kind: this.shape ? 'shape' : 'stroke', shape: this.shape,
      points: copyPoints(this.points), brush: { ...this.brush }, color: this.color,
      pen: this.pen, closed: Boolean(this.shape), clips, transform: defaultVectorTransform(),
    }
    return symmetricObjects(object, this.doc, this.symmetry, this.radialCount, idFactory)
  }
}
