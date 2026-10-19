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
// A Host that answers HTTP can still have lost a plugin service: after a failed hot reload the Session surface dies
// while the process stays up, so every Session route answers 'active Service "sessionController" is unavailable' and
// each plugin API 404s. Nothing in the running process re-registers a lost service, so the supervisor probes the
// surface once the Host is up and restarts it when it does not answer. Set DSH_WEB_HEALTH_PROBE=off to skip the probe.
const HEALTH_PROBE_DISABLED = process.env.DSH_WEB_HEALTH_PROBE === 'off'
const HEALTH_PROBE_GRACE_MS = Number(process.env.DSH_WEB_HEALTH_PROBE_GRACE_MS) || 20_000
const HEALTH_PROBE_INTERVAL_MS = Number(process.env.DSH_WEB_HEALTH_PROBE_INTERVAL_MS) || 10_000
const HEALTH_PROBE_ATTEMPTS = Number(process.env.DSH_WEB_HEALTH_PROBE_ATTEMPTS) || 6
const HEALTH_PROBE_TIMEOUT_MS = Number(process.env.DSH_WEB_HEALTH_PROBE_TIMEOUT_MS) || 20_000
const MAX_HEALTH_RESTARTS = Number(process.env.DSH_WEB_MAX_HEALTH_RESTARTS) || 2
// An unexpected exit used to end the supervisor and leave DSH down; restart it, but stop after a few tries so a
// deterministically broken build cannot spin forever.
const MAX_CRASH_RESTARTS = Number(process.env.DSH_WEB_MAX_CRASH_RESTARTS) || 5
const CRASH_RESTART_BACKOFF_MS = Number(process.env.DSH_WEB_CRASH_RESTART_BACKOFF_MS) || 2_000
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
  for (const cancel of [...stopWaiters]) cancel()
}

const stopWaiters = new Set()

/** Wait between restarts, but wake immediately on SIGINT/SIGTERM so a stop never sits out the backoff. */
const delay = milliseconds =>
  new Promise(resolve => {
    const cancel = () => {
      clearTimeout(timer)
      stopWaiters.delete(cancel)
      resolve()
    }
    const timer = setTimeout(() => {
      stopWaiters.delete(cancel)
      resolve()
    }, milliseconds)
    stopWaiters.add(cancel)
  })

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

/**
 * Ask the running Host whether its Session surface answers. `dshx status` speaks the same gateway protocol the browser
 * does, so it reports the missing service instead of a bare connection error. It is a dshfiles build, not a
 * dependency of this launcher: an unbuilt or unreadable `dshx` skips the probe, because a false restart is worse than
 * a missed one.
 */
