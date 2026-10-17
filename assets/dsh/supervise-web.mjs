import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { open, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const REQUESTED_RESTART_EXIT_CODE = 75
const PROFILE_SYNC_TIMEOUT_MS = Number(process.env.DSH_WEB_PROFILE_SYNC_TIMEOUT_MS) || 300_000
// A run that stays up this long is worth keeping as the recovery snapshot.
const LKG_REFRESH_DELAY_MS = Number(process.env.DSH_WEB_LKG_REFRESH_DELAY_MS) || 600_000
const dshHome = resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
process.env.DSH_HOME = dshHome
process.env.DSH_CHANNEL_PACK_STATE_DIR = dshHome
process.env.DSH_OPENAI_GATEWAY_ENABLED = 'false'

const channelPackStatePath = join(dshHome, 'channel-pack', 'auto-checkin.json')
await mkdir(dirname(channelPackStatePath), { recursive: true, mode: 0o700 })
try {
  const stateFile = await open(channelPackStatePath, 'wx', 0o600)
  try {
    await stateFile.writeFile(`${JSON.stringify(
      {
        schema: 'dsh-codearts-auth/auto-checkin/v1',
        enabled: false,
        lastDate: '',
        lastResult: '',
        lastAt: 0,
        channels: [],
        dismissedRunAt: 0,
      },
      null,
      2,
    )}\n`)
  } catch (error) {
    await unlink(channelPackStatePath).catch(() => undefined)
    throw error
  } finally {
    await stateFile.close()
  }
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
}

const runtimeDirectory = join(dshHome, 'runtime')
await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 })

// The tokenized launch URL, readable by this user only, so agents and `dshx` can reach this DSH without copying it by hand.
const webUrlPath = join(runtimeDirectory, 'web-url')
const LAUNCH_URL_PATTERN = /^dsh web: (http:\/\/\S+\?token=\S+)$/m

const forwardedArgs = process.argv.slice(2)
const hasPort = forwardedArgs.some(argument => argument === '--port' || argument.startsWith('--port='))
const webArgs = ['web', ...(hasPort ? [] : ['--port', '3080']), ...forwardedArgs]
let stopping = false
let stopCode = 0
let child
let syncChild

const stopChild = signal => {
  if (stopping) return
  stopping = true
  stopCode = signal === 'SIGINT' ? 130 : 143
  if (child?.exitCode === null) child.kill(signal)
  if (syncChild?.exitCode === null) {
    try {
      process.kill(-syncChild.pid, 'SIGTERM')
    } catch {}
  }
}

const warn = message => process.stderr.write(`[dsh-web-supervisor] ${message}\n`)

// dshfiles owns the profile reconciler; run it before every start so seed and plugin changes land on restart without
// nixapply. It must never block startup: on failure or timeout DSH starts with the profile it already has.
const syncProfile = () =>
  new Promise(resolveSync => {
    const dshfilesDirectory = process.env.DSHFILES_DIR?.trim()
    const script = dshfilesDirectory ? join(dshfilesDirectory, 'scripts', 'profile-sync.ts') : undefined
    if (script === undefined || !existsSync(script)) {
      warn(`No dshfiles profile reconciler at ${script ?? '$DSHFILES_DIR (unset)'}; starting DSH with the current web profile.`)
      resolveSync()
      return
    }
    syncChild = spawn(process.execPath, [script, '--profile', 'web', '--home', dshHome], {
      cwd: dshfilesDirectory,
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    })
    const launchedSync = syncChild
    const timer = setTimeout(() => {
      warn(`The web profile sync exceeded ${PROFILE_SYNC_TIMEOUT_MS / 1000}s; stopping it.`)
      try {
        process.kill(-launchedSync.pid, 'SIGKILL')
      } catch {}
    }, PROFILE_SYNC_TIMEOUT_MS)
    const finish = message => {
      clearTimeout(timer)
      if (syncChild === launchedSync) syncChild = undefined
      if (message !== undefined) warn(`${message}; starting DSH with the previous web profile.`)
      resolveSync()
    }
    launchedSync.once('error', error => finish(`Could not run the web profile sync: ${error.message}`))
    launchedSync.once('exit', (code, signal) =>
      finish(code === 0 ? undefined : `The web profile sync failed (${signal ?? `exit ${code}`})`),
    )
  })

