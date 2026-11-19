import type { DocModel, LayerModel } from '../types'
import { writeIccProfile, type ColorProfile } from './icc'
import { vectorObjectClipDefs, vectorObjectToSvg } from './vector'

let crcTable: Uint32Array | undefined
function crc32(bytes: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let value = n
      for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      crcTable[n] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Adds a standard PNG pHYs chunk so physical print dimensions survive export. */
export async function withPngDpi(blob: Blob, dpi: number) {
  const source = new Uint8Array(await blob.arrayBuffer())
  if (source.length < 33 || source[0] !== 137 || source[1] !== 80) return blob
  const pixelsPerMetre = Math.round(clampNumber(dpi, 72, 1200) / 0.0254)
  const chunk = new Uint8Array(21)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, 9)
  chunk.set([112, 72, 89, 115], 4)
  view.setUint32(8, pixelsPerMetre)
  view.setUint32(12, pixelsPerMetre)
  chunk[16] = 1
  view.setUint32(17, crc32(chunk.subarray(4, 17)))
  return new Blob([source.subarray(0, 33), chunk, source.subarray(33)], { type: 'image/png' })
}

export async function withPngIccProfile(blob: Blob, profile: ColorProfile) {
  const source = new Uint8Array(await blob.arrayBuffer())
  if (source.length < 33 || source[0] !== 137 || source[1] !== 80) return blob
  const icc = writeIccProfile(profile)
  const name = profile === 'srgb' ? 'sRGB' : 'Display P3'
  const data = new Uint8Array(1 + name.length + 1 + icc.length)
  data.set([...asciiBytes(name), 0, 0, ...icc], 0)
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set([105, 67, 67, 80], 4)
  chunk.set(data, 8)
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return new Blob([source.subarray(0, 33), chunk, source.subarray(33)], { type: 'image/png' })
}

function asciiBytes(value: string) {
  return Array.from(value, character => character.charCodeAt(0))
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
}

export function makeVectorSvg(doc: DocModel, layers: LayerModel[]) {
  const vectorLayers = layers.filter(layer => layer.visible && layer.kind === 'vector' && layer.objects?.length)
  const groups = vectorLayers.map(layer => {
    const paths = layer.objects!.map(object => vectorObjectToSvg(object)).join('\n')
    return `<g id="${escapeXml(layer.name)}" opacity="${layer.opacity}">\n${paths}\n</g>`
  })
  const defs = vectorLayers.flatMap(layer => layer.objects!).map(object => vectorObjectClipDefs(object, doc.width, doc.height)).filter(Boolean).join('\n')
  const widthMm = (doc.width / doc.dpi * 25.4).toFixed(3)
  const heightMm = (doc.height / doc.dpi * 25.4).toFixed(3)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${doc.width} ${doc.height}">\n<title>${escapeXml(doc.title)}</title>\n${defs ? `<defs>\n${defs}\n</defs>\n` : ''}${groups.join('\n')}\n</svg>`
}

export async function blobToImageData(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return { canvas, ctx, image: ctx.getImageData(0, 0, canvas.width, canvas.height) }
}

export async function withGrayscale(blob: Blob): Promise<Blob> {
  const { canvas, ctx, image } = await blobToImageData(blob)
  for (let i = 0; i < image.data.length; i += 4) {
    const gray = image.data[i] * 0.2126 + image.data[i + 1] * 0.7152 + image.data[i + 2] * 0.0722
    image.data[i] = gray
    image.data[i + 1] = gray
    image.data[i + 2] = gray
  }
  ctx.putImageData(image, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob(
    value => value ? resolve(value) : reject(new Error('Не удалось подготовить grayscale PNG')),
    'image/png',
  ))
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
