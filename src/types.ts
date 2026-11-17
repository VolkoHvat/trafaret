export type ToolId = 'brush' | 'eraser' | 'line' | 'pan' | 'picker'
export type BrushId = 'fineline' | 'traditional' | 'blackwork' | 'dotwork' | 'whip' | 'sketch' | 'shader'
export type PressureCurve = 'soft' | 'linear' | 'firm'

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
}

export interface ScanFilters {
  grayscale: boolean
  contrast: number
  threshold: number
  invert: boolean
}

export interface LayerModel {
  id: string
  name: string
  kind: 'paint' | 'image'
  visible: boolean
  locked: boolean
  opacity: number
  blend: GlobalCompositeOperation
  canvas: HTMLCanvasElement
  source?: string
  sourceImage?: HTMLImageElement
  transform?: { scale: number; rotation: number; x?: number; y?: number }
  filters?: ScanFilters
  filterCache?: HTMLCanvasElement
  filterKey?: string
  pixelVersion: number
  dataCache?: { version: number; data: string }
}

export interface DocModel {
  width: number
  height: number
  title: string
}

export interface LayerSnapshot {
  id: string
  name: string
  kind: 'paint' | 'image'
  visible: boolean
  locked: boolean
  opacity: number
  blend: GlobalCompositeOperation
  data: string
  source?: string
  transform?: { scale: number; rotation: number; x?: number; y?: number }
  filters?: ScanFilters
}

export interface ProjectSnapshot {
  format: 'trafaret-project'
  version: 1
  savedAt: string
  doc: DocModel
  layers: LayerSnapshot[]
  activeLayerId: string
}

export interface ViewState {
  zoom: number
  panX: number
  panY: number
}
