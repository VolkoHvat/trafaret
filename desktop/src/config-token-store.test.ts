import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore, describeConfig, isConfigComplete, parseConfig } from './config'
import { EncryptionUnavailableError, TokenStore } from './token-store'
import type { SecureStorage } from './token-store'

const fakeSecure: SecureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => new TextEncoder().encode(`enc:${value}`),
  decryptString: buffer => new TextDecoder().decode(buffer).replace(/^enc:/, ''),
}

const noSecure: SecureStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => { throw new Error('no encryption') },
  decryptString: () => { throw new Error('no encryption') },
}

let dir = ''

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'trafaret-test-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('desktop config', () => {
  it('parseConfig отсекает мусор и не теряет secret', () => {
    expect(parseConfig(null)).toEqual({ clientId: '', clientSecret: '' })
    expect(parseConfig({ clientId: '  id-1 ', clientSecret: 42 })).toEqual({ clientId: 'id-1', clientSecret: '' })
    expect(parseConfig({ clientId: 'id-1', clientSecret: ' sec ' })).toEqual({ clientId: 'id-1', clientSecret: 'sec' })
  })

  it('isConfigComplete требует только clientId', () => {
    expect(isConfigComplete({ clientId: '', clientSecret: 's' })).toBe(false)
    expect(isConfigComplete({ clientId: 'id', clientSecret: '' })).toBe(true)
  })

  it('describeConfig никогда не раскрывает secret', () => {
    const text = describeConfig({ clientId: 'abc123.apps.googleusercontent.com', clientSecret: 'TOP-SECRET' })
    expect(text).not.toContain('TOP-SECRET')
    expect(text).toContain('<задан>')
  })

  it('ConfigStore round-trip и поведение без файла', async () => {
    const store = new ConfigStore(join(dir, 'sync-config.json'))
    expect(await store.load()).toEqual({ clientId: '', clientSecret: '' })
    await store.save({ clientId: 'id-1', clientSecret: 'sec-1' })
    expect(await store.load()).toEqual({ clientId: 'id-1', clientSecret: 'sec-1' })
  })
})

describe('TokenStore (safeStorage)', () => {
  it('сохраняет и читает refresh token через шифрование', async () => {
    const store = new TokenStore(join(dir, 'tokens.json'), fakeSecure)
    await store.save({ refreshToken: 'rt-1' })
    const raw = await import('node:fs/promises').then(fs => fs.readFile(join(dir, 'tokens.json'), 'utf8'))
    expect(raw).not.toContain('rt-1')
    expect(await store.load()).toEqual({ refreshToken: 'rt-1' })
  })

  it('честно отказывает, когда ОС не даёт шифрование', async () => {
    const store = new TokenStore(join(dir, 'tokens.json'), noSecure)
    await expect(store.save({ refreshToken: 'rt' })).rejects.toBeInstanceOf(EncryptionUnavailableError)
    expect(await store.load()).toBeNull()
  })

  it('повреждённый файл трактуется как отсутствие сессии', async () => {
    const file = join(dir, 'tokens.json')
    const fs = await import('node:fs/promises')
    await fs.writeFile(file, '{not json')
    const store = new TokenStore(file, fakeSecure)
    expect(await store.load()).toBeNull()
  })

  it('clear удаляет файл', async () => {
    const store = new TokenStore(join(dir, 'tokens.json'), fakeSecure)
    await store.save({ refreshToken: 'rt' })
    await store.clear()
    expect(await store.load()).toBeNull()
  })
})
