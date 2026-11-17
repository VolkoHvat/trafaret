import type { SelectionModel } from '../types'
import { selectionPath } from './selection'

function rgba(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map(char => char + char).join('') : value
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0]
}

export function floodFill(canvas: HTMLCanvasElement, startX: number, startY: number, color: string, selection: SelectionModel | null, tolerance = 28) {
  const width = canvas.width, height = canvas.height
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(startX)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(startY)))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
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
  const startIndex = (y0 * width + x0) * 4
  if (allowed && allowed[startIndex + 3] === 0) return null
  const target = [data[startIndex], data[startIndex + 1], data[startIndex + 2], data[startIndex + 3]]
  const replacement = rgba(color)
  if (target[0] === replacement[0] && target[1] === replacement[1] && target[2] === replacement[2] && target[3] === 255) return null
  const matches = (index: number) => Math.abs(data[index] - target[0]) <= tolerance && Math.abs(data[index + 1] - target[1]) <= tolerance && Math.abs(data[index + 2] - target[2]) <= tolerance && Math.abs(data[index + 3] - target[3]) <= tolerance
  const visited = new Uint8Array(width * height)
  const stack = [y0 * width + x0]
  let minX = x0, minY = y0, maxX = x0, maxY = y0, count = 0
  while (stack.length) {
    const pixel = stack.pop()!
    if (visited[pixel]) continue
    visited[pixel] = 1
    const index = pixel * 4
    if ((allowed && allowed[index + 3] === 0) || !matches(index)) continue
    data[index] = replacement[0]; data[index + 1] = replacement[1]; data[index + 2] = replacement[2]; data[index + 3] = 255
    const x = pixel % width, y = Math.floor(pixel / width)
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    count++
    if (x > 0) stack.push(pixel - 1)
    if (x < width - 1) stack.push(pixel + 1)
    if (y > 0) stack.push(pixel - width)
    if (y < height - 1) stack.push(pixel + width)
  }
  if (!count) return null
  ctx.putImageData(image, 0, 0)
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}
