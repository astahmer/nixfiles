import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'

const supervisor = join(import.meta.dirname, 'supervise-web.mjs')
let root
let logPath

const fakeDsh = `#!/usr/bin/env node
const fs = require('node:fs')
fs.appendFileSync(process.env.TEST_LOG, 'dsh ' + process.argv.slice(2).join(' ') + '\\n')
const starts = fs.readFileSync(process.env.TEST_LOG, 'utf8').split('\\n').filter(line => line.startsWith('dsh ')).length
if (starts === 1 && process.env.TEST_RESTART_ONCE === '1') {
  fs.writeFileSync(process.env.DSH_RESTART_REQUEST_PATH, process.env.DSH_RESTART_RUN_ID)
  process.exit(75)
}
if (process.env.TEST_LAUNCH_MS) {
  console.log('dsh web: http://127.0.0.1:3080/?token=test')
  setTimeout(() => {}, Number(process.env.TEST_LAUNCH_MS))
}
`
const fakeSync = `const fs = process.getBuiltinModule('node:fs')
fs.appendFileSync(process.env.TEST_LOG, 'sync ' + process.argv.slice(2).join(' ') + '\\n')
if (process.env.TEST_SYNC_HANG === '1') setInterval(() => {}, 1000)
else process.exitCode = Number(process.env.TEST_SYNC_EXIT ?? 0)
`

const fakeLkg = `const fs = process.getBuiltinModule('node:fs')
fs.appendFileSync(process.env.TEST_LOG, 'lkg ' + process.argv.slice(2).join(' ') + ' admin=' + process.env.DSH_LKG_ADMIN + '\\n')
`

const supervise = (environment = {}) => {
  const result = spawnSync(process.execPath, [supervisor, '--no-open'], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      PATH: [join(root, 'bin'), dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
      HOME: root,
      DSH_HOME: join(root, 'dsh-home'),
      DSHFILES_DIR: join(root, 'dshfiles'),
      TEST_LOG: logPath,
      ...environment,
    },
  })
  return { status: result.status, stderr: result.stderr, log: readFileSync(logPath, 'utf8').trim().split('\n') }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'supervise-web-'))
  logPath = join(root, 'calls.log')
  writeFileSync(logPath, '')
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'bin/dsh'), fakeDsh)
  chmodSync(join(root, 'bin/dsh'), 0o755)
  mkdirSync(join(root, 'dshfiles/scripts'), { recursive: true })
  writeFileSync(join(root, 'dshfiles/scripts/profile-sync.ts'), fakeSync)
  mkdirSync(join(root, 'dshfiles/scripts/dsh-lkg'))
  writeFileSync(join(root, 'dshfiles/scripts/dsh-lkg/cli.mjs'), fakeLkg)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

test('syncs the web profile from the dshfiles checkout before the start and before a requested restart', () => {
  const result = supervise({ TEST_RESTART_ONCE: '1' })
  const sync = `sync --profile web --home ${join(root, 'dsh-home')}`
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.log, [sync, 'dsh web --port 3080 --no-open', sync, 'dsh web --port 3080 --no-open'])
})

test('starts DSH with the previous profile when the sync fails', () => {
  const result = supervise({ TEST_SYNC_EXIT: '1' })
  assert.equal(result.status, 0)
  assert.equal(result.log.at(-1), 'dsh web --port 3080 --no-open')
  assert.match(result.stderr, /The web profile sync failed \(exit 1\); starting DSH with the previous web profile/)
})

test('stops a hung sync and starts DSH', () => {
  const result = supervise({ TEST_SYNC_HANG: '1', DSH_WEB_PROFILE_SYNC_TIMEOUT_MS: '300' })
  assert.equal(result.status, 0)
  assert.equal(result.log.at(-1), 'dsh web --port 3080 --no-open')
  assert.match(result.stderr, /exceeded 0.3s/)
})

test('starts DSH without a sync when the dshfiles checkout has no reconciler', () => {
  const result = supervise({ DSHFILES_DIR: join(root, 'missing') })
  assert.equal(result.status, 0)
  assert.deepEqual(result.log, ['dsh web --port 3080 --no-open'])
  assert.match(result.stderr, /No dshfiles profile reconciler/)
})

test('refreshes the last known good snapshot once DSH has stayed up', () => {
  const result = supervise({ TEST_LAUNCH_MS: '1500', DSH_WEB_LKG_REFRESH_DELAY_MS: '200' })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.log.includes('lkg snapshot --if-changed --label auto admin=1'), result.log.join('\n'))
})

test('does not refresh the snapshot when DSH exits before it proved itself', () => {
  const result = supervise({ TEST_LAUNCH_MS: '100', DSH_WEB_LKG_REFRESH_DELAY_MS: '1000' })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!result.log.some(line => line.startsWith('lkg ')), result.log.join('\n'))
})
