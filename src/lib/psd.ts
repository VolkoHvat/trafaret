export interface PsdImage {
  width: number
  height: number
  rgba: Uint8ClampedArray<ArrayBuffer>
}

function assertImageSize(width: number, height: number) {
  if (width < 1 || height < 1 || width > 8192 || height > 8192) throw new Error('Некорректный размер PSD')
}

export function readPsd(bytes: Uint8Array): PsdImage {
  if (bytes.length < 38) throw new Error('Файл PSD слишком короткий')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (signature !== '8BPS' || view.getUint16(4) !== 1) throw new Error('Это не PSD версии 1')
  const channels = view.getUint16(12)
  const height = view.getUint32(14)
  const width = view.getUint32(18)
  const depth = view.getUint16(22)
  const colorMode = view.getUint16(24)
  assertImageSize(width, height)
  if (![3, 4].includes(channels) || depth !== 8 || colorMode !== 3) {
    throw new Error('Поддерживается только flattened RGB/RGBA PSD 8-bit')
  }
  const colorModeLength = view.getUint32(26)
  const resourcesLength = view.getUint32(30)
  const layerMaskLength = view.getUint32(34)
  const dataStart = 38 + colorModeLength + resourcesLength + layerMaskLength
  if (dataStart + 2 > bytes.length) throw new Error('Повреждённый PSD')
  const compression = view.getUint16(dataStart)
  const pixelCount = width * height
  const rgba = new Uint8ClampedArray(pixelCount * 4)
  const planes: Uint8Array[] = []
  let offset = dataStart + 2
  for (let channel = 0; channel < channels; channel++) {
    const plane = new Uint8Array(pixelCount)
    if (compression === 0) {
      if (offset + pixelCount > bytes.length) throw new Error('PSD обрезан')
      plane.set(bytes.subarray(offset, offset + pixelCount))
      offset += pixelCount
    } else if (compression === 1) {
      for (let y = 0; y < height; y++) {
        let x = 0
        const rowStart = y * width
        while (x < width) {
          if (offset >= bytes.length) throw new Error('PSD RLE обрезан')
          const header = bytes[offset++]
          if (header === 128) continue
          if (header <= 127) {
            const count = header + 1
            if (offset + count > bytes.length || x + count > width) throw new Error('Некорректный PSD RLE')
            plane.set(bytes.subarray(offset, offset + count), rowStart + x)
            offset += count
            x += count
          } else {
            const count = 257 - header
            if (offset >= bytes.length || x + count > width) throw new Error('Некорректный PSD RLE')
            plane.fill(bytes[offset++], rowStart + x, rowStart + x + count)
            x += count
          }
        }
      }
    } else throw new Error('Поддерживаются только PSD raw и RLE')
    planes.push(plane)
  }
  for (let i = 0; i < pixelCount; i++) {
    rgba[i * 4] = planes[0][i]
    rgba[i * 4 + 1] = planes[1][i]
    rgba[i * 4 + 2] = planes[2][i]
    rgba[i * 4 + 3] = channels === 4 ? planes[3][i] : 255
  }
  return { width, height, rgba }
}

export function writePsd(image: PsdImage): Uint8Array<ArrayBuffer> {
  const { width, height, rgba } = image
  assertImageSize(width, height)
  if (rgba.length !== width * height * 4) throw new Error('Некорректный буфер RGBA')
  const pixelCount = width * height
  const bytes = new Uint8Array(40 + pixelCount * 4)
  const view = new DataView(bytes.buffer)
  bytes.set([56, 66, 80, 83], 0)
  view.setUint16(4, 1)
  view.setUint16(12, 4)
  view.setUint32(14, height)
  view.setUint32(18, width)
  view.setUint16(22, 8)
  view.setUint16(24, 3)
  view.setUint32(26, 0)
  view.setUint32(30, 0)
  view.setUint32(34, 0)
  view.setUint16(38, 0)
  let offset = 40
  for (let channel = 0; channel < 4; channel++) {
    for (let i = 0; i < pixelCount; i++) bytes[offset + i] = rgba[i * 4 + channel]
    offset += pixelCount
  }
  return bytes
}
