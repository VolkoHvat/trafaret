import type { BrushConfig, ScanFilters, SymmetryMode } from '../types'
import type { StrokePoint } from './brushes'

export interface PluginManifest {
  id: string
  name: string
  version: number
  operations: PluginOperation[]
}

export interface PluginOperation {
  type: 'set-brush' | 'set-symmetry' | 'set-stencil' | 'set-layer-filters' | 'add-path'
  brush?: Partial<BrushConfig>
  mode?: SymmetryMode
  radialCount?: number
  enabled?: boolean
  filters?: Partial<ScanFilters>
  points?: StrokePoint[]
  closed?: boolean
  color?: string
}

export interface PluginApi {
  setBrush: (patch: Partial<BrushConfig>) => void
  setSymmetry: (mode: SymmetryMode, count: number) => void
  setStencil: (enabled: boolean) => void
  setLayerFilters: (patch: Partial<ScanFilters>) => void
  addPath: (points: StrokePoint[], closed: boolean, color: string, brush?: Partial<BrushConfig>) => void
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function points(value: unknown): StrokePoint[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 10_000) throw new Error('Плагин: нужно от 2 до 10000 точек')
  return value.map(point => {
    if (!Array.isArray(point) || point.length < 2 || point.length > 3) throw new Error('Плагин: неверная точка')
    const [x, y, pressure = 0.5] = point
    if (![x, y, pressure].every(component => typeof component === 'number' && Number.isFinite(component))) {
      throw new Error('Плагин: координаты должны быть числами')
    }
    if (Math.abs(x) > 100_000 || Math.abs(y) > 100_000 || pressure < 0 || pressure > 1) throw new Error('Плагин: неверные координаты')
    return [x, y, pressure]
  })
}

function operation(value: unknown): PluginOperation {
  if (!value || typeof value !== 'object') throw new Error('Плагин: неверная операция')
  const input = value as Record<string, unknown>
  if (!['set-brush', 'set-symmetry', 'set-stencil', 'set-layer-filters', 'add-path'].includes(String(input.type))) {
    throw new Error(`Плагин: неизвестная операция ${String(input.type)}`)
  }
  const operation = input as unknown as PluginOperation
  if (operation.type === 'set-brush' && (!operation.brush || typeof operation.brush !== 'object')) throw new Error('Плагин: нет brush')
  if (operation.type === 'set-symmetry' && !['off', 'vertical', 'radial'].includes(String(operation.mode))) throw new Error('Плагин: неверная симметрия')
  if (operation.type === 'set-stencil' && typeof operation.enabled !== 'boolean') throw new Error('Плагин: нет enabled')
  if (operation.type === 'set-layer-filters' && (!operation.filters || typeof operation.filters !== 'object')) throw new Error('Плагин: нет filters')
  if (operation.type === 'add-path') {
    operation.points = points(operation.points)
    operation.closed = operation.closed === true
    operation.color = /^#[0-9a-f]{6}$/i.test(String(operation.color)) ? String(operation.color) : '#e8e0d8'
  }
  return operation
}

export function parsePluginManifest(source: string): PluginManifest {
  const input = JSON.parse(source) as Record<string, unknown>
  if (!input || typeof input !== 'object') throw new Error('Плагин: неверный manifest')
  return {
    id: text(input.id, 'local-plugin'),
    name: text(input.name, 'Локальный плагин'),
    version: typeof input.version === 'number' && Number.isFinite(input.version) ? input.version : 1,
    operations: Array.isArray(input.operations) ? input.operations.map(operation) : [],
  }
}

export async function executePlugin(manifest: PluginManifest, api: PluginApi) {
  for (const operation of manifest.operations) {
    if (operation.type === 'set-brush') api.setBrush(operation.brush!)
    else if (operation.type === 'set-symmetry') api.setSymmetry(operation.mode!, Math.max(1, Math.min(64, Math.round(operation.radialCount ?? 6))))
    else if (operation.type === 'set-stencil') api.setStencil(operation.enabled!)
    else if (operation.type === 'set-layer-filters') api.setLayerFilters(operation.filters!)
    else if (operation.type === 'add-path') api.addPath(operation.points!, operation.closed!, operation.color!, operation.brush)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
