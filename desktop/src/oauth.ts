/**
 * Чистые helpers OAuth 2.0 loopback flow (RFC 8252 + PKCE RFC 7636).
 * Не зависят от Electron — покрыты unit-тестами без сети.
 */

export interface PkcePair {
  verifier: string
  challenge: string
}

export interface AuthRequestParams {
  clientId: string
  redirectUri: string
  scope: string
  state: string
  challenge: string
}

export interface TokenRequestParams {
  clientId: string
  clientSecret?: string
  redirectUri: string
  code: string
  verifier: string
}

export interface RefreshRequestParams {
  clientId: string
  clientSecret?: string
  refreshToken: string
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/** PKCE code verifier (43–128 символов из допустимого алфавита RFC 7636). */
export function createCodeVerifier(randomBytes: Uint8Array): string {
  if (randomBytes.length < 32) throw new Error('Для PKCE verifier нужно не менее 32 случайных байт')
  return base64UrlEncode(randomBytes).slice(0, 96)
}

/** S256 challenge для PKCE. */
export async function createCodeChallenge(verifier: string, digest: (input: Uint8Array) => Promise<Uint8Array>): Promise<string> {
  const hash = await digest(new TextEncoder().encode(verifier))
  return base64UrlEncode(hash)
}

export async function createPkcePair(randomBytes: Uint8Array, digest: (input: Uint8Array) => Promise<Uint8Array>): Promise<PkcePair> {
  const verifier = createCodeVerifier(randomBytes)
  return { verifier, challenge: await createCodeChallenge(verifier, digest) }
}

export function createOAuthState(randomBytes: Uint8Array): string {
  if (randomBytes.length < 16) throw new Error('Для state нужно не менее 16 случайных байт')
  return base64UrlEncode(randomBytes)
}

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

export function buildAuthorizationUrl(params: AuthRequestParams): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', params.scope)
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // offline → refresh token; consent → гарантируем выдачу refresh token при повторном входе.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

export interface TokenEndpointBody {
  [key: string]: string
}

/** Тело запроса обмена authorization code на токены (без логирования!). */
export function buildCodeExchangeBody(params: TokenRequestParams): TokenEndpointBody {
  const body: TokenEndpointBody = {
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.verifier,
  }
  if (params.clientSecret) body.client_secret = params.clientSecret
  return body
}

export function buildRefreshBody(params: RefreshRequestParams): TokenEndpointBody {
  const body: TokenEndpointBody = {
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  }
  if (params.clientSecret) body.client_secret = params.clientSecret
  return body
}

export interface LoopbackCallback {
  code: string | null
  state: string | null
  error: string | null
}

/** Разбор редиректа http://127.0.0.1:PORT/?code=…&state=… (путь игнорируем). */
export function parseLoopbackCallback(requestUrl: string): LoopbackCallback {
  const url = new URL(requestUrl)
  return {
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    error: url.searchParams.get('error'),
  }
}

/** Возвращает code только при совпадении state; иначе null (защита от CSRF). */
export function extractValidatedCode(callback: LoopbackCallback, expectedState: string): { code: string } | { error: string } {
  if (callback.error) return { error: `Google вернул ошибку: ${callback.error}` }
  if (!callback.code) return { error: 'В ответе Google нет authorization code' }
  if (!callback.state || callback.state !== expectedState) return { error: 'Не совпал state OAuth-ответа' }
  return { code: callback.code }
}

export function isLoopbackRedirectUri(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}
