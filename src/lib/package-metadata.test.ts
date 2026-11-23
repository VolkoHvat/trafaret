import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  name: string
  version: string
  build: { directories: { output: string }; win: { artifactName: string }; nsis: { script?: string } }
  scripts: { 'android:sync': string }
}
const installerNsi = readFileSync(new URL('../../build/installer.nsi', import.meta.url), 'utf8')
const lockfile = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
  name: string
  version: string
  packages: { '': { name: string; version: string } }
}

describe('release metadata', () => {
  it('keeps npm, lockfile and the published Windows artifact aligned', () => {
    expect(packageJson.name).toBe('trafaret')
    expect(packageJson.version).toBe('2.0.0-beta.4')
    const android = readFileSync(new URL('../../android/app/build.gradle', import.meta.url), 'utf8')
    expect(android).toMatch(/^\s*versionCode 8\s*$/m)
    expect(android).toContain(`versionName "${packageJson.version}"`)
    expect(lockfile.name).toBe(packageJson.name)
    expect(lockfile.version).toBe(packageJson.version)
    expect(lockfile.packages['']).toMatchObject({
      name: packageJson.name,
      version: packageJson.version,
    })
    expect(packageJson.build.win.artifactName).toBe('Trafaret-Windows-x64.exe')
    expect(packageJson.build.directories.output).toBe('release/windows')
    expect(packageJson.build.directories.output).not.toContain('/mnt/')
    expect(packageJson.build.nsis.script).toBeUndefined()
    expect(installerNsi).toContain('!addincludedir "${PROJECT_DIR}\\build"')
    expect(packageJson.scripts['android:sync']).toContain('node node_modules/@capacitor/cli/bin/capacitor sync android')
  })
})
