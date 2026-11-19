import { describe, expect, it, vi } from 'vitest'
import { executePlugin, parsePluginManifest } from './plugins'

describe('plugin manifests', () => {
  it('executes only whitelisted operations', async () => {
    const manifest = parsePluginManifest(JSON.stringify({
      id: 'test-plugin', name: 'Test', version: 1,
      operations: [
        { type: 'set-brush', brush: { size: 18 } },
        { type: 'set-symmetry', mode: 'vertical', radialCount: 4 },
        { type: 'set-stencil', enabled: false },
        { type: 'set-layer-filters', filters: { invert: true } },
        { type: 'add-path', points: [[10, 20], [30, 40]], closed: true, color: '#112233' },
      ],
    }))
    const api = {
      setBrush: vi.fn(), setSymmetry: vi.fn(), setStencil: vi.fn(),
      setLayerFilters: vi.fn(), addPath: vi.fn(),
    }

    await executePlugin(manifest, api)

    expect(api.setBrush).toHaveBeenCalledWith({ size: 18 })
    expect(api.setSymmetry).toHaveBeenCalledWith('vertical', 4)
    expect(api.setStencil).toHaveBeenCalledWith(false)
    expect(api.setLayerFilters).toHaveBeenCalledWith({ invert: true })
    expect(api.addPath).toHaveBeenCalledWith([[10, 20, 0.5], [30, 40, 0.5]], true, '#112233', undefined)
  })

  it('rejects unknown operations and invalid points', () => {
    expect(() => parsePluginManifest('{"operations":[{"type":"eval"}]}')).toThrow()
    expect(() => parsePluginManifest('{"operations":[{"type":"add-path","points":[[1,2]]}]}')).toThrow()
  })
})
