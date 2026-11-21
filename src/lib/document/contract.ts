export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export interface V2Point {
  x: number
  y: number
  pressure: number
  time?: number
}

export interface V2EnergyMetadata {
  source: 'fixed' | 'measured-pressure' | 'velocity-only'
  confidence: 'fixed' | 'measured' | 'modelled'
  energy: number
  power: number
  speed: number
}

export interface V2BrushMetadata {
  id: string
  name: string
  family: string
  size: number
  opacity: number
  thinning: number
  streamline: number
  smoothing: number
  taperStart: number
  taperEnd: number
  pressureCurve: 'soft' | 'linear' | 'firm'
  passes: number
  jitter: number
  strokeMode?: 'outline' | 'dotwork'
  distributeOpacity?: boolean
  blurScale?: number
}

export interface V2ClipMetadata {
  kind: 'rectangle' | 'ellipse' | 'lasso'
  points: [number, number][]
  inverse?: boolean
}

export interface V2StrokeRecord {
  id: string
  kind: 'stroke' | 'shape' | 'path'
  points: V2Point[]
  brush: V2BrushMetadata
  energy?: V2EnergyMetadata
  color: string
  pen: boolean
  eraser?: boolean
  shape?: 'rectangle' | 'ellipse' | 'arc'
  closed?: boolean
  fill?: boolean
  angles?: [number, number]
  origin?: { x: number; y: number }
  handles?: Record<string, { in?: [number, number]; out?: [number, number] }>
  clips?: V2ClipMetadata[]
  widthProfile?: Record<string, number>
  transform: { x: number; y: number; scale: number; rotation: number }
}

export interface V2LayerRecord {
  id: string
  name: string
  kind: 'paint' | 'image' | 'vector'
  visible: boolean
  locked: boolean
  opacity: number
  blend: string
  data: string
  source?: string
  transform?: { scale: number; rotation: number; x?: number; y?: number }
  filters?: { grayscale: boolean; contrast: number; threshold: number; invert: boolean }
  strokes: V2StrokeRecord[]
  mask?: { data: string; enabled: boolean }
  clipToBelow: boolean
}

export interface TrafaretDocumentV2 {
  format: 'trafaret-document'
  version: 2
  savedAt?: string
  projectId?: string
  revision: number
  doc: { width: number; height: number; title: string; dpi: number }
  layers: V2LayerRecord[]
  activeLayerId: string
}

export interface MigrationResult {
  document: TrafaretDocumentV2
  migrated: boolean
  sourceVersion: number
}