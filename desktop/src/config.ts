import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface DesktopSyncConfig {
  clientId: string
  /** Google требует secret для типа «Web application»; для «Desktop» можно оставить пустым. */
  clientSecret: string
}

export const EMPTY_CONFIG: DesktopSyncConfig = { clientId: '', clientSecret: '' }

/** Чистое слияние произвольного JSON с конфигом — покрыто тестами. */
export function parseConfig(raw: unknown): DesktopSyncConfig {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CONFIG }
  const value = raw as Record<string, unknown>
  return {
    clientId: typeof value.clientId === 'string' ? value.clientId.trim() : '',
    clientSecret: typeof value.clientSecret === 'string' ? value.clientSecret.trim() : '',
  }
}

export function isConfigComplete(config: DesktopSyncConfig): boolean {
  return Boolean(config.clientId)
}

/** Безопасный для логов вид конфигурации — секрет никогда не попадает в логи. */
export function describeConfig(config: DesktopSyncConfig): string {
  const id = config.clientId ? `${config.clientId.slice(0, 8)}…(${config.clientId.length})` : '—'
  return `clientId=${id} clientSecret=${config.clientSecret ? '<задан>' : '<нет>'}`
}

export class ConfigStore {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load(): Promise<DesktopSyncConfig> {
    try {
      return parseConfig(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch {
      return { ...EMPTY_CONFIG }
    }
  }

  async save(config: DesktopSyncConfig): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(config, null, 2), { mode: 0o600 })
  }
}

export function defaultConfigPath(userDataDir: string): string {
  return join(userDataDir, 'sync-config.json')
}
