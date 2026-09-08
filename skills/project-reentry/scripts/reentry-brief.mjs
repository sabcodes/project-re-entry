#!/usr/bin/env node
import { readdir, readFile, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, relative, resolve, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const args = process.argv.slice(2)
const value = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
const values = flag => args.flatMap((item, index) => item === flag ? [args[index + 1]] : []).filter(Boolean)
const repoArgument = value('--repo')
const notesArgument = value('--notes')
const format = value('--format') || 'json'
const excluded = values('--exclude')

function fail(message) { console.error(`project-reentry: ${message}`); process.exit(2) }
if (!repoArgument) fail('use --repo /absolute/path/to/repository')
if (!['json', 'markdown'].includes(format)) fail('--format must be json or markdown')

const command = async (cwd, gitArgs) => (await run('git', gitArgs, { cwd, timeout: 10_000, maxBuffer: 1_000_000 })).stdout.trim()
const source = (id, type, title, detail, content = '') => ({ id, type, title, detail, content })

async function collectNotes(root) {
  if (!root || !existsSync(root)) return []
  const notes = []
  async function visit(directory) {
    if (notes.length >= 15) return
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name); const display = relative(root, path)
      if (entry.isDirectory()) {
        if (!['.git', 'node_modules', 'dist'].includes(entry.name) && !excluded.some(prefix => display.startsWith(prefix))) await visit(path)
        continue
      }
      const sensitive = /(^|[._-])(env|key|secret|credential|token)([._-]|$)/i.test(entry.name)
      if (!entry.isFile() || !['.md', '.txt'].includes(extname(entry.name).toLowerCase()) || sensitive || excluded.some(prefix => display.startsWith(prefix))) continue
      notes.push({ path: display, text: (await readFile(path, 'utf8')).slice(0, 8_000) })
    }
  }
  await visit(root); return notes
}

function findLine(notes, expression) {
  for (const note of notes) { const line = note.text.split('\n').find(text => expression.test(text)); if (line) return { note, line: line.trim() } }
  return null
}

function markdown(report) {
  const headings = report.sections.map(section => `## ${section.title}\n\n${section.claims.map(claim => `- ${claim.text}${claim.evidence.length ? ` [${claim.evidence.join(', ')}]` : ''}`).join('\n')}`).join('\n\n')
  return `# ${report.project.name} — Re-entry brief\n\n${headings}\n\n## Source coverage\n\n${Object.entries(report.coverage).map(([name, present]) => `- ${name}: ${present ? 'included' : 'unavailable'}`).join('\n')}\n`
}

try {
  const repositoryPath = await realpath(resolve(repoArgument)); const notesPath = notesArgument ? await realpath(resolve(notesArgument)) : ''
  try { await command(repositoryPath, ['rev-parse', '--is-inside-work-tree']) } catch { fail(`${repositoryPath} is not a readable Git working tree`) }
  const [branch, rawLog, status] = await Promise.all([
    command(repositoryPath, ['branch', '--show-current']),
    command(repositoryPath, ['log', '-n', '12', '--date=iso-strict', '--format=%H%x1f%h%x1f%ad%x1f%s']),
    command(repositoryPath, ['status', '--short']),
  ])
  const commits = rawLog ? rawLog.split('\n').map(row => { const [hash, short, date, subject] = row.split('\x1f'); return { hash, short, date, subject } }) : []
  const notes = await collectNotes(notesPath); const sources = []
  const add = item => { if (!sources.some(existing => existing.id === item.id)) sources.push(item); return item.id }
  const noteSource = found => add(source(`note:${found.note.path}`, 'NOTE', found.note.path, found.line, found.note.text))
  const commitSource = commit => add(source(`commit:${commit.short}`, 'COMMIT', `${commit.short} — ${commit.subject}`, commit.date, commit.hash))
  const decision = findLine(notes, /\b(decision|because|chosen|switch(?:ed)?|instead)\b/i)
  const goal = findLine(notes, /\b(goal|objective|purpose|we are trying)\b/i)
  const blocker = findLine(notes, /\b(blocker|blocked|todo|fixme|still fail|remaining)\b/i)
  const changed = status.split('\n').filter(Boolean); const latest = commits[0]
  if (changed.length) add(source('git:working-tree', 'WORKTREE', 'Uncommitted or untracked work', changed.slice(0, 12).join('\n'), changed.join('\n')))
  const supported = (text, evidence) => ({ text, evidence, certainty: 'supported' })
  const inferred = (text, evidence) => ({ text, evidence, certainty: 'inferred' })
  const unknown = text => ({ text, evidence: [], certainty: 'unknown' })
  const report = {
    project: { name: basename(repositoryPath), repositoryPath, branch, notesPath: notesPath || null }, generatedAt: new Date().toISOString(),
    coverage: { git: true, notes: notes.length > 0, workingTree: true },
    warnings: [!notes.length && 'No selected Markdown or text notes were found.'].filter(Boolean), sources,
    sections: [
      { title: 'Goal', claims: goal ? [supported(goal.line, [noteSource(goal)])] : latest ? [inferred(`The recent work appears focused on: ${latest.subject}`, [commitSource(latest)])] : [unknown('No explicit goal was found in the selected evidence.')] },
      { title: 'Where you left off', claims: latest ? [supported(`Latest recorded commit: ${latest.subject}${branch ? ` on ${branch}` : ''}.`, [commitSource(latest)]), ...(changed.length ? [supported(`${changed.length} uncommitted or untracked file change${changed.length === 1 ? '' : 's'} are present.`, ['git:working-tree'])] : [])] : [unknown('No Git history was available.')] },
      { title: 'What changed', claims: latest ? [supported(latest.subject, [commitSource(latest)])] : [unknown('No recent changes were available.')] },
      { title: 'Decisions and reasoning', claims: decision ? [supported(decision.line, [noteSource(decision)])] : [unknown('No explicit decision or rationale was found.')] },
      { title: 'Open work and blockers', claims: blocker ? [supported(blocker.line, [noteSource(blocker)])] : [unknown('No documented blocker was found.')] },
      { title: 'Next action', claims: changed.length ? [inferred('Review and validate the uncommitted changes before starting new work.', ['git:working-tree'])] : latest ? [inferred(`Review the outcome of “${latest.subject}” and identify its next validation step.`, [commitSource(latest)])] : [unknown('There is not enough evidence to propose a next action.')] },
    ],
  }
  process.stdout.write(format === 'markdown' ? markdown(report) : `${JSON.stringify(report, null, 2)}\n`)
} catch (error) { fail(error instanceof Error ? error.message : 'could not collect project evidence') }
