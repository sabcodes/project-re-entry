import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, readdir, readFile, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename, extname, relative, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const run = promisify(execFile)
const dataDir = process.env.REENTRY_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'Project Re-entry')
await mkdir(dataDir, { recursive: true })
const db = new DatabaseSync(join(dataDir, 'state.sqlite'))
db.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, repository_path TEXT, notes_path TEXT, excluded_paths TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, project_id TEXT, content TEXT, created_at TEXT);`)

const json = (response, status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }
const command = async (cwd, args) => (await run('git', args, { cwd, timeout: 10_000, maxBuffer: 1_000_000 })).stdout.trim()
const source = (id, type, title, detail, content = '') => ({ id, type, title, detail, content })

async function collectNotes(root, excluded) {
  if (!root || !existsSync(root)) return []
  const results = []
  async function visit(directory) {
    if (results.length >= 15) return
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name); const display = relative(root, full)
      if (entry.isDirectory()) { if (!['.git', 'node_modules', 'dist'].includes(entry.name) && !excluded.some(path => display.startsWith(path))) await visit(full); continue }
      if (!entry.isFile() || !['.md', '.txt'].includes(extname(entry.name).toLowerCase()) || /(^|[._-])(env|key|secret|credential|token)([._-]|$)/i.test(entry.name) || excluded.some(path => display.startsWith(path))) continue
      const text = await readFile(full, 'utf8'); results.push({ path: display, text: text.slice(0, 8000) })
    }
  }
  await visit(root); return results
}

function findLine(notes, expression) { for (const note of notes) { const line = note.text.split('\n').find(value => expression.test(value)); if (line) return { note, line: line.trim() } } return null }

async function makeBrief(project) {
  const excluded = JSON.parse(project.excluded_paths || '[]'); let gitAvailable = true; let log = []; let status = ''; let branch = ''
  try { branch = await command(project.repository_path, ['branch', '--show-current']); const raw = await command(project.repository_path, ['log', '-n', '12', '--date=iso-strict', '--format=%H%x1f%h%x1f%ad%x1f%s']); log = raw ? raw.split('\n').map(row => { const [hash, short, date, subject] = row.split('\x1f'); return { hash, short, date, subject } }) : []; status = await command(project.repository_path, ['status', '--short']) } catch { gitAvailable = false }
  const notes = await collectNotes(project.notes_path, excluded); const checkpoint = db.prepare('SELECT * FROM checkpoints WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(project.id)
  const sources = []
  const noteSource = (note, line, kind = 'NOTE') => { const id = `note:${note.path}`; if (!sources.some(item => item.id === id)) sources.push(source(id, kind, note.path, line, note.text)); return id }
  const commitSource = commit => { const id = `commit:${commit.short}`; sources.push(source(id, 'COMMIT', `${commit.short} — ${commit.subject}`, commit.date, commit.hash)); return id }
  const decision = findLine(notes, /\b(decision|because|chosen|switch(?:ed)?|instead)\b/i); const goal = findLine(notes, /\b(goal|objective|purpose|we are trying)\b/i); const blocker = findLine(notes, /\b(blocker|blocked|todo|fixme|still fail|remaining)\b/i)
  const latest = log[0]; const changed = status.split('\n').filter(Boolean)
  if (changed.length) sources.push(source('git:working-tree', 'WORKTREE', 'Uncommitted or untracked work', changed.slice(0, 12).join('\n'), changed.join('\n')))
  if (checkpoint) sources.push(source(`checkpoint:${checkpoint.id}`, 'CHECKPOINT', 'Last checkpoint', checkpoint.created_at, checkpoint.content))
  const supported = (text, evidence) => ({ text, evidence, certainty: 'supported' })
  const inferred = (text, evidence) => ({ text, evidence, certainty: 'inferred' })
  const unknown = text => ({ text, evidence: [], certainty: 'unknown' })
  const sections = [
    { title: 'Goal', claims: goal ? [supported(goal.line, [noteSource(goal.note, goal.line)])] : latest ? [inferred(`The recent work appears focused on: ${latest.subject}`, [commitSource(latest)])] : [unknown('No explicit goal was found in the selected evidence.')] },
    { title: 'Where you left off', claims: latest ? [supported(`Latest recorded commit: ${latest.subject}${branch ? ` on ${branch}` : ''}.`, [commitSource(latest)]), ...(changed.length ? [supported(`${changed.length} uncommitted or untracked file change${changed.length === 1 ? '' : 's'} are present.`, ['git:working-tree'])] : [])] : [unknown('No Git history was available.')] },
    { title: 'What changed', claims: latest ? [supported(latest.subject, [commitSource(latest)])] : [unknown('No recent changes were available.')] },
    { title: 'Decisions and reasoning', claims: decision ? [supported(decision.line, [noteSource(decision.note, decision.line)])] : [unknown('No explicit decision or rationale was found.')] },
    { title: 'Open work and blockers', claims: blocker ? [supported(blocker.line, [noteSource(blocker.note, blocker.line)])] : checkpoint ? [supported('Review the last checkpoint for unresolved work.', [`checkpoint:${checkpoint.id}`])] : [unknown('No documented blocker was found.')] },
    { title: 'Next action', claims: checkpoint ? [inferred('Review the saved checkpoint and complete its stated next step.', [`checkpoint:${checkpoint.id}`])] : changed.length ? [inferred('Review and validate the uncommitted changes before starting new work.', ['git:working-tree'])] : latest ? [inferred(`Review the outcome of “${latest.subject}” and identify its next validation step.`, [commitSource(latest)])] : [unknown('There is not enough evidence to propose a next action.')] },
  ]
  return { brief: { generatedAt: new Date().toISOString(), coverage: { git: gitAvailable, notes: notes.length > 0, workingTree: gitAvailable }, warnings: [!gitAvailable && 'Git history could not be read.', !notes.length && 'No selected Markdown or text notes were found.'].filter(Boolean), sections }, sources }
}

async function body(request) { let raw = ''; for await (const chunk of request) raw += chunk; return raw ? JSON.parse(raw) : {} }
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost'); const match = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(brief|checkpoints))?$/)
    if (request.method === 'GET' && url.pathname === '/api/projects') { const projects = db.prepare('SELECT id, name, repository_path AS repositoryPath, notes_path AS notesPath, updated_at AS updatedAt FROM projects ORDER BY updated_at DESC').all(); return json(response, 200, projects) }
    if (request.method === 'POST' && url.pathname === '/api/projects') { const input = await body(request); if (!input.repositoryPath) return json(response, 400, { error: 'A repository path is required.' }); const repositoryPath = await realpath(resolve(input.repositoryPath)); try { await command(repositoryPath, ['rev-parse', '--is-inside-work-tree']) } catch { return json(response, 400, { error: 'That path is not a readable Git working tree.' }) }; const now = new Date().toISOString(); const project = { id: randomUUID(), name: basename(repositoryPath), repositoryPath, notesPath: input.notesPath ? await realpath(resolve(input.notesPath)) : '', updatedAt: now }; db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)').run(project.id, project.name, repositoryPath, project.notesPath, JSON.stringify(input.excludedPaths || []), now, now); return json(response, 201, { project }) }
    if (match) { const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(match[1]); if (!project) return json(response, 404, { error: 'Project not found.' }); if (request.method === 'POST' && match[2] === 'brief') return json(response, 200, await makeBrief(project)); if (request.method === 'POST' && match[2] === 'checkpoints') { const input = await body(request); if (!input.content?.trim()) return json(response, 400, { error: 'Checkpoint content is required.' }); const id = randomUUID(), now = new Date().toISOString(); db.prepare('INSERT INTO checkpoints VALUES (?, ?, ?, ?)').run(id, project.id, input.content.trim(), now); return json(response, 201, { id, createdAt: now }) } }
    json(response, 404, { error: 'Not found.' })
  } catch (error) { json(response, 500, { error: error instanceof Error ? error.message : 'Unexpected server error.' }) }
})
server.listen(process.env.PORT || 8787, () => console.log(`Project Re-entry service running at http://localhost:${process.env.PORT || 8787}`))
