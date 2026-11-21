import type { EnergyInputSample } from './input-energy.ts'

export interface ArtworkPath {
  points: [number, number][]
  pressure: number
  closed: boolean
}

const path = (points: [number, number][], pressure = 0.55, closed = false): ArtworkPath => ({ points, pressure, closed })

export function wyvernPaths(): ArtworkPath[] {
  const paths: ArtworkPath[] = [
    path([[44, 10], [39, 14], [39, 20], [44, 25], [53, 29], [57, 36], [51, 42], [40, 44], [32, 48], [32, 53], [39, 56], [49, 54], [53, 50], [46, 49], [41, 51], [39, 50], [43, 47], [52, 44], [61, 38], [60, 29], [50, 23], [47, 18], [49, 13], [44, 10]], 0.9, true),
    path([[38, 7], [41, 4], [46, 4], [49, 7], [53, 8], [52, 11], [47, 12], [43, 11], [40, 14], [37, 11], [36, 8], [38, 7]], 0.85, true),
    path([[46, 7], [52, 6], [57, 8], [54, 10], [49, 10]], 0.65),
    path([[52, 10], [50, 14], [45, 14], [42, 12]], 0.7),
    path([[41, 5], [38, 1], [43, 4]], 0.6),
    path([[46, 4], [48, 1], [49, 5]], 0.6),
    path([[44, 7], [46, 6], [47, 7], [45, 8], [44, 7]], 0.75, true),
    path([[45, 7], [45, 8]], 0.9),
    path([[53, 8], [54, 8]], 0.9),
    path([[50, 10], [49, 12], [48, 10], [47, 12], [46, 10]], 0.5),
    path([[43, 22], [33, 17], [24, 9], [15, 3], [18, 12], [10, 10], [14, 21], [7, 22], [18, 30], [14, 33], [28, 32], [37, 27], [43, 22]], 0.85, true),
    path([[43, 22], [33, 15], [24, 9], [15, 3]], 0.55),
    path([[41, 23], [29, 18], [18, 12], [10, 10]], 0.45),
    path([[40, 24], [27, 23], [14, 21], [7, 22]], 0.45),
    path([[39, 26], [27, 29], [18, 30], [14, 33]], 0.45),
    path([[35, 18], [31, 24], [28, 32]], 0.35),
    path([[28, 13], [24, 21], [18, 30]], 0.35),
    path([[51, 25], [61, 18], [72, 9], [83, 4], [79, 15], [89, 12], [84, 23], [91, 24], [80, 31], [84, 35], [69, 33], [59, 28], [51, 25]], 0.85, true),
    path([[51, 25], [61, 16], [72, 9], [83, 4]], 0.55),
    path([[54, 26], [66, 19], [79, 15], [89, 12]], 0.45),
    path([[56, 27], [69, 24], [84, 23], [91, 24]], 0.45),
    path([[58, 29], [70, 30], [80, 31], [84, 35]], 0.45),
    path([[61, 18], [65, 25], [69, 33]], 0.35),
    path([[72, 12], [75, 22], [80, 31]], 0.35),
    path([[43, 41], [37, 42], [32, 39], [27, 39], [24, 42], [25, 47], [21, 50], [23, 52], [28, 49], [30, 46], [36, 47], [41, 45]], 0.75),
    path([[21, 50], [18, 53], [22, 52]], 0.55),
    path([[23, 52], [23, 54], [26, 51]], 0.55),
    path([[28, 49], [29, 52], [31, 49]], 0.55),
    path([[53, 40], [59, 40], [64, 37], [69, 38], [71, 42], [69, 46], [73, 49], [71, 51], [66, 48], [64, 45], [58, 46], [54, 44]], 0.75),
    path([[73, 49], [76, 52], [72, 51]], 0.55),
    path([[71, 51], [71, 54], [68, 50]], 0.55),
    path([[66, 48], [65, 51], [63, 48]], 0.55),
    path([[39, 51], [31, 53], [25, 56], [27, 59], [36, 59], [41, 56]], 0.7),
    path([[27, 59], [22, 57], [23, 53], [28, 55], [32, 59], [27, 59]], 0.65, true),
    path([[42, 26], [45, 28], [43, 30]], 0.35),
    path([[46, 29], [49, 31], [47, 33]], 0.35),
    path([[48, 33], [51, 35], [48, 37]], 0.35),
    path([[46, 38], [48, 40], [44, 41]], 0.35),
    path([[36, 45], [38, 47], [35, 48]], 0.35),
    path([[35, 52], [38, 53], [36, 55]], 0.35),
    path([[3, 44], [5, 40], [11, 39], [15, 42], [13, 45], [9, 45], [9, 42], [11, 42]], 0.3),
    path([[0, 47], [8, 47], [16, 47], [20, 45]], 0.3),
    path([[2, 50], [10, 50], [18, 49]], 0.3),
    path([[68, 52], [73, 49], [79, 50], [82, 54], [79, 56], [75, 55], [76, 52], [78, 52]], 0.3),
    path([[66, 57], [74, 57], [84, 56], [90, 53]], 0.3),
  ]
  const scales: [number, number][] = [
    [42, 17], [43, 20], [46, 23], [50, 26], [53, 30], [54, 34], [52, 38], [48, 41],
    [43, 43], [39, 45], [36, 47], [35, 50], [38, 53], [43, 53],
  ]
  for (const [x, y] of scales) paths.push(path([[x - 1, y], [x, y + 1], [x + 1, y]], 0.28))
  for (let x = -4; x < 96; x += 12) {
    paths.push(path([[x, 57], [x + 3, 54], [x + 6, 57], [x + 9, 54], [x + 12, 57]], 0.22))
    paths.push(path([[x + 3, 54], [x + 4, 52], [x + 6, 52], [x + 7, 54]], 0.18))
  }
  const petals: [number, number][] = [[69, 43], [78, 39], [85, 46], [61, 49], [88, 33]]
  for (const [x, y] of petals) {
    paths.push(path([[x - 1, y], [x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]], 0.22, true))
  }
  return paths
}

