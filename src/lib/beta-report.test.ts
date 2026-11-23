import { describe, expect, it } from 'vitest'
import { buildBetaReport } from './beta-report'

describe('beta report bundle', () => {
  it('exports only opted-in local entries and a SHA-256 manifest', async () => {
    const report = await buildBetaReport('Линия на краю поля', { localExport: true, diagnostics: true }, {
      diagnostics: () => ({ browser: 'chrome', platform: 'windows-11', input: 'pen' }),
      preview: () => new Blob(['must not be called']),
    })
    const bytes = new Uint8Array(await report.arrayBuffer())
    expect(report.type).toBe('application/zip')
    expect(new TextDecoder().decode(bytes)).toContain('feedback.txt')
    expect(new TextDecoder().decode(bytes)).toContain('diagnostics.json')
    expect(new TextDecoder().decode(bytes)).not.toContain('preview.png')
    expect(new TextDecoder().decode(bytes)).toContain('manifest.json')
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
  })

  it('does not read unselected private sources', async () => {
    const forbidden = () => { throw Error('private source accessed') }
    await expect(buildBetaReport('ok', { localExport: true }, { voice: forbidden, screen: forbidden, diagnostics: forbidden })).resolves.toBeInstanceOf(Blob)
  })

  it('rejects missing, wrong-kind and oversized media before packing', async () => {
    const consent = { localExport: true, voice: true }
    await expect(buildBetaReport('', consent)).rejects.toThrow('Нет выбранного')
    for (const blob of [new Blob(['video'], { type: 'video/webm' }), new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'audio/webm' })]) {
      await expect(buildBetaReport('', consent, { voice: () => blob })).rejects.toThrow('формат')
    }
    await expect(buildBetaReport('я'.repeat(32769), { localExport: true })).rejects.toThrow('64 КиБ')
  })

  it('requires explicit consent and rejects empty feedback', async () => {
    await expect(buildBetaReport('ok', { localExport: false })).rejects.toThrow('Не подтверждено')
    await expect(buildBetaReport('  ', { localExport: true })).rejects.toThrow('текст отзыва')
  })
})
