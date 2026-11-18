export type ToolId = 'object' | 'brush' | 'eraser' | 'line' | 'shape' | 'pen' | 'fill' | 'area' | 'lasso' | 'pan' | 'picker'
export type BrushId = 'fineline' | 'traditional' | 'blackwork' | 'dotwork' | 'whip' | 'sketch' | 'shader'
export type PressureCurve = 'soft' | 'linear' | 'firm'
export type LayerKind = 'paint' | 'image' | 'vector'
export type ShapeKind = 'rectangle' | 'ellipse' | 'arc'
export type SymmetryMode = 'off' | 'vertical' | 'radial'
export type GuideMode = 'none' | 'circle' | 'ellipse'

export interface BrushConfig {
  id: BrushId
  name: string
  family: string
  size: number
  opacity: number
  thinning: number
  streamline: number
  smoothing: number
  taperStart: number
  taperEnd: number
  pressureCurve: PressureCurve
  passes: number
  jitter: number
  strokeMode?: 'outline' | 'dotwork'
  distributeOpacity?: boolean
  blurScale?: number
}

export interface BrushPreset {
  name: string
  config: BrushConfig
}

export interface ScanFilters {
  grayscale: boolean
  contrast: number
  threshold: number
  invert: boolean
}

export interface VectorTransform {
  x: number
  y: number
  scale: number
  rotation: number
}

export interface VectorObject {
  id: string
  kind: 'stroke' | 'path' | 'shape'
  shape?: ShapeKind
  points: [number, number, number][]
  brush: BrushConfig
  color: string
  pen: boolean
  closed?: boolean
  fill?: boolean
  angles?: [number, number]
  origin?: { x: number; y: number }
  clips?: SelectionModel[]
  transform: VectorTransform
}

export interface LayerModel {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  locked: boolean
  opacity: number
  blend: GlobalCompositeOperation
  canvas: HTMLCanvasElement
  source?: string
  sourceImage?: HTMLImageElement
  transform?: { scale: number; rotation: number; x?: number; y?: number }
  filters?: ScanFilters
  objects?: VectorObject[]
  mask?: HTMLCanvasElement
  maskEnabled?: boolean
  maskVersion?: number
  clipToBelow?: boolean
  filterCache?: HTMLCanvasElement
  filterKey?: string
  pixelVersion: number
  dataCache?: { version: number; data: string }
  maskCache?: { version: number; data: string }
}

export interface DocModel {
  width: number
  height: number
  title: string
  dpi: number
}

export interface SelectionModel {
  kind: 'rectangle' | 'ellipse' | 'lasso'
  points: [number, number][]
  inverse?: boolean
}

export interface LayerSnapshot {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  locked: boolean
  opacity: number
  blend: GlobalCompositeOperation
  data: string
  source?: string
  transform?: { scale: number; rotation: number; x?: number; y?: number }
  filters?: ScanFilters
  objects?: VectorObject[]
  maskData?: string
  maskEnabled?: boolean
  clipToBelow?: boolean
}

export interface ProjectSnapshot {
  format: 'trafaret-project'
  version: number
  savedAt: string
  /** Стабильный ID проекта для синхронизации; у файлов v1/v2 может отсутствовать. */
  projectId?: string
  /** Локальная ревизия содержимого, растёт с каждым реальным изменением. */
  revision?: number
  doc: DocModel
  layers: LayerSnapshot[]
  activeLayerId: string
}

export interface ViewState {
  zoom: number
  panX: number
  panY: number
}
