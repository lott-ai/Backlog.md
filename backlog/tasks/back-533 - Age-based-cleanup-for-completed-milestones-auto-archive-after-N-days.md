---
id: BACK-533
title: Age-based cleanup for completed milestones (auto-archive after N days)
status: Done
assignee:
  - '@grok'
created_date: '2026-07-10 02:52'
updated_date: '2026-07-10 02:57'
labels: []
dependencies: []
ordinal: 114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why
Completed milestones stay active until manually archived. Users need an age-based cooling-off cleanup (like task cleanup) and an optional project default for auto-archive after all tasks have been terminal for N days.

### What
- Compute completed-at from max task updatedDate/createdDate when all tasks are terminal status
- Age-based archive of completed milestones (CLI cleanup, Web cleanup modal, MCP tool)
- Optional config milestoneAutoArchiveDays as default age (unset = disabled)
- No silent archive on read-only list/board paths; close remains archive
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Cleanup selects milestones whose tasks are all terminal and whose latest task date is older than N days
- [x] #2 Milestones with any non-terminal task are not selected
- [x] #3 Empty milestones are not selected
- [x] #4 milestoneAutoArchiveDays is optional config; when unset, no default age is assumed for non-interactive auto policy
- [x] #5 Interactive cleanup (CLI and Web) can preview and confirm age-based milestone archive
- [x] #6 Non-interactive CLI supports age + yes with optional tasks/milestones filters
- [x] #7 MCP can dry-run and execute the same eligibility rules
- [x] #8 Manual milestone archive still works for immediate close
- [x] #9 Read-only commands never archive as a side effect
- [x] #10 Tests cover pure eligibility plus at least one CLI/MCP/server path
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add pure getCompletedMilestonesOlderThan eligibility helper and align isCompleted with terminal status.
2. Add Core getCompletedMilestonesByAge + archiveCompletedMilestonesByAge.
3. Wire milestoneAutoArchiveDays config (types, parse/serialize, get/set).
4. Extend backlog cleanup with milestone step + non-interactive flags.
5. Extend server cleanup API + Web CleanupModal; show completed age on Milestones page.
6. Add MCP milestone_cleanup (dryRun default).
7. Tests for eligibility, core, MCP; tsc + biome.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented age-based milestone archive via shared getCompletedMilestonesOlderThan; cleanup archives milestones before tasks. Tests: eligibility, cleanup core, server, MCP. tsc + biome clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added age-based cleanup for fully completed milestones (terminal-status tasks). Core eligibility uses max task activity date; CLI cleanup gained --age/--yes/--tasks-only/--milestones-only and archives milestones before tasks; Web cleanup modal and API include milestones; MCP milestone_cleanup supports dryRun (default true). Optional config milestoneAutoArchiveDays sets cleanup default age. Verified with bun test (eligibility/cleanup/server/MCP), tsc, and biome.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->
