import { describe, expect, it } from 'vitest'
import { isAllowedNavigation } from './navigation'

const APP = '/opt/trafaret'
const allowlist = { appPath: APP, devOrigin: null as string | null }

describe('isAllowedNavigation', () => {
  it('разрешает только конкретный dist/index.html приложения', () => {
    expect(isAllowedNavigation(`file://${APP}/dist/index.html`, allowlist)).toBe(true)
    expect(isAllowedNavigation('file:///etc/passwd', allowlist)).toBe(false)
    expect(isAllowedNavigation('file:///opt/trafaret/dist/../secrets.json', allowlist)).toBe(false)
    expect(isAllowedNavigation('file:///opt/other-app/dist/index.html', allowlist)).toBe(false)
    expect(isAllowedNavigation('file:///opt/trafaret/dist/index.html#stroke', allowlist)).toBe(true)
  })

  it('разрешает dev origin и запрещает прочие http(s)', () => {
    const dev = { appPath: APP, devOrigin: 'http://localhost:3000' }
    expect(isAllowedNavigation('http://localhost:3000/pages/main', dev)).toBe(true)
    expect(isAllowedNavigation('http://localhost:3000.evil.example/', dev)).toBe(false)
    expect(isAllowedNavigation('https://accounts.google.com/', dev)).toBe(false)
    expect(isAllowedNavigation('file:///etc/passwd', dev)).toBe(false)
  })

  it('отсекает UNC/host в file URL, мусор и не-file протоколы', () => {
    expect(isAllowedNavigation('file://server/share/index.html', allowlist)).toBe(false)
    expect(isAllowedNavigation('javascript:alert(1)', allowlist)).toBe(false)
    expect(isAllowedNavigation('not a url', allowlist)).toBe(false)
  })
})
