// RLE-compressed raster history payloads.
//
// 'pixel-rle' format (pixel-oriented, PackBits-like; counts RGBA pixels):
//   header byte 0..127   -> literal block: (header + 1) pixels follow as exact 4-byte groups
//   header byte 129..255 -> run block: next 4 bytes are one pixel repeated (257 - header) times
//                           (run length 2..128 pixels)
//   header byte 128      -> unused, never emitted
// Longer runs/literals are split into consecutive blocks, so any input is encodable.
// Every RGBA value round-trips exactly because runs store the pixel's 4 literal bytes.
//
// 'rle' is the legacy byte-oriented format; decoding support is kept for old entries.
//
// If the encoded stream is not smaller than the raw pixel bytes, the entry is
// stored as 'raw' and the original bytes are kept by reference (no extra copy).

export interface EncodedRaster {
  encoding: 'rle' | 'pixel-rle' | 'raw'
  width: number
  height: number
  bytes: Uint8Array
}

export interface Rect { x: number; y: number; width: number; height: number }

export interface RasterHistoryEntry {
  kind: 'raster'
  layerId: string
  channel: 'content' | 'mask'
  rect: Rect
  before: EncodedRaster
  after: EncodedRaster
  cost: number
}

const HEADER_BYTES_PER_BLOCK = 1
const MAX_LITERAL = 128
const MAX_RUN = 128

function pixelsEqual(data: Uint8ClampedArray | Uint8Array, a: number, b: number) {
  const ao = a * 4, bo = b * 4
  return data[ao] === data[bo] && data[ao + 1] === data[bo + 1]
    && data[ao + 2] === data[bo + 2] && data[ao + 3] === data[bo + 3]
}

