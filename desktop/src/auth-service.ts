import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ConfigStore, isConfigComplete, parseConfig } from './config'
import {
  buildAuthorizationUrl, buildCodeExchangeBody, buildRefreshBody,
  createCodeChallenge, createOAuthState, createCodeVerifier,
  extractValidatedCode, GOOGLE_REVOKE_ENDPOINT, GOOGLE_TOKEN_ENDPOINT,
  parseLoopbackCallback,
} from './oauth'
import { EncryptionUnavailableError, TokenStore } from './token-store'

export const NOT_SIGNED_IN = 'NOT_SIGNED_IN'
const ACCESS_TOKEN_SKEW_MS = 60_000

/** Экранирование значений, попадающих в HTML-страницу loopback-ответа. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch] as string))
}

export interface FetchLike {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array | URLSearchParams }): Promise<Response>
}

export interface AuthServiceDeps {
  configStore: ConfigStore
  tokenStore: TokenStore
  scope: string
  fetchImpl: FetchLike
  openExternal: (url: string) => Promise<void>
  randomBytes: (length: number) => Uint8Array
  digestSha256: (input: Uint8Array) => Promise<Uint8Array>
  now?: () => number
  signInTimeoutMs?: number
}

interface AccessTokenCache {
  value: string
  expiresAt: number
}

export type SessionState = 'active' | 'signed-out' | 'not-configured'

export class AuthService {
  private readonly deps: AuthServiceDeps

  private session: { refreshToken: string; accessToken: AccessTokenCache | null } | null = null
  private lastError: string | null = null
  private readonly listeners = new Set<(signedIn: boolean) => void>()
  private inflightSignIn: Promise<boolean> | null = null

  constructor(deps: AuthServiceDeps) {
    this.deps = deps
  }

  onChange(listener: (signedIn: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getLastError(): string | null {
    return this.lastError
  }

  private notify(signedIn: boolean) {
    for (const listener of this.listeners) listener(signedIn)
  }

  private setError(message: string | null) {
    this.lastError = message
  }

  async isConfigured(): Promise<boolean> {
    return isConfigComplete(await this.deps.configStore.load())
  }

  async getConfig() {
    return this.deps.configStore.load()
  }

  async saveConfig(config: unknown): Promise<boolean> {
    await this.deps.configStore.save(parseConfig(config))
    return true
  }

  async getSessionState(): Promise<SessionState> {
    if (!(await this.isConfigured())) return 'not-configured'
    const tokens = this.session ?? await this.deps.tokenStore.load()
    return tokens ? 'active' : 'signed-out'
  }

  /**
   * Вход через системный браузер: loopback 127.0.0.1 со случайным портом,
   * state и PKCE. Ничего секретного не логируем.
   */
  signIn(): Promise<boolean> {
    this.inflightSignIn ??= this.performSignIn().finally(() => { this.inflightSignIn = null })
    return this.inflightSignIn
  }

  private async performSignIn(): Promise<boolean> {
    const config = await this.deps.configStore.load()
    if (!isConfigComplete(config)) {
      this.setError('Сначала укажите Google Client ID в настройках синхронизации')
      this.notify(false)
      return false
    }
    const server = createServer()
    const timeoutMs = this.deps.signInTimeoutMs ?? 300_000
    try {
      const port = await new Promise<number>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
      })
      const redirectUri = `http://127.0.0.1:${port}/`
      const verifier = createCodeVerifier(this.deps.randomBytes(48))
      const challenge = await createCodeChallenge(verifier, this.deps.digestSha256)
      const state = createOAuthState(this.deps.randomBytes(24))
      const callbackPromise = this.waitForCallback(server, state, timeoutMs)
      await this.deps.openExternal(buildAuthorizationUrl({
        clientId: config.clientId, redirectUri, scope: this.deps.scope, state, challenge,
      }))
      const callback = await callbackPromise
      const validated = extractValidatedCode(callback.parsed, state)
      if ('error' in validated) {
        this.setError(validated.error)
        this.notify(false)
        return false
      }
      const tokens = await this.exchangeCode(config, redirectUri, validated.code, verifier)
      if (!tokens.refreshToken) {
        this.setError('Google не выдал refresh token — попробуйте войти ещё раз')
        this.notify(false)
        return false
      }
      try {
        await this.deps.tokenStore.save({ refreshToken: tokens.refreshToken })
      } catch (error) {
        // Честно сообщаем, в т.ч. когда ОС не даёт зашифровать токен.
        this.setError(error instanceof EncryptionUnavailableError ? error.message : 'Не удалось сохранить токен входа')
        this.notify(false)
        return false
      }
      this.session = { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken }
      this.setError(null)
      this.notify(true)
      return true
    } catch (error) {
      this.setError(error instanceof Error && error.message === 'SIGN_IN_TIMEOUT'
        ? 'Время ожидания входа вышло — попробуйте снова'
        : 'Не удалось выполнить вход через Google (проверьте сеть)')
      this.notify(false)
      return false
    } finally {
      server.close()
    }
  }

  private waitForCallback(server: Server, expectedState: string, timeoutMs: number): Promise<{ parsed: ReturnType<typeof parseLoopbackCallback> }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SIGN_IN_TIMEOUT')), timeoutMs)
      server.on('request', (request, response) => {
        const requestUrl = request.url ?? '/'
        const parsed = parseLoopbackCallback(`http://127.0.0.1${requestUrl}`)
        // Браузеры дёргают /favicon.ico и служебные пути — игнорируем их.
        if (!parsed.code && !parsed.state && !parsed.error) {
          response.writeHead(404)
          response.end()
          return
        }
        const validated = extractValidatedCode(parsed, expectedState)
        const page = 'error' in validated
          ? `<!doctype html><meta charset="utf-8"><title>Трафарет</title><p style="font-family:sans-serif">${escapeHtml(validated.error)}. Можно вернуться в приложение.</p>`
          : `<!doctype html><meta charset="utf-8"><title>Трафарет</title><p style="font-family:sans-serif">Вход выполнен. Вернитесь в приложение «Трафарет».</p>`
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(page)
        clearTimeout(timer)
        resolve({ parsed })
      })
    })
  }

  private async exchangeCode(config: { clientId: string; clientSecret: string }, redirectUri: string, code: string, verifier: string) {
    const response = await this.deps.fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(buildCodeExchangeBody({
        clientId: config.clientId, clientSecret: config.clientSecret || undefined,
        redirectUri, code, verifier,
      })),
    })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) {
      throw new Error(typeof data.error_description === 'string' ? data.error_description : 'Google отклонил обмен кода на токен')
    }
    const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
    const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : ''
    const ttl = Number(data.expires_in ?? 3600)
    if (!accessToken) throw new Error('В ответе Google нет access token')
    return {
      refreshToken,
      accessToken: { value: accessToken, expiresAt: this.now() + ttl * 1000 },
    }
  }

  async getAccessToken(scopes: string[]): Promise<string> {
    if (!scopes.includes(this.deps.scope)) throw new Error(`Неподдерживаемый scope: ${scopes.join(' ')}`)
    if (!this.session) {
      const stored = await this.deps.tokenStore.load()
      if (!stored) throw new Error(NOT_SIGNED_IN)
      this.session = { refreshToken: stored.refreshToken, accessToken: null }
    }
    if (this.session.accessToken && this.session.accessToken.expiresAt - this.now() > ACCESS_TOKEN_SKEW_MS) {
      return this.session.accessToken.value
    }
    const config = await this.deps.configStore.load()
    const response = await this.deps.fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(buildRefreshBody({
        clientId: config.clientId, clientSecret: config.clientSecret || undefined,
        refreshToken: this.session.refreshToken,
      })),
    })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) {
      // refresh token отозван/просрочен — сессия закончилась, требуем новый вход.
      await this.dropSession()
      throw new Error(NOT_SIGNED_IN)
    }
    const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
    if (!accessToken) {
      await this.dropSession()
      throw new Error(NOT_SIGNED_IN)
    }
    const ttl = Number(data.expires_in ?? 3600)
    this.session.accessToken = { value: accessToken, expiresAt: this.now() + ttl * 1000 }
    return accessToken
  }

  async signOut(): Promise<void> {
    const refreshToken = this.session?.refreshToken ?? (await this.deps.tokenStore.load())?.refreshToken
    if (refreshToken) {
      // Отзыв — best effort, ошибка сети не мешает завершить локальный выход.
      await this.deps.fetchImpl(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => {})
    }
    await this.dropSession()
  }

  private async dropSession() {
    this.session = null
    await this.deps.tokenStore.clear()
    this.notify(false)
  }

  private now(): number {
    return (this.deps.now ?? (() => Date.now()))()
  }
}