process.once('SIGINT', () => stopChild('SIGINT'))
process.once('SIGTERM', () => stopChild('SIGTERM'))

// dsh-lkg builds a candidate, boots it on its own port with its own state, and
// promotes it only when the Host and the browser half both pass; --if-changed
// makes a refresh of an unchanged installation a no-op. It runs detached so a
// slow snapshot never holds up DSH or the supervisor's shutdown.
const refreshLastKnownGood = () => {
  const dshfilesDirectory = process.env.DSHFILES_DIR?.trim()
  const script = dshfilesDirectory ? join(dshfilesDirectory, 'scripts', 'dsh-lkg', 'cli.mjs') : undefined
  if (script === undefined || !existsSync(script)) return
  const logsDirectory = join(homedir(), '.dsh-lkg', 'logs')
  void mkdir(logsDirectory, { recursive: true })
    .then(() => open(join(logsDirectory, 'auto-snapshot.log'), 'a'))
    .then(log => {
      const snapshot = spawn(process.execPath, [script, 'snapshot', '--if-changed', '--label', 'auto'], {
        cwd: dshfilesDirectory,
        detached: true,
        stdio: ['ignore', log.fd, log.fd],
        env: { ...process.env, DSH_LKG_ADMIN: '1' },
      })
      snapshot.once('error', error => warn(`Could not refresh the last known good snapshot: ${error.message}`))
      snapshot.unref()
      void log.close()
    })
    .catch(error => warn(`Could not refresh the last known good snapshot: ${error.message}`))
}

const runDsh = runId =>
  new Promise(resolveRun => {
    const requestPath = join(runtimeDirectory, `dsh-web-restart-${runId}.request`)
    child = spawn('dsh', webArgs, {
      env: {
        ...process.env,
        DSH_RESTART_REQUEST_PATH: requestPath,
        DSH_RESTART_RUN_ID: runId,
      },
      stdio: ['inherit', 'pipe', 'inherit'],
    })
    const launchedChild = child
    let refreshTimer
    launchedChild.stdout.on('data', chunk => {
      process.stdout.write(chunk)
      const url = LAUNCH_URL_PATTERN.exec(chunk.toString())?.[1]
      if (url === undefined) return
      void writeFile(webUrlPath, `${url}\n`, { mode: 0o600 }).catch(() => undefined)
      refreshTimer ??= setTimeout(() => {
        if (launchedChild.exitCode === null && !stopping) refreshLastKnownGood()
      }, LKG_REFRESH_DELAY_MS)
      refreshTimer.unref()
    })
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      if (child === launchedChild) child = undefined
      resolveRun(result)
    }

    launchedChild.once('error', error => {
      console.error(`[dsh-web-supervisor] Could not launch DSH: ${error.message}`)
      finish({ exitCode: 1, restartRequested: false })
    })
    launchedChild.once('exit', (code, signal) => {
      clearTimeout(refreshTimer)
      void unlink(webUrlPath).catch(() => undefined)
      const exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)
      void readFile(requestPath, 'utf8')
        .then(async requestId => {
          await unlink(requestPath).catch(() => undefined)
          finish({ exitCode, restartRequested: requestId === runId && code === REQUESTED_RESTART_EXIT_CODE && signal === null })
        })
        .catch(() => finish({ exitCode, restartRequested: false }))
    })
  })

while (!stopping) {
  await syncProfile()
  if (stopping) {
    process.exitCode = stopCode
    break
  }
  const runId = randomUUID()
  const result = await runDsh(runId)
  if (stopping) {
    process.exitCode = stopCode
    break
  }
  if (result.restartRequested) {
    process.stderr.write('[dsh-web-supervisor] Restarting after a confirmed request.\n')
    continue
  }
  process.exitCode = result.exitCode
  break
}
