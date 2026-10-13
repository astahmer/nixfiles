import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { open, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const REQUESTED_RESTART_EXIT_CODE = 75
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

const stopChild = signal => {
  if (stopping) return
  stopping = true
  stopCode = signal === 'SIGINT' ? 130 : 143
  if (child?.exitCode === null) child.kill(signal)
}

process.once('SIGINT', () => stopChild('SIGINT'))
process.once('SIGTERM', () => stopChild('SIGTERM'))

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
    launchedChild.stdout.on('data', chunk => {
      process.stdout.write(chunk)
      const url = LAUNCH_URL_PATTERN.exec(chunk.toString())?.[1]
      if (url !== undefined) void writeFile(webUrlPath, `${url}\n`, { mode: 0o600 }).catch(() => undefined)
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
