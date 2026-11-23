import type { EnergyInputSample } from './input-energy.ts'
import type { ArtworkPath } from './wyvern-artwork.ts'

type Segment = [number, number, number, number, number, number]

function stroke(start: [number, number], segments: Segment[], pressure = 0.65): ArtworkPath {
  const points: [number, number][] = [start]
  let from = start
  for (const [c1x, c1y, c2x, c2y, x, y] of segments) {
    const parts = Math.max(2, Math.ceil(Math.hypot(x - from[0], y - from[1]) / 0.35))
    for (let index = 1; index <= parts; index++) {
      const t = index / parts, u = 1 - t
      points.push([
        u * u * u * from[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
        u * u * u * from[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
      ])
    }
    from = [x, y]
  }
  return { points, pressure, closed: false }
}

function dot(x: number, y: number): ArtworkPath {
  return {
    points: Array.from({ length: 9 }, (_, index) => {
      const angle = index / 8 * Math.PI * 2
      return [x + Math.cos(angle) * 0.45, y + Math.sin(angle) * 0.45]
    }),
    pressure: 0.8, closed: true,
  }
}

export function silentiumPaths() {
  return [
    stroke([8, 25], [
      [4, 15, 16, 10, 23, 15], [29, 20, 14, 23, 12, 29],
      [10, 35, 25, 32, 24, 38], [23, 45, 9, 46, 6, 40], [10, 34, 20, 35, 28, 36],
    ], 0.85),
    stroke([28, 36], [[30, 33, 31, 31, 32, 29], [31, 35, 30, 40, 34, 38], [36, 35, 37, 34, 39, 33]], 0.65),
    dot(32, 23),
    stroke([39, 33], [[42, 26, 43, 14, 45, 10], [47, 4, 48, 9, 44, 16], [41, 25, 37, 35, 39, 39], [41, 43, 45, 39, 47, 36]], 0.7),
    stroke([47, 36], [[51, 34, 56, 30, 55, 27], [54, 23, 47, 27, 47, 33], [47, 40, 55, 41, 59, 36]], 0.65),
    stroke([59, 36], [[61, 32, 62, 29, 63, 27], [63, 32, 62, 35, 62, 38], [64, 32, 67, 26, 70, 27], [73, 28, 69, 36, 72, 38], [74, 39, 76, 37, 78, 35]], 0.65),
    stroke([78, 35], [[80, 30, 82, 22, 84, 16], [85, 13, 85, 15, 84, 20], [82, 28, 80, 38, 83, 39], [86, 40, 88, 37, 90, 35]], 0.7),
    stroke([79, 26], [[82, 25, 85, 25, 88, 24]], 0.45),
    stroke([90, 35], [[91, 32, 92, 29, 93, 27], [93, 32, 92, 39, 95, 38], [97, 36, 98, 34, 100, 32]], 0.65),
    dot(93, 21),
    stroke([100, 32], [[101, 29, 102, 27, 103, 26], [102, 31, 101, 38, 104, 38], [106, 35, 108, 28, 110, 26], [109, 31, 108, 38, 111, 38], [114, 35, 116, 32, 118, 30]], 0.65),
    stroke([118, 30], [[120, 27, 121, 25, 122, 24], [121, 29, 120, 36, 122, 38], [124, 33, 126, 26, 128, 25], [130, 24, 127, 34, 129, 38], [132, 33, 134, 26, 136, 25], [138, 24, 135, 34, 137, 38], [139, 40, 143, 36, 145, 32], [147, 29, 149, 28, 151, 29]], 0.7),
    stroke([145, 32], [[149, 35, 153, 35, 156, 31]], 0.45),
  ]
}

export function silentiumSamples(): EnergyInputSample[] {
  const samples: EnergyInputSample[] = []
  let time = 0
  for (const path of silentiumPaths()) {
    for (const [x, y] of path.points) {
      samples.push({ x, y, time, pressure: path.pressure, pointerType: 'pen' })
      time += 0.005
    }
  }
  return samples
}

export function silentiumSvg() {
  const paths = silentiumPaths().map(path => {
    const d = path.points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
    return `<path d="${d}" stroke-width="${(0.1 + path.pressure * 0.16).toFixed(3)}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 160 60">`
    + `<title>Silentium — авторская курсивная линия</title>`
    + `<rect width="160" height="60" fill="#0b0c0e"/>`
    + `<g fill="none" stroke="#ef4b3e" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`
}
