import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startMission, detectLanguage } from '../scripts/start-mission.mjs'
import { teamStatus } from '../scripts/status.mjs'
import { readArtifacts, probePort } from '../scripts/start-board.mjs'
import net from 'node:net'

const pluginRoot = path.resolve(new URL('..', import.meta.url).pathname)

const SKILLS = ['mission', 'continue', 'roundtable', 'board', 'status']

for (const file of [
  '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'README.md',
  'skills/mission/SKILL.md',
  'skills/continue/SKILL.md',
  'skills/roundtable/SKILL.md',
  'skills/board/SKILL.md',
  'skills/status/SKILL.md',
  'skills/board/board-app/package.json',
  'references/mission-workflow.md',
  'references/agent-roster-template.md',
  'references/mission-template.md',
  'references/agents-template.md',
  'references/kanban-template.md',
  'references/roundtable-template.md',
  'references/squad-lead-template.md',
  'references/artifact-template.md',
  'scripts/start-mission.mjs',
  'scripts/status.mjs',
  'scripts/start-board.mjs',
]) {
  assert.ok(fs.existsSync(path.join(pluginRoot, file)), `${file} should exist`)
}

const boardPkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'skills/board/board-app/package.json'), 'utf8'))
assert.ok(boardPkg.dependencies?.['react-markdown'], 'board-app should depend on react-markdown')
assert.ok(boardPkg.dependencies?.['remark-gfm'], 'board-app should depend on remark-gfm')

