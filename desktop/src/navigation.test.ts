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

  it('разрешает переход в основную студию только внутри собственного Windows-пакета', () => {
    const app = { appPath: 'C:\\Program Files\\Трафарет\\resources\\app.asar', devOrigin: null }
    const entry = new URL('file:///C:/Program%20Files/Трафарет/resources/app.asar/dist/index.html')
    expect(isAllowedNavigation(`${entry.href}?field=2048`, app)).toBe(true)
    for (const other of [
      entry.href.replace('/C:', '/D:'),
      entry.href.replace('/app.asar/', '/other.asar/'),
      entry.href.replace('file:///', 'file://server/'),
      entry.href.replace('file:///', 'file:////server/'),
      entry.href.replace('/index.html', '%5Cindex.html'),
      entry.href.replace('/index.html', '/%ZZ'),
    ]) expect(isAllowedNavigation(other, app)).toBe(false)
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
