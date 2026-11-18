import { spawnSync } from 'node:child_process'
import process from 'node:process'

const executable = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
const result = spawnSync(executable, ['assembleRelease'], {
  cwd: 'android',
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