const workflowMd = fs.readFileSync(path.join(pluginRoot, 'references/mission-workflow.md'), 'utf8')
assert.match(workflowMd, /^## Artifacts$/m, 'mission-workflow should document Artifacts')
assert.match(workflowMd, /Acceptance Rule A/i)
assert.match(workflowMd, /Acceptance Rule B/i)
assert.match(workflowMd, /Acceptance Rule C/i)

// team-stop and its script were removed; nobody stops the board explicitly.
assert.ok(!fs.existsSync(path.join(pluginRoot, 'skills/team-stop')), 'team-stop skill should be removed')
assert.ok(!fs.existsSync(path.join(pluginRoot, 'scripts/stop-board.mjs')), 'stop-board.mjs should be removed')

for (const skill of SKILLS) {
  const body = fs.readFileSync(path.join(pluginRoot, 'skills', skill, 'SKILL.md'), 'utf8')
  assert.match(body, /^---\n[\s\S]+?\n---\n/, `${skill} should have frontmatter`)
  assert.match(body, /description: .+/, `${skill} should have description`)
}

// mission only creates; continue only resumes. The two must not overlap.
const missionSkill = fs.readFileSync(path.join(pluginRoot, 'skills/mission/SKILL.md'), 'utf8')
assert.match(missionSkill, /only creates a new Mission/i)
assert.match(missionSkill, /start-board\.mjs/, 'mission should start the board')
const continueSkill = fs.readFileSync(path.join(pluginRoot, 'skills/continue/SKILL.md'), 'utf8')
assert.match(continueSkill, /only continues an existing active Mission/i)
assert.match(continueSkill, /does not .*archive/i, 'continue must state it does not archive Missions')

const boardSkill = fs.readFileSync(path.join(pluginRoot, 'skills/board/SKILL.md'), 'utf8')
assert.match(boardSkill, /--host 0\.0\.0\.0/)
assert.match(boardSkill, /--public-host/)

const startBoardScript = fs.readFileSync(path.join(pluginRoot, 'scripts/start-board.mjs'), 'utf8')
assert.match(startBoardScript, /host: '0\.0\.0\.0'/)
assert.match(startBoardScript, /--public-host/)
assert.match(startBoardScript, /processAlive/, 'start-board should check whether a board process is still alive')

const claudePlugin = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin/plugin.json'), 'utf8'))
assert.equal(claudePlugin.name, 'mexus-team')

const codexPlugin = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'))
assert.equal(codexPlugin.name, 'mexus-team')

const marketplace = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin/marketplace.json'), 'utf8'))
assert.equal(marketplace.name, 'mexus-team')
assert.ok(Array.isArray(marketplace.plugins), 'marketplace plugins should be an array')
assert.ok(
  marketplace.plugins.some((plugin) => plugin.name === 'mexus-team' && plugin.source === './'),
  'marketplace should include a bundle entry at ./',
)
for (const skill of SKILLS) {
  assert.ok(
    marketplace.plugins.some(
      (plugin) => plugin.name === `mexus-team-${skill}` && plugin.source === `./skills/${skill}`,
    ),
    `marketplace should include per-skill entry for ${skill}`,
  )
}

const readme = fs.readFileSync(path.join(pluginRoot, 'README.md'), 'utf8')
assert.match(readme, /\/mexus-team:mission/)
assert.match(readme, /\/mexus-team:continue/)
assert.match(readme, /\/mexus-team:roundtable/)
assert.doesNotMatch(readme, /mexus-skill/)
assert.doesNotMatch(readme, /^\/team/m)

const forbiddenRuntimeTerms = [
  'mexus pane create',
  'mexus mission activate',
  'MissionInboxPipeline',
  'external A2A',
]
for (const rel of ['README.md', 'skills/mission/SKILL.md']) {
  const body = fs.readFileSync(path.join(pluginRoot, rel), 'utf8')
  for (const term of forbiddenRuntimeTerms) {
    if (term === 'external A2A') {
      assert.match(
        body,
        /no external A2A|without external A2A|Do not use external A2A|does not require[^.]*A2A/i,
        `${rel} should explicitly reject external A2A`,
      )
    } else {
      assert.ok(!body.includes(term), `${rel} should not depend on ${term}`)
    }
  }
  assert.match(body, /does not require.*Mission Inbox|no .*Mission Inbox|without .*Mission Inbox|must not .*Mission Inbox/i, `${rel} should reject Mission Inbox dependency`)
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mexus-agent-team-standalone-'))
const created = startMission([
  '--root',
  temp,
  '--name',
  'demo-mission',
  '--request',
  'Build a demo feature with background Agents',
])

assert.equal(created.mission, 'demo-mission')
assert.deepEqual(created.archived, [])

for (const file of [
  'agent-team/mission-workflow.md',
  'agent-team/agents.md',
  'agent-team/missions/demo-mission/mission.md',
  'agent-team/missions/demo-mission/agents.md',
  'agent-team/missions/demo-mission/kanban.md',
  'agent-team/missions/demo-mission/roundtable.md',
  'agent-team/missions/demo-mission/squad-lead.md',
]) {
  assert.ok(fs.existsSync(path.join(temp, file)), `${file} should be generated`)
}

const mission = fs.readFileSync(path.join(temp, 'agent-team/missions/demo-mission/mission.md'), 'utf8')
assert.match(mission, /Execution mode: background-agents/)
assert.match(mission, /Do not require a Mexus server/)
assert.match(mission, /external A2A/)
assert.match(mission, /Each executing background Agent/)
assert.match(mission, /^Output language: en$/m, 'English request should yield Output language: en')

// detectLanguage: heuristic returns zh for any CJK character, en otherwise.
assert.equal(detectLanguage('Build the next feature'), 'en')
assert.equal(detectLanguage('调研 Q2 竞品定价'), 'zh')
assert.equal(detectLanguage(''), 'en')
assert.equal(detectLanguage('mixed text 含汉字'), 'zh')

// The seed Agent name is drawn at random from the Ars Goetia set.
const ARS_GOETIA = [
  'Bael', 'Agares', 'Vassago', 'Samigina', 'Marbas', 'Valefor', 'Amon', 'Barbatos',
  'Paimon', 'Buer', 'Gusion', 'Sitri', 'Beleth', 'Leraje', 'Eligos', 'Zepar',
  'Botis', 'Bathin', 'Sallos', 'Purson', 'Marax', 'Ipos', 'Aim', 'Naberius',
  'Glasya', 'Bune', 'Ronove', 'Berith', 'Astaroth', 'Forneus', 'Foras', 'Asmoday',
  'Gaap', 'Furfur', 'Marchosias', 'Stolas', 'Phenex', 'Halphas', 'Malphas', 'Raum',
  'Focalor', 'Vepar', 'Sabnock', 'Shax', 'Vine', 'Bifrons', 'Vual', 'Haagenti',
  'Crocell', 'Furcas', 'Balam', 'Alloces', 'Caim', 'Murmur', 'Orobas', 'Gremory',
  'Ose', 'Amy', 'Orias', 'Vapula', 'Zagan', 'Valac', 'Andras', 'Flauros',
  'Andrealphus', 'Kimaris', 'Amdusias', 'Belial', 'Decarabia', 'Seere', 'Dantalion', 'Andromalius',
]

const agents = fs.readFileSync(path.join(temp, 'agent-team/missions/demo-mission/agents.md'), 'utf8')
assert.match(agents, /Squad Lead: Squad Lead/)
assert.match(agents, /background Agent/)
assert.match(agents, /Modules:/)
assert.match(agents, /kanban\.md is the communication channel/)
const seedName = agents.match(/^## Agent: (\S+)\s*$/m)?.[1]
assert.ok(seedName && ARS_GOETIA.includes(seedName), `seed Agent name should be an Ars Goetia name, got: ${seedName}`)

const status = teamStatus(['--root', temp, '--name', 'demo-mission'])
assert.match(status, /Mission: demo-mission/)
assert.match(status, /Tasks: 1 to claim \/ 0 in progress \/ 0 done/)

const kanban = fs.readFileSync(path.join(temp, 'agent-team/missions/demo-mission/kanban.md'), 'utf8')
assert.match(kanban, new RegExp(`To: ${seedName} \\| From: Squad Lead`))
assert.doesNotMatch(kanban, /From: User|Updated: .*User/)
assert.doesNotMatch(kanban, /To: Squad Lead/)

const second = startMission([
  '--root',
  temp,
  '--name',
  'second-mission',
  '--request',
  'Build a second demo feature',
])
assert.equal(second.mission, 'second-mission')
assert.deepEqual(second.archived, ['demo-mission'])

const archivedMission = fs.readFileSync(path.join(temp, 'agent-team/missions/demo-mission/mission.md'), 'utf8')
const activeMission = fs.readFileSync(path.join(temp, 'agent-team/missions/second-mission/mission.md'), 'utf8')
assert.match(archivedMission, /Lifecycle: archived/)
assert.match(activeMission, /Lifecycle: active/)

// Artifacts: write two md files into the mission's artifacts/ directory and
// assert readArtifacts() returns them sorted by date desc with frontmatter parsed.
const artifactsDir = path.join(temp, 'agent-team/missions/second-mission/artifacts')
fs.mkdirSync(artifactsDir, { recursive: true })
fs.writeFileSync(path.join(artifactsDir, '2026-06-04-market.md'), `---
title: Market scan
author: Marbas
date: 2026-06-04
related: kt-a1b2
tags: [pricing, q1]
---

# Market scan

Body text.
`)
fs.writeFileSync(path.join(artifactsDir, '2026-06-05-rt-api.md'), `---
title: Decision — API boundary
author: Foras
date: 2026-06-05
related: rt-api
tags: [decision]
---

# Decision

Decision body.
`)

const parsedArtifacts = readArtifacts(path.join(temp, 'agent-team/missions/second-mission'))
assert.equal(parsedArtifacts.length, 2, 'should parse both artifact files')
assert.equal(parsedArtifacts[0].filename, '2026-06-05-rt-api.md', 'newest date should sort first')
assert.equal(parsedArtifacts[0].title, 'Decision — API boundary')
assert.equal(parsedArtifacts[0].author, 'Foras')
assert.deepEqual(parsedArtifacts[0].tags, ['decision'])
assert.equal(parsedArtifacts[1].filename, '2026-06-04-market.md')
assert.deepEqual(parsedArtifacts[1].tags, ['pricing', 'q1'])
assert.match(parsedArtifacts[1].body, /^# Market scan/)
assert.equal(readArtifacts(path.join(temp, 'agent-team/missions/demo-mission')).length, 0, 'missions without artifacts/ should return []')

// Chinese request must set Output language: zh, but structural words in kanban
// and roundtable templates must stay English (the parsing protocol is stable).
const tempZh = fs.mkdtempSync(path.join(os.tmpdir(), 'mexus-agent-team-zh-'))
startMission(['--root', tempZh, '--name', 'zh-mission', '--request', '调研 Q2 竞品定价并产出市场扫描报告'])
const zhMission = fs.readFileSync(path.join(tempZh, 'agent-team/missions/zh-mission/mission.md'), 'utf8')
assert.match(zhMission, /^Output language: zh$/m, 'Chinese request should yield Output language: zh')
const zhKanban = fs.readFileSync(path.join(tempZh, 'agent-team/missions/zh-mission/kanban.md'), 'utf8')
assert.match(zhKanban, /^## To Claim$/m, 'kanban status headings stay English')
assert.match(zhKanban, /^## In Progress$/m)
assert.match(zhKanban, /^## Done$/m)
assert.match(zhKanban, /^- Request:/m, 'kanban field names stay English')
assert.match(zhKanban, /^- Acceptance:/m)
const zhRoundtable = fs.readFileSync(path.join(tempZh, 'agent-team/missions/zh-mission/roundtable.md'), 'utf8')
assert.match(zhRoundtable, /^## Pending Review$/m, 'roundtable section headings stay English')

// probePort: a listening TCP server should answer true; an unbound port should
// answer false within the timeout. This backs the board liveness check so
// start-board only reports success when the board is actually reachable.
const probeServer = net.createServer()
await new Promise((resolve) => probeServer.listen(0, '127.0.0.1', resolve))
const probePort1 = probeServer.address().port
assert.equal(await probePort('127.0.0.1', probePort1, 500), true, 'probePort should detect a listening server')
await new Promise((resolve) => probeServer.close(resolve))
assert.equal(await probePort('127.0.0.1', probePort1, 300), false, 'probePort should return false once the server is closed')
// An almost-certainly-unbound high port should fail fast.
assert.equal(await probePort('127.0.0.1', 1, 300), false, 'probePort should return false for an unbound port')

console.log('mexus-agent-team standalone smoke passed')
