import { createHash, webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildAuthorizationUrl, buildCodeExchangeBody, buildRefreshBody, createCodeChallenge,
  createCodeVerifier, createOAuthState, createPkcePair, extractValidatedCode,
  isLoopbackRedirectUri, parseLoopbackCallback,
} from './oauth'

const sha256 = async (input: Uint8Array) => new Uint8Array(await webcrypto.subtle.digest('SHA-256', input))

describe('PKCE', () => {
  it('verifier укладывается в допустимую длину и алфавит RFC 7636', () => {
    const verifier = createCodeVerifier(new Uint8Array(48).fill(7))
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  it('challenge — это S256-хеш верифайрера в base64url', async () => {
    const verifier = createCodeVerifier(new Uint8Array(48).fill(3))
    const expected = createHash('sha256').update(verifier).digest().toString('base64url')
    expect(await createCodeChallenge(verifier, sha256)).toBe(expected)
    // RFC 7636 appendix B вектор
    expect(await createCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', sha256))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('пара verifier/challenge стабильна при тех же входах', async () => {
    const bytes = new Uint8Array(48).map((_, i) => i)
    const a = await createPkcePair(bytes, sha256)
    const b = await createPkcePair(bytes, sha256)
    expect(a).toEqual(b)
  })
})

describe('state', () => {
  it('два подряд state различаются и достаточно длинные', () => {
    const a = createOAuthState(webcrypto.getRandomValues(new Uint8Array(24)))
    const b = createOAuthState(webcrypto.getRandomValues(new Uint8Array(24)))
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(22)
  })
})

describe('authorization URL', () => {
  it('содержит все параметры loopback + PKCE запроса', async () => {
    const url = new URL(buildAuthorizationUrl({
      clientId: 'cid.apps.googleusercontent.com',
      redirectUri: 'http://127.0.0.1:54321/',
      scope: 'https://www.googleapis.com/auth/drive.file',
      state: 'state-1',
      challenge: 'challenge-1',
    }))
    expect(url.searchParams.get('client_id')).toBe('cid.apps.googleusercontent.com')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54321/')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('access_type')).toBe('offline')
  })
})

describe('token endpoint тела', () => {
  it('обмен кода: secret только когда задан', () => {
    const withSecret = buildCodeExchangeBody({ clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://127.0.0.1:1/', code: 'c', verifier: 'v' })
    expect(withSecret.client_secret).toBe('sec')
    expect(withSecret.code_verifier).toBe('v')
    const withoutSecret = buildCodeExchangeBody({ clientId: 'cid', redirectUri: 'http://127.0.0.1:1/', code: 'c', verifier: 'v' })
    expect('client_secret' in withoutSecret).toBe(false)
  })

  it('refresh: grant_type и refresh_token на месте', () => {
    const body = buildRefreshBody({ clientId: 'cid', refreshToken: 'rt' })
    expect(body.grant_type).toBe('refresh_token')
    expect(body.refresh_token).toBe('rt')
  })
})

describe('loopback колбэк', () => {
  it('парсит code/state и валидирует state', () => {
    const parsed = parseLoopbackCallback('http://127.0.0.1:51234/?code=abc&state=s1')
    expect(extractValidatedCode(parsed, 's1')).toEqual({ code: 'abc' })
    expect('error' in extractValidatedCode(parsed, 'другой')).toBe(true)
  })

  it('честно возвращает ошибку Google и пустой ответ', () => {
    expect(extractValidatedCode(parseLoopbackCallback('http://127.0.0.1:1/?error=access_denied&state=s'), 's'))
      .toEqual({ error: 'Google вернул ошибку: access_denied' })
    expect('error' in extractValidatedCode(parseLoopbackCallback('http://127.0.0.1:1/'), 's')).toBe(true)
  })

  it('redirect URI считается loopback только для 127.0.0.1/localhost по http', () => {
    expect(isLoopbackRedirectUri('http://127.0.0.1:4000/')).toBe(true)
    expect(isLoopbackRedirectUri('http://localhost:8080/cb')).toBe(true)
    expect(isLoopbackRedirectUri('https://127.0.0.1/')).toBe(false)
    expect(isLoopbackRedirectUri('https://evil.example/cb')).toBe(false)
  })
})
