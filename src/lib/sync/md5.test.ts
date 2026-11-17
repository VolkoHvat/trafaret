import { describe, expect, it } from 'vitest'
import { md5Hex } from './md5'

describe('md5Hex', () => {
  it('считает контрольные векторы RFC 1321', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5Hex('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6')
  })

  it('считает md5 для UTF-8 строк и байтов одинаково', () => {
    expect(md5Hex('Трафарет')).toBe(md5Hex(new TextEncoder().encode('Трафарет')))
  })

  it('различает похожие строки проектов', () => {
    expect(md5Hex('{"revision":1}')).not.toBe(md5Hex('{"revision":2}'))
  })
})