export function encodeRasterData(data: Uint8ClampedArray | Uint8Array, width: number, height: number): EncodedRaster {
  const length = data.length
  if (width <= 0 || height <= 0 || length !== width * height * 4) {
    throw new Error(`invalid raster dimensions ${width}x${height} for ${length} bytes`)
  }
  const pixelCount = width * height
  // Worst case: all literals, one header per MAX_LITERAL pixels. Start small and
  // grow on demand so compressible inputs never retain the worst-case buffer.
  const worst = pixelCount * 4 + Math.ceil(pixelCount / MAX_LITERAL) * HEADER_BYTES_PER_BLOCK
  let out = new Uint8Array(Math.min(worst, 64 * 1024))
  let outLen = 0
  const ensure = (needed: number) => {
    if (needed <= out.length) return
    let capacity = out.length
    while (capacity < needed) capacity *= 2
    const grown = new Uint8Array(capacity)
    grown.set(out.subarray(0, outLen))
    out = grown
  }
  let i = 0
  while (i < pixelCount) {
    const offset = i * 4
    let run = 1
    while (i + run < pixelCount && run < MAX_RUN && pixelsEqual(data, i, i + run)) run++
    if (run >= 2) {
      ensure(outLen + HEADER_BYTES_PER_BLOCK + 4)
      out[outLen++] = 257 - run
      out[outLen++] = data[offset]
      out[outLen++] = data[offset + 1]
      out[outLen++] = data[offset + 2]
      out[outLen++] = data[offset + 3]
      i += run
      continue
    }
    let literalStart = i
    i++
    while (i < pixelCount) {
      let nextRun = 1
      while (i + nextRun < pixelCount && nextRun < MAX_RUN && pixelsEqual(data, i, i + nextRun)) nextRun++
      if (nextRun >= 2 || i - literalStart >= MAX_LITERAL) break
      i++
    }
    let literalLen = i - literalStart
    while (literalLen > 0) {
      const chunk = Math.min(literalLen, MAX_LITERAL)
      ensure(outLen + HEADER_BYTES_PER_BLOCK + chunk * 4)
      out[outLen++] = chunk - 1
      out.set(data.subarray(literalStart * 4, (literalStart + chunk) * 4), outLen)
      outLen += chunk * 4
      literalStart += chunk
      literalLen -= chunk
    }
  }
  if (outLen >= length) {
    // RLE did not help: keep raw bytes without copying.
    return { encoding: 'raw', width, height, bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
  }
  return { encoding: 'pixel-rle', width, height, bytes: out.slice(0, outLen) }
}

export function decodeRasterData(encoded: EncodedRaster): Uint8ClampedArray<ArrayBuffer> {
  const length = encoded.width * encoded.height * 4
  const out = new Uint8ClampedArray(length)
  if (encoded.encoding === 'raw') {
    out.set(encoded.bytes.subarray(0, length))
    return out
  }
  const bytes = encoded.bytes
  let i = 0, outPos = 0
  if (encoded.encoding === 'rle') {
    // Legacy byte-oriented stream: counts are in bytes, not pixels.
    while (i < bytes.length) {
      const header = bytes[i++]
      if (header < MAX_LITERAL) {
        const count = header + 1
        out.set(bytes.subarray(i, i + count), outPos)
        i += count
        outPos += count
      } else {
        const count = 257 - header
        out.fill(bytes[i++], outPos, outPos + count)
        outPos += count
      }
    }
    if (outPos !== length) throw new Error(`RLE payload decoded to ${outPos} bytes, expected ${length}`)
    return out
  }
  if (encoded.encoding !== 'pixel-rle') throw new Error(`unknown raster encoding ${String(encoded.encoding)}`)
  while (i < bytes.length) {
    const header = bytes[i++]
    if (header < MAX_LITERAL) {
      const count = (header + 1) * 4
      out.set(bytes.subarray(i, i + count), outPos)
      i += count
      outPos += count
    } else {
      const count = 257 - header
      const b0 = bytes[i++], b1 = bytes[i++], b2 = bytes[i++], b3 = bytes[i++]
      for (let k = 0; k < count; k++) {
        out[outPos] = b0
        out[outPos + 1] = b1
        out[outPos + 2] = b2
        out[outPos + 3] = b3
        outPos += 4
      }
    }
  }
  if (outPos !== length) throw new Error(`RLE payload decoded to ${outPos} bytes, expected ${length}`)
  return out
}

export function encodeRaster(image: ImageData): EncodedRaster {
  return encodeRasterData(image.data, image.width, image.height)
}

export function decodeRasterImage(encoded: EncodedRaster): ImageData {
  return new ImageData(decodeRasterData(encoded), encoded.width, encoded.height)
}

// Byte budget: MAX_HISTORY_PIXELS * 8 bytes of raw pixels per raster entry
// (before + after, 4 bytes each). Cost is charged in units of 8 encoded bytes,
// so the effective byte budget is unchanged by compression.
export function rasterCost(before: EncodedRaster, after: EncodedRaster): number {
  return Math.ceil((before.bytes.byteLength + after.bytes.byteLength) / 8)
}

export function makeRasterHistoryEntry(input: {
  layerId: string
  channel: 'content' | 'mask'
  rect: Rect
  before: ImageData
  after: ImageData
}): RasterHistoryEntry {
  const before = encodeRaster(input.before)
  const after = encodeRaster(input.after)
  return {
    kind: 'raster', layerId: input.layerId, channel: input.channel, rect: input.rect,
    before, after, cost: rasterCost(before, after),
  }
}

// Evicts entries from the front while over budget, always keeping at least one.
// Mutates `entries` and returns the remaining total cost.
export function evictOverBudget<T extends { cost: number }>(entries: T[], budget: number, size: number): number {
  let total = size
  while (total > budget && entries.length > 1) {
    const removed = entries.shift()!
    total -= removed.cost
  }
  return total
}

export function historyCost<T extends { cost: number }>(...stacks: T[][]): number {
  return stacks.reduce((total, entries) => total + entries.reduce((sum, entry) => sum + entry.cost, 0), 0)
}

export function pushHistoryEntry<T extends { cost: number }>(entries: T[], redo: T[], entry: T, budget: number): number {
  const size = historyCost(entries) + entry.cost
  entries.push(entry)
  redo.length = 0
  return evictOverBudget(entries, budget, size)
}
