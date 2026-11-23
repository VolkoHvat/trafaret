import type { SelectionModel } from '../types'
import { selectionPath } from './selection'

function rgba(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map(char => char + char).join('') : value
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0]
}

export interface FillBounds { x: number; y: number; width: number; height: number }

// Scanline flood fill over raw RGBA pixels.
// Fills the 4-connected component of pixels that match `target` within `tolerance`
// (per channel, including alpha) and are permitted by `allowed` (null, or a mask
// where alpha 0 blocks the pixel). Matching is evaluated against current pixel
// data, so a replacement color within tolerance of the target keeps the region
// eligible — `visited` guarantees each pixel is processed at most once.
// Returns the bounds of filled pixels, or null when nothing was filled.
export function floodFillData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  replacement: [number, number, number],
  allowed: Uint8ClampedArray | null,
  tolerance: number,
): FillBounds | null {
  if (width <= 0 || height <= 0) return null
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(startX)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(startY)))
  const startIndex = (y0 * width + x0) * 4
  if (allowed && allowed[startIndex + 3] === 0) return null
  const tr = data[startIndex], tg = data[startIndex + 1], tb = data[startIndex + 2], ta = data[startIndex + 3]
  const rr = replacement[0], rg = replacement[1], rb = replacement[2]
  if (tr === rr && tg === rg && tb === rb && ta === 255) return null
  const eligible = (pixel: number) => {
    const index = pixel * 4
    return (!allowed || allowed[index + 3] !== 0)
      && Math.abs(data[index] - tr) <= tolerance
      && Math.abs(data[index + 1] - tg) <= tolerance
      && Math.abs(data[index + 2] - tb) <= tolerance
      && Math.abs(data[index + 3] - ta) <= tolerance
  }
  const visited = new Uint8Array(width * height)
  let stack = new Int32Array(1024)
  let sp = 0
  const push = (pixel: number) => {
    if (sp === stack.length) {
      const grown = new Int32Array(stack.length * 2)
      grown.set(stack)
      stack = grown
    }
    stack[sp++] = pixel
  }
  let minX = x0, minY = y0, maxX = x0, maxY = y0, count = 0
  visited[y0 * width + x0] = 1
  push(y0 * width + x0)
  while (sp > 0) {
    const pixel = stack[--sp]
    if (!eligible(pixel)) continue
    const y = (pixel / width) | 0
    const x = pixel - y * width
    let xl = x
    while (xl > 0 && eligible(pixel - (x - xl) - 1)) xl--
    let xr = x
    while (xr < width - 1 && eligible(pixel + (xr - x) + 1)) xr++
    const row = y * width
    for (let i = xl; i <= xr; i++) {
      visited[row + i] = 1
      const index = (row + i) * 4
      data[index] = rr; data[index + 1] = rg; data[index + 2] = rb; data[index + 3] = 255
    }
    count += xr - xl + 1
    if (xl < minX) minX = xl
    if (xr > maxX) maxX = xr
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    for (let s = 0; s < 2; s++) {
      const yy = s === 0 ? y - 1 : y + 1
      if (yy < 0 || yy >= height) continue
      const below = yy * width
      let i = xl
      while (i <= xr) {
        if (visited[below + i] || !eligible(below + i)) { i++; continue }
        let j = i
        while (j < xr && !visited[below + j + 1] && eligible(below + j + 1)) j++
        for (let k = i; k <= j; k++) visited[below + k] = 1
        push(below + i)
        i = j + 1
      }
    }
  }
  if (!count) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

export function floodFill(canvas: HTMLCanvasElement, startX: number, startY: number, color: string, selection: SelectionModel | null, tolerance = 28) {
  const width = canvas.width, height = canvas.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const image = ctx.getImageData(0, 0, width, height)
  let allowed: Uint8ClampedArray | null = null
  if (selection) {
    const mask = document.createElement('canvas')
    mask.width = width; mask.height = height
    const mctx = mask.getContext('2d', { willReadFrequently: true })!
    const path = selectionPath(selection)
    if (selection.inverse) {
      const inverse = new Path2D()
      inverse.rect(0, 0, width, height)
      inverse.addPath(path)
      mctx.fill(inverse, 'evenodd')
    } else mctx.fill(path)
    allowed = mctx.getImageData(0, 0, width, height).data
  }
  const bounds = floodFillData(image.data, width, height, startX, startY, rgba(color), allowed, tolerance)
  if (!bounds) return null
  ctx.putImageData(image, 0, 0)
  return bounds
}
