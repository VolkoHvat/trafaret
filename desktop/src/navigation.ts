import { join, normalize } from 'node:path'

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
  const target = normalize(decodeURIComponent(parsed.pathname))
  const expected = normalize(join(allowed.appPath, 'dist', 'index.html'))
  return target === expected
}
