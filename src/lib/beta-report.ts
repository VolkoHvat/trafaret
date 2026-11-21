const encoder = new TextEncoder()
const MiB = 1024 * 1024
const slots = ['diagnostics', 'workspace', 'gesture', 'preview', 'voice', 'screen'] as const
type Slot = typeof slots[number]
export type BetaReportConsent = { localExport: boolean } & Partial<Record<Slot, boolean>>
export type BetaDiagnostics = {
  browser: 'edge' | 'chrome' | 'firefox' | 'other' | 'unknown'
  platform: 'windows-11' | 'android' | 'other' | 'unknown'
  input: 'pen' | 'touch' | 'mouse' | 'unknown'
}
/** Sources run only for selected entries. Workspace, gesture and preview must be trusted
 * exports without references or tiles; voice and screen may be user-selected media. */
export type BetaReportSources = {
  voice?: () => Blob
  screen?: () => Blob
  diagnostics?: () => BetaDiagnostics
  workspace?: () => Blob | Promise<Blob>
  gesture?: () => Blob | Promise<Blob>
  preview?: () => Blob | Promise<Blob>
}
const files = { workspace: ['workspace.tfw', 40 * MiB], gesture: ['gesture.json', MiB], preview: ['preview.png', 18 * MiB] } as const
export type ReportMedia = 'voice' | 'screen'
export const mediaLimits = { voice: 5 * MiB, screen: 20 * MiB }
export const mediaFormats = { voice: { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }, screen: { 'video/webm': 'webm', 'video/mp4': 'mp4' } }
export function mediaName(kind: ReportMedia, blob: Blob) {
  const type = blob.type.toLowerCase().split(';')[0]
  const ext = Object.entries(mediaFormats[kind]).find(([mime]) => mime === type)?.[1]
  if (!ext || !blob.size || blob.size > mediaLimits[kind]) throw Error('Неподдерживаемый формат, пустой файл или превышен лимит размера')
  return `${kind}.${ext}`
}
const json = (value: unknown) => encoder.encode(JSON.stringify(value, null, 2))
type Entry = { name: string; bytes: Uint8Array<ArrayBuffer> }

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0)
  return n >>> 0
})

// ZIP32 STORE: fixed ASCII paths, no extras/comments, DOS date 1980-01-01.
function zip(entries: Entry[]) {
  const local: BlobPart[] = [], directory: BlobPart[] = []
  let offset = 0, directorySize = 0
  for (const { name, bytes } of entries) {
    let crc = 0xffffffff
    for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8)
    const path = encoder.encode(name), header = new DataView(new ArrayBuffer(30)), central = new DataView(new ArrayBuffer(46))
    header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(12, 33, true)
    header.setUint32(14, ~crc, true); header.setUint32(18, bytes.length, true); header.setUint32(22, bytes.length, true); header.setUint16(26, path.length, true)
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true)
    central.setUint16(14, 33, true)
    central.setUint32(16, ~crc, true); central.setUint32(20, bytes.length, true); central.setUint32(24, bytes.length, true)
    central.setUint16(28, path.length, true); central.setUint32(42, offset, true)
    local.push(header.buffer, path, bytes); directory.push(central.buffer, path)
    offset += 30 + path.length + bytes.length; directorySize += 46 + path.length
  }
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true)
  end.setUint32(12, directorySize, true); end.setUint32(16, offset, true)
  return new Blob([...local, ...directory, end.buffer], { type: 'application/zip' })
}

export async function buildBetaReport(feedback: string, consent: BetaReportConsent, sources: BetaReportSources = {}): Promise<Blob> {
  if (consent?.localExport !== true) throw Error('Не подтверждено создание локального отчёта')
  if (typeof feedback !== 'string' || feedback.length > 65536 || (!feedback.trim() && consent.voice !== true)) throw Error('Нужен текст отзыва до 64 КиБ')
  const bytes = encoder.encode(feedback)
  if (bytes.length > 65536) throw Error('Отзыв больше 64 КиБ')
  const entries: Entry[] = feedback.trim() ? [{ name: 'feedback.txt', bytes }] : []
  const selected = slots.filter(key => consent[key] === true)
  for (const key of selected) {
    if (key === 'diagnostics') {
      const d = sources.diagnostics?.()
      if (!d || !['edge', 'chrome', 'firefox', 'other', 'unknown'].includes(d.browser) || !['windows-11', 'android', 'other', 'unknown'].includes(d.platform) || !['pen', 'touch', 'mouse', 'unknown'].includes(d.input)) throw Error('Недопустимая диагностика')
      entries.push({ name: 'diagnostics.json', bytes: json({ browser: d.browser, platform: d.platform, input: d.input }) })
    } else if (key === 'voice' || key === 'screen') {
      const blob = sources[key]?.()
      if (!(blob instanceof Blob)) throw Error('Нет выбранного медиа')
      entries.push({ name: mediaName(key, blob), bytes: new Uint8Array(await blob.arrayBuffer()) })
    } else {
      const blob = await sources[key]?.(), [name, limit] = files[key]
      if (!(blob instanceof Blob) || !blob.size || blob.size > limit) throw Error(`Вложение отсутствует или превышает лимит: ${name}`)
      entries.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) })
    }
  }
  const inventory = []
  for (const { name, bytes } of entries) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    inventory.push({ name, size: bytes.length, sha256: Array.from(digest, b => b.toString(16).padStart(2, '0')).join('') })
  }
  entries.push({ name: 'manifest.json', bytes: json({ format: 'trafaret-beta-report', version: 1, consent: { localExport: true, selected }, files: inventory }) })
  return zip(entries)
}
