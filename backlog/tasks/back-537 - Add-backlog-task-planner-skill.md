---
id: BACK-537
title: Add backlog task planner skill
status: Done
assignee:
  - '@codex'
created_date: '2026-07-11 04:30'
updated_date: '2026-07-11 04:33'
labels: []
dependencies: []
modified_files:
  - skills/backlog-task-planner/SKILL.md
  - skills/backlog-task-planner/agents/openai.yaml
ordinal: 117000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a reusable Agent Skill that turns an approved plan into a Backlog milestone and dependency-aware tasks, has a read-only subagent review coverage and parallelization, incorporates valid feedback, and lands the tracker-only commit on local main without pushing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The skill consumes the latest approved plan and creates a milestone plus self-contained tasks exclusively through public Backlog CLI surfaces
- [x] #2 Task dependencies maximize safe parallel execution and are rechecked with backlog sequence list
- [x] #3 A read-only subagent reviews plan coverage and parallelization before valid feedback is applied
- [x] #4 The workflow commits only created milestone and task files, lands locally on main, cleans up its worktree, and never pushes
- [x] #5 The repository skill includes matching UI metadata and is installed as a personal skill
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Scaffold backlog-task-planner beside the existing orchestrator skill. 2. Replace the scaffold with the approved CLI-only planning, review, and local landing workflow. 3. Finalize the Backlog task and commit the task plus skill as one atomic change. 4. Fast-forward the commit to local main, clean up the worktree and branch, and install the personal copy. Validation is intentionally deferred to the user.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the planner as a compact two-file skill matching the existing orchestrator structure. It uses only documented Backlog CLI and instruction surfaces, requires an independent read-only review, and lands only tracker artifacts through a dedicated worktree. Installed the same skill under ~/.agents/skills/backlog-task-planner. Automated validation and tests were intentionally deferred to the user.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added and installed backlog-task-planner. The skill converts an approved plan into a dependency-aware Backlog milestone, incorporates a read-only subagent review, and fast-forwards the tracker-only commit to local main without pushing. Validation was not run at the user’s request.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [ ] #3 bun test (or scoped test) passes
<!-- DOD:END -->
