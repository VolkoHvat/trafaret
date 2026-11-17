import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface StoredTokens {
  refreshToken: string
}

export interface SecureStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Uint8Array
  decryptString(buffer: Uint8Array): string
}

interface TokensFile {
  version: 1
  /** base64 safeStorage-шифротекста; в открытом виде refresh token на диске не хранится. */
  encryptedRefreshToken: string
}

/** Ошибка честно сообщает, что ОС не позволяет безопасно сохранить токен. */
export class EncryptionUnavailableError extends Error {
  constructor() {
    super('ОС не предоставляет шифрование (safeStorage) — токен не сохранён. Войдите снова после включения шифрования.')
    this.name = 'EncryptionUnavailableError'
  }
}

export class TokenStore {
  private readonly filePath: string
  private readonly secure: SecureStorage

  constructor(filePath: string, secure: SecureStorage) {
    this.filePath = filePath
    this.secure = secure
  }

  async save(tokens: StoredTokens): Promise<void> {
    if (!this.secure.isEncryptionAvailable()) throw new EncryptionUnavailableError()
    const encrypted = this.secure.encryptString(tokens.refreshToken)
    const payload: TokensFile = {
      version: 1,
      encryptedRefreshToken: Buffer.from(encrypted).toString('base64'),
    }
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(payload), { mode: 0o600 })
  }

  async load(): Promise<StoredTokens | null> {
    if (!this.secure.isEncryptionAvailable()) return null
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch {
      return null
    }
    try {
      const parsed = JSON.parse(raw) as TokensFile
      if (parsed.version !== 1 || typeof parsed.encryptedRefreshToken !== 'string') return null
      const refreshToken = this.secure.decryptString(Buffer.from(parsed.encryptedRefreshToken, 'base64'))
      return refreshToken ? { refreshToken } : null
    } catch {
      // Повреждённый файл токенов трактуем как отсутствие сессии.
      return null
    }
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true })
  }
}
