#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn, spawnSync } from 'node:child_process'

function parseArgs(argv) {
  const args = { root: process.cwd(), port: 4179, host: '0.0.0.0', publicHost: '' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = argv[++i] || args.root
    else if (argv[i] === '--port') args.port = Number(argv[++i] || args.port)
    else if (argv[i] === '--host') args.host = argv[++i] || args.host
    else if (argv[i] === '--public-host') args.publicHost = argv[++i] || args.publicHost
  }
  return args
}

function listen(server, port, host) {
  return new Promise((resolve) => {
    const onError = (error) => {
      server.off('listening', onListening)
      resolve({ ok: false, error })
    }
    const onListening = () => {
      server.off('error', onError)
      resolve({ ok: true, error: null })
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function firstExternalAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return '127.0.0.1'
}

function displayHost(bindHost, publicHost) {
  if (publicHost) return publicHost
  if (bindHost === '0.0.0.0' || bindHost === '::') return firstExternalAddress()
  return bindHost
}

function field(markdown, label) {
  return markdown.match(new RegExp(`^${label}:\\s*(.*)$`, 'm'))?.[1]?.trim() || ''
}

// Tiny YAML frontmatter parser. Supports flat scalar lines and flow-style
// arrays ([a, b, c]). Comma-separated scalars are kept as strings, since the
// schema only treats `tags` as an array.
function parseFrontmatter(body) {
  const match = body.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { data: {}, content: body.trim() }
  const data = {}
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/)
    if (!m) continue
    const key = m[1].trim()
    let value = m[2].trim()
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    } else {
      value = value.replace(/^['"]|['"]$/g, '')
    }
    data[key] = value
  }
  return { data, content: match[2].trim() }
}

export function readArtifacts(missionDir) {
  const dir = path.join(missionDir, 'artifacts')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const file = path.join(dir, entry.name)
      const raw = fs.readFileSync(file, 'utf8')
      const { data, content } = parseFrontmatter(raw)
      const tags = Array.isArray(data.tags) ? data.tags : (data.tags ? [String(data.tags)] : [])
      return {
        filename: entry.name,
        title: data.title || entry.name.replace(/\.md$/, ''),
        author: data.author || '',
        date: data.date || '',
        related: data.related || '',
        tags,
        body: content,
      }
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.filename.localeCompare(b.filename))
}

function processAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

// TCP probe: connect once, resolve true on connect, false on error/timeout.
export function probePort(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function waitForPort(host, port, totalMs = 5000, stepMs = 250) {
  const deadline = Date.now() + totalMs
  while (Date.now() < deadline) {
    if (await probePort(host, port)) return true
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return false
}

function hasCommand(cmd) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'command', process.platform === 'win32' ? [cmd] : ['-v', cmd], { stdio: 'ignore', shell: true })
  return result.status === 0
}

async function reuseRunningBoard(stateFile) {
  if (!fs.existsSync(stateFile)) return null
  let state
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {
    fs.rmSync(stateFile, { force: true })
    return null
  }
  if (!processAlive(state.pid)) {
    fs.rmSync(stateFile, { force: true })
    return null
  }
  // The pid being alive is not enough: the Vite child can die while the parent
  // lingers, leaving a board.json that points at a URL nobody can open. Probe
  // the board port before declaring the board reusable.
  const probeHost = state.host === '0.0.0.0' || state.host === '::' ? '127.0.0.1' : (state.host || '127.0.0.1')
  if (state.boardPort && !(await probePort(probeHost, state.boardPort))) {
    fs.rmSync(stateFile, { force: true })
    return null
  }
  return state
}

let viteExitExpected = false

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = path.resolve(args.root)
  const agentTeamDir = path.join(root, 'agent-team')
  if (!fs.existsSync(agentTeamDir)) {
    console.error('No agent-team/ directory found. Run /mexus-team:mission "<request>" first.')
    process.exit(1)
  }

  const stateDir = path.join(root, '.mexus-agent-team')
  const stateFile = path.join(stateDir, 'board.json')
  const running = await reuseRunningBoard(stateFile)
  if (running) {
    console.log(`Agent Team board already running: ${running.url}`)
    console.log(`Agent Team API: ${running.apiUrl}`)
    return
  }

  if (!hasCommand('pnpm')) {
    console.error('pnpm is not on PATH. The board needs pnpm to start the Vite dev server.')
    console.error('Install pnpm (https://pnpm.io/installation), then re-run /mexus-team:board.')
    process.exit(1)
  }

  const apiServer = http.createServer((req, res) => {
    if (!req.url?.startsWith('/api/agent-team')) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    const missionsDir = path.join(agentTeamDir, 'missions')
    const missions = fs.existsSync(missionsDir)
      ? fs.readdirSync(missionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
        .map((entry) => {
          const dir = path.join(missionsDir, entry.name)
          const mission = readText(path.join(dir, 'mission.md'))
          const artifactsDir = path.join(dir, 'artifacts')
          const mtime = Math.max(
            fs.existsSync(path.join(dir, 'mission.md')) ? fs.statSync(path.join(dir, 'mission.md')).mtimeMs : 0,
            fs.existsSync(path.join(dir, 'kanban.md')) ? fs.statSync(path.join(dir, 'kanban.md')).mtimeMs : 0,
            fs.existsSync(path.join(dir, 'roundtable.md')) ? fs.statSync(path.join(dir, 'roundtable.md')).mtimeMs : 0,
            fs.existsSync(artifactsDir) ? fs.statSync(artifactsDir).mtimeMs : 0,
          )
          return {
            name: entry.name,
            mission,
            agents: readText(path.join(dir, 'agents.md')),
            kanban: readText(path.join(dir, 'kanban.md')),
            roundtable: readText(path.join(dir, 'roundtable.md')),
            squadLead: readText(path.join(dir, 'squad-lead.md')),
            artifacts: readArtifacts(dir),
            lifecycle: field(mission, 'Lifecycle'),
            createdAt: field(mission, 'Created at'),
            mtime,
          }
        })
        .sort((a, b) => {
          if (a.lifecycle === 'active' && b.lifecycle !== 'active') return -1
          if (b.lifecycle === 'active' && a.lifecycle !== 'active') return 1
          const created = String(b.createdAt).localeCompare(String(a.createdAt))
          if (created !== 0) return created
          return b.mtime - a.mtime || a.name.localeCompare(b.name)
        })
        .map(({ lifecycle, createdAt, mtime, ...mission }) => mission)
      : []
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({
      projectRoot: root,
      workflow: readText(path.join(agentTeamDir, 'mission-workflow.md')),
      roster: readText(path.join(agentTeamDir, 'agents.md')),
      missions,
    }))
  })

  let apiPort = args.port + 1000
  while (apiPort < 65536) {
    const result = await listen(apiServer, apiPort, args.host)
    if (result.ok) break
    if (result.error?.code !== 'EADDRINUSE') {
      throw new Error(`Failed to bind Agent Team API on ${args.host}:${apiPort}: ${result.error?.message || result.error}`)
    }
    apiPort += 1
  }
  if (apiPort >= 65536) throw new Error(`No available API port found for host ${args.host}`)

  const publicHost = displayHost(args.host, args.publicHost)
  const boardUrl = `http://${publicHost}:${args.port}`
  const apiUrl = `http://${publicHost}:${apiPort}/api/agent-team`

  const appDir = path.resolve(new URL('../skills/board/board-app', import.meta.url).pathname)
  const vite = spawn('pnpm', ['--dir', appDir, 'dev', '--host', args.host, '--port', String(args.port)], {
    cwd: root,
    env: { ...process.env, AGENT_TEAM_API_PORT: String(apiPort) },
    stdio: 'inherit',
  })

  let viteExited = false
  vite.once('exit', (code, signal) => {
    viteExited = true
    if (!viteExitExpected) {
      console.error(`Vite dev server exited unexpectedly (code=${code}, signal=${signal}).`)
    }
  })

  // Wait until both ports are accepting connections before declaring success.
  // Without this, we may write board.json for a Vite process that crashes
  // moments later, leaving a URL nobody can open.
  const probeHost = args.host === '0.0.0.0' || args.host === '::' ? '127.0.0.1' : args.host
  const liveBoard = await waitForPort(probeHost, args.port, 5000)
  const liveApi = liveBoard ? await waitForPort(probeHost, apiPort, 1500) : false

  if (!liveBoard || !liveApi || viteExited) {
    viteExitExpected = true
    try { vite.kill('SIGTERM') } catch {}
    try { apiServer.close() } catch {}
    console.error('Board failed to start within 5s. Common causes:')
    console.error('  - port ' + args.port + ' or ' + apiPort + ' is already in use')
    console.error('  - board-app dependencies are not installed yet (first run can be slower; re-run after pnpm finishes)')
    console.error('  - the Vite dev server crashed; check the log above')
    process.exit(1)
  }

  fs.mkdirSync(stateDir, { recursive: true })
  const state = {
    pid: process.pid,
    vitePid: vite.pid,
    host: args.host,
    publicHost,
    boardPort: args.port,
    apiPort,
    url: boardUrl,
    apiUrl,
    projectRoot: root,
    startedAt: new Date().toISOString(),
  }
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
  console.log(`Agent Team board: ${state.url}`)
  console.log(`Agent Team API: ${state.apiUrl}`)

  const cleanup = () => {
    viteExitExpected = true
    try { vite.kill('SIGTERM') } catch {}
    try { apiServer.close() } catch {}
    try { fs.rmSync(stateFile, { force: true }) } catch {}
  }
  process.on('SIGINT', () => { cleanup(); process.exit(0) })
  process.on('SIGTERM', () => { cleanup(); process.exit(0) })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
