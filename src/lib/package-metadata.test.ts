import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  name: string
  version: string
  build: { win: { artifactName: string }; nsis: { script?: string } }
}
const lockfile = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
  name: string
  version: string
  packages: { '': { name: string; version: string } }
}

describe('release metadata', () => {
  it('keeps npm, lockfile and the published Windows artifact aligned', () => {
    expect(packageJson.name).toBe('trafaret')
    expect(packageJson.version).toBe('1.1.0')
    expect(lockfile.name).toBe(packageJson.name)
    expect(lockfile.version).toBe(packageJson.version)
    expect(lockfile.packages['']).toMatchObject({
      name: packageJson.name,
      version: packageJson.version,
    })
    expect(packageJson.build.win.artifactName).toBe('Trafaret-Windows-x64.exe')
    expect(packageJson.build.nsis.script).toBeUndefined()
  })
})
