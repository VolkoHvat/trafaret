import { posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface NavigationAllowlist {
  /** Путь к корню приложения (app.getAppPath()); index.html ищется в dist/. */
  appPath: string
  /** Origin vite dev-сервера для неупакованного запуска; null в production. */
  devOrigin: string | null
}

/**
 * Allowlist навигации окна: разрешены только собственный dist/index.html
 * и (в dev) origin vite dev-сервера. Произвольный file://, UNC-пути и любые
 * другие origin — запрещены.
 */
export function isAllowedNavigation(url: string, allowed: NavigationAllowlist): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (allowed.devOrigin && parsed.origin === allowed.devOrigin) return true
  if (parsed.protocol !== 'file:') return false
  if (parsed.host !== '') return false
  if (parsed.pathname.startsWith('//')) return false
  const windows = /^[A-Za-z]:[\\/]/.test(allowed.appPath)
  if (!windows && !allowed.appPath.startsWith('/')) return false
  const expected = (windows ? win32 : posix).join(allowed.appPath, 'dist', 'index.html')
  try {
    return fileURLToPath(parsed, { windows }) === expected
  } catch {
    return false
  }
}