const probeSessionSurface = url =>
  new Promise(resolve => {
    const dshfilesDirectory = process.env.DSHFILES_DIR?.trim()
    const script = dshfilesDirectory ? join(dshfilesDirectory, 'tooling', 'dshx', 'packages', 'dshx', 'dist', 'cli', 'bin.js') : undefined
    if (script === undefined || !existsSync(script)) {
      resolve({ verdict: 'skipped', reason: `no dshx build at ${script ?? '$DSHFILES_DIR (unset)'}` })
      return
    }
    const probe = spawn(process.execPath, [script, 'status', '--json'], {
      env: { ...process.env, DSHX_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    probe.stdout.on('data', chunk => {
      stdout += chunk
    })
    const timer = setTimeout(() => {
      try {
        probe.kill('SIGKILL')
      } catch {}
    }, HEALTH_PROBE_TIMEOUT_MS)
    probe.once('error', error => {
      clearTimeout(timer)
      resolve({ verdict: 'skipped', reason: `could not run dshx status: ${error.message}` })
    })
    probe.once('exit', () => {
      clearTimeout(timer)
      let parsed
      try {
        parsed = JSON.parse(stdout)
      } catch {
        parsed = undefined
      }
      if (parsed?.ok === true) {
        resolve({ verdict: 'healthy' })
        return
      }
      if (parsed?.ok === false && parsed.error !== undefined) {
        resolve({ verdict: 'unavailable', reason: `${parsed.error.code}: ${parsed.error.message}` })
        return
      }
      resolve({ verdict: 'skipped', reason: 'dshx status printed no verdict' })
    })
  })

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
    let healthTimer
    let healthStarted = false
    let healthVerified = false
    let healthFailure
    const checkSessionSurface = (url, attempt) => {
      healthTimer = setTimeout(
        () => {
          void probeSessionSurface(url).then(({ verdict, reason }) => {
            if (launchedChild.exitCode !== null || stopping) return
            if (verdict === 'healthy') {
              healthVerified = true
              return
            }
            if (verdict === 'skipped') {
              if (attempt === 0) warn(`Session-surface probe skipped: ${reason}.`)
              return
            }
            if (attempt + 1 < HEALTH_PROBE_ATTEMPTS) {
              checkSessionSurface(url, attempt + 1)
              return
            }
            healthFailure = reason
            warn(`DSH answers HTTP but its Session surface is unavailable (${reason}); restarting it.`)
            launchedChild.kill('SIGTERM')
          })
        },
        attempt === 0 ? HEALTH_PROBE_GRACE_MS : HEALTH_PROBE_INTERVAL_MS,
      )
      healthTimer.unref()
    }
    launchedChild.stdout.on('data', chunk => {
      process.stdout.write(chunk)
      const url = LAUNCH_URL_PATTERN.exec(chunk.toString())?.[1]
      if (url === undefined) return
      void writeFile(webUrlPath, `${url}\n`, { mode: 0o600 }).catch(() => undefined)
      refreshTimer ??= setTimeout(() => {
        if (launchedChild.exitCode === null && !stopping) refreshLastKnownGood()
      }, LKG_REFRESH_DELAY_MS)
      refreshTimer.unref()
      if (HEALTH_PROBE_DISABLED || healthStarted) return
      healthStarted = true
      checkSessionSurface(url, 0)
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
      clearTimeout(healthTimer)
      void unlink(webUrlPath).catch(() => undefined)
      const exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)
      void readFile(requestPath, 'utf8')
        .then(async requestId => {
          await unlink(requestPath).catch(() => undefined)
          finish({
            exitCode,
            restartRequested: requestId === runId && code === REQUESTED_RESTART_EXIT_CODE && signal === null,
            healthVerified,
            healthFailure,
          })
        })
        .catch(() => finish({ exitCode, restartRequested: false, healthVerified, healthFailure }))
    })
  })

let crashRestarts = 0
let healthRestarts = 0

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
  if (result.healthVerified) crashRestarts = 0
  if (result.restartRequested) {
    process.stderr.write('[dsh-web-supervisor] Restarting after a confirmed request.\n')
    continue
  }
  if (result.healthFailure !== undefined) {
    healthRestarts += 1
    if (healthRestarts > MAX_HEALTH_RESTARTS) {
      warn(`The Session surface stayed unavailable after ${MAX_HEALTH_RESTARTS} restart(s) (${result.healthFailure}); leaving DSH up for inspection.`)
      process.exitCode = 0
      break
    }
    warn(`Restarting DSH to restore its Session surface (${healthRestarts}/${MAX_HEALTH_RESTARTS}).`)
    continue
  }
  // A clean exit is a shutdown, not a crash: leave the decision to whoever asked for it.
  if (result.exitCode === 0) {
    process.exitCode = 0
    break
  }
  crashRestarts += 1
  if (crashRestarts > MAX_CRASH_RESTARTS) {
    warn(`DSH exited unexpectedly ${crashRestarts} times (last exit ${result.exitCode}); not restarting again.`)
    process.exitCode = result.exitCode
    break
  }
  const backoffMs = CRASH_RESTART_BACKOFF_MS * crashRestarts
  warn(`DSH exited unexpectedly (exit ${result.exitCode}); restarting in ${backoffMs}ms (${crashRestarts}/${MAX_CRASH_RESTARTS}).`)
  await delay(backoffMs)
}
