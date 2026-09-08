# Project Re-entry

A local-first workspace for quickly understanding an interrupted software project and taking the next useful action.

## Current increment

This initial product shell implements the primary reading experience:

- a short, six-part re-entry brief
- clear distinction between evidence-backed claims and suggestions
- clickable evidence citations with a supporting-evidence panel
- source coverage and uncertainty messaging
- local project onboarding UI with optional notes and exclusions
- editable session checkpoint flow
- responsive, no-account interface

The included brief is deliberately sample data. It is a useful interaction and visual baseline, but it does **not** yet read a local repository, persist project state, or call a model provider. The UI makes that limitation explicit rather than presenting mock evidence as real project analysis.

## Run locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints (normally `http://localhost:5173`).

## Verify

```bash
npm run build
npm run lint
```

## Delivery plan

1. Add a local evidence service: safe Git metadata, diffs, selected Markdown/text notes, ignored-path and secret/binary exclusions.
2. Persist projects, sources, corrections, checkpoints, and snapshot revisions in per-project SQLite state outside the repository.
3. Generate the six-section brief from structured evidence, with deterministic provenance and a configurable model adapter.
4. Add refresh, correction/supersession controls, partial-failure handling, and Markdown export.
5. Create a snapshotted evaluation set before integrating SkillOpt for instruction optimization.

## Product boundaries

Project Re-entry is read-only with respect to the source repository. It is not an autonomous coding, deployment, or general project-management tool. Source content is treated as data, never as instructions to execute.
