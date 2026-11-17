import { describe, expect, it } from 'vitest'
import { escapeHtml } from './auth-service'

describe('escapeHtml', () => {
  it('экранирует символы, опасные для HTML', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(escapeHtml(`a"b'c&d`)).toBe('a&quot;b&#39;c&amp;d')
  })

  it('не трогает безопасный текст', () => {
    expect(escapeHtml('Google вернул ошибку: access_denied')).toBe('Google вернул ошибку: access_denied')
  })
})
