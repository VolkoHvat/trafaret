import type { JsonObject } from '../contract'

export const legacyProjectFixture: JsonObject = {
  format: 'trafaret-project', version: 1, savedAt: '2026-01-01T00:00:00.000Z', projectId: 'fixture-project', revision: 7,
  doc: { width: 1024, height: 768, title: 'Migration fixture', dpi: 300 }, activeLayerId: 'ink',
  layers: [
    {
      id: 'ink', name: 'Ink', kind: 'vector', visible: true, locked: false, opacity: 0.9, blend: 'multiply', data: '', clipToBelow: true,
      maskData: 'data:image/png;base64,mask', maskEnabled: true,
      objects: [{
        id: 'stroke-1', kind: 'stroke', points: [[10, 20, 0.4], [30, 40, 0.8]],
        brush: { id: 'fineline', name: 'Fineline', family: 'line', size: 4, opacity: 1, thinning: 0.5, streamline: 0.5, smoothing: 0.5, taperStart: 0, taperEnd: 0, pressureCurve: 'linear', passes: 1, jitter: 0 },
        color: '#111111', pen: true, clips: [{ kind: 'lasso', points: [[0, 0], [100, 0], [100, 100]], inverse: true }], transform: { x: 1, y: 2, scale: 1, rotation: 0 },
      }],
    },
    { id: 'paper', name: 'Paper', kind: 'paint', visible: true, locked: true, opacity: 1, blend: 'source-over', data: 'data:image/png;base64:pixels' },
  ],
}
