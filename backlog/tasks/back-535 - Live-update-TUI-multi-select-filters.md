---
id: BACK-535
title: Live-update TUI multi-select filters
status: Done
assignee:
  - '@codex'
created_date: '2026-07-10 13:30'
updated_date: '2026-07-10 13:59'
labels: []
dependencies: []
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every existing TUI multi-select task-list and board filter previews changes immediately on Space. Enter commits that preview; Escape or q restores the filter state and selected task that existed when the dialog opened.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All task-list and board multi-select filters preview their filtered results immediately after each valid Space toggle
- [x] #2 Enter retains the preview and Escape or q restores opening filters, label-match mode, results, and selected task
- [x] #3 Shared picker and popup behavior is covered by component tests, and PTY coverage exercises all existing task-list and board multi-select filters
- [x] #4 Interactive TUI checks run for both source and built CLI output
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend the shared multi-select picker and popup with an internal live-selection callback, preserving final confirmation and cancellation contracts.
2. Wire task-list status, priority, labels, and milestones plus board priority, labels, and milestones to transactionally preview canonical filter state, snapshot opening state, and roll back selection on cancellation.
3. Extract shared interactive test harness utilities and add component, popup, and PTY coverage for live preview, rollback, confirmation, and focus retention.
4. Run focused and full verification, simplify where possible, finalize through Backlog, and commit atomically without pushing.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented live picker callbacks with transactional task-list and board previews, including cancellation rollback to opening filters, label-match mode, and selected task. Validation passed: bunx tsc --noEmit; bun run check .; bash scripts/run-tui-interactive-tests.sh; bun run build; and the complete interactive suite against dist/backlog. Full bun test remains blocked by pre-existing failures: mcp-server expects an obsolete tool list without milestone_cleanup, and board-loading hooks time out.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added live multi-select filter previews with Enter commit and Escape/q rollback across task-list and board TUI filters. Added shared picker/popup tests, PTY coverage, compiled-binary coverage, and CI integration.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->
