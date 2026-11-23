import type { SelectionModel } from '../types'

export function selectionPath(selection: SelectionModel) {
  const path = new Path2D()
  const [a, b] = selection.points
  if (!a) return path
  if (selection.kind === 'lasso') {
    selection.points.forEach((point, index) => index ? path.lineTo(point[0], point[1]) : path.moveTo(point[0], point[1]))
    path.closePath()
  } else if (b) {
    if (selection.kind === 'rectangle') path.rect(a[0], a[1], b[0] - a[0], b[1] - a[1])
    else path.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2)
  }
  return path
}

export function clipToSelection(ctx: CanvasRenderingContext2D, selection: SelectionModel | null, width: number, height: number) {
  if (!selection) return
  const path = selectionPath(selection)
  if (selection.inverse) {
    const inverse = new Path2D()
    inverse.rect(0, 0, width, height)
    inverse.addPath(path)
    ctx.clip(inverse, 'evenodd')
  } else ctx.clip(path)
}

export function selectionSvgPath(selection: SelectionModel, width: number, height: number) {
  const [a, b] = selection.points
  let d = ''
  if (selection.kind === 'lasso') {
    d = selection.points.map((point, index) => `${index ? 'L' : 'M'}${point[0]},${point[1]}`).join(' ') + ' Z'
  } else if (a && b && selection.kind === 'rectangle') {
    d = `M${a[0]},${a[1]} H${b[0]} V${b[1]} H${a[0]} Z`
  } else if (a && b) {
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2
    const rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2
    const points = Array.from({ length: 73 }, (_, index) => {
      const angle = index * Math.PI * 2 / 72
      return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]
    })
    d = points.map((point, index) => `${index ? 'L' : 'M'}${point[0]},${point[1]}`).join(' ') + ' Z'
  }
  return selection.inverse ? `M0,0 H${width} V${height} H0 Z ${d}` : d
}

export function selectionBounds(selection: SelectionModel) {
  const xs = selection.points.map(point => point[0])
  const ys = selection.points.map(point => point[1])
  return {
    minX: Math.min(...xs), minY: Math.min(...ys),
    maxX: Math.max(...xs), maxY: Math.max(...ys),
  }
}

export function drawSelectionOutline(ctx: CanvasRenderingContext2D, selection: SelectionModel, zoom: number) {
  ctx.save()
  ctx.strokeStyle = '#171914'
  ctx.lineWidth = 3 / zoom
  ctx.setLineDash([8 / zoom, 6 / zoom])
  ctx.stroke(selectionPath(selection))
  ctx.strokeStyle = '#fbfda4'
  ctx.lineWidth = 1.5 / zoom
  ctx.stroke(selectionPath(selection))
  ctx.restore()
}