export function sampleArtworkPath(path: ArtworkPath) {
  const source = path.closed ? [...path.points, path.points[0]] : path.points
  const samples: [number, number][] = [source[0]]
  for (let index = 0; index + 1 < source.length; index++) {
    const p0 = source[Math.max(0, index - 1)], p1 = source[index], p2 = source[index + 1]
    const p3 = source[Math.min(source.length - 1, index + 2)]
    const parts = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.55))
    for (let part = 1; part <= parts; part++) {
      const t = part / parts, t2 = t * t, t3 = t2 * t
      const coordinate = (a: number, b: number, c: number, d: number) => 0.5
        * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      samples.push([coordinate(p0[0], p1[0], p2[0], p3[0]), coordinate(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  return samples
}

export function wyvernSvg() {
  const paths = wyvernPaths().map(path => {
    const points = sampleArtworkPath(path)
    const d = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
      + (path.closed ? ' Z' : '')
    return `<path d="${d}" stroke-width="${(0.08 + path.pressure * 0.16).toFixed(3)}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 96 60">`
    + `<title>Виверна на спину — западный дракон в японской композиции</title>`
    + `<desc>Авторский линворк: рога, крылья, две задние лапы, змеевидное тело, облака и волны.</desc>`
    + `<rect width="96" height="60" fill="#0b0c0e"/>`
    + `<g fill="none" stroke="#e8e0d8" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`
}

export function wyvernSamples(): EnergyInputSample[] {
  const samples: EnergyInputSample[] = []
  let time = 0
  for (const path of wyvernPaths()) {
    for (const [x, y] of sampleArtworkPath(path)) {
      samples.push({ x, y, time, pressure: path.pressure, pointerType: 'pen' })
      time += 0.006
    }
  }
  return samples
}
