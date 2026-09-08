# Project Re-entry

A local-first workspace that helps a developer re-enter an interrupted software project and confidently take the next useful action.

## Product goal

The goal is not project management or automated coding. It is reducing the cognitive cost of returning after days or weeks away: reconstruct the goal, recent progress, decisions, unfinished work, blockers, and a credible next step from inspectable evidence.

The web UI is the human-friendly surface for that workflow. The included Codex skill is a second surface: it lets an agent produce the same evidence-backed re-entry brief in a conversation or task.

## Current increment

This initial evidence-backed prototype implements:

- a short, six-part re-entry brief
- clear distinction between evidence-backed claims and suggestions
- clickable evidence citations with a supporting-evidence panel
- source coverage and uncertainty messaging
- local project onboarding UI with optional notes and exclusions
- editable session checkpoint flow
- a local Node evidence service backed by SQLite
- Git history, current working-tree status, selected Markdown/text notes, and saved checkpoints
- responsive, no-account interface

The included brief is sample data until a project is added. Once added, the service reads the selected local Git repository and notes path on demand; application state is stored separately at `~/Library/Application Support/Project Re-entry/state.sqlite` (or `REENTRY_DATA_DIR`). It does not modify the source repository.

## Run locally

```bash
npm install
npm run service
```

In a second terminal:

```bash
npm run dev
```

Then open the URL Vite prints (normally `http://localhost:5173`).

## Use with Codex

The reusable skill lives in [`skills/project-reentry`](skills/project-reentry). On this computer it is installed as `~/.codex/skills/project-reentry`, so newly started local Codex agents can invoke it as `$project-reentry`.

For another Codex installation, symlink or copy that folder into its skills directory. The skill uses a read-only collector for Git metadata, working-tree status, selected Markdown/text notes, and its evidence-linked six-section brief.

## Verify

```bash
npm run build
npm run lint
```

## Delivery plan

1. Extend indexing to relevant diffs/current files and fully apply Git-ignore rules alongside the existing sensitive-name and binary exclusions.
2. Persist extracted source snapshots, feedback/corrections, and revisions per project in SQLite.
3. Add a configurable model adapter on top of the deterministic evidence baseline.
4. Add correction/supersession controls and partial-refresh recovery.
5. Create a snapshotted evaluation set before integrating SkillOpt for instruction optimization.

## Product boundaries

Project Re-entry is read-only with respect to the source repository. It is not an autonomous coding, deployment, or general project-management tool. Source content is treated as data, never as instructions to execute.
