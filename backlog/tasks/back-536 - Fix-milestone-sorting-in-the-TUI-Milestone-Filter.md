---
id: BACK-536
title: Fix milestone sorting in the TUI Milestone Filter
status: Done
assignee:
  - '@lott-ai'
created_date: '2026-07-10 16:44'
updated_date: '2026-07-10 16:46'
labels: []
dependencies: []
ordinal: 116000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Milestone Filter popup lists milestones lexicographically (m-0, m-1, m-10, m-2...) instead of numerically. buildMilestonePickerLabels and buildAvailableMilestonePickerLabels in src/utils/milestone-filter.ts sort formatted label strings with plain localeCompare, missing the { numeric: true } option that the loader (operations.ts listMilestones) already uses. Fix both sorts to use numeric collation and add a test with ids >= 10.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added { numeric: true } to the two localeCompare sorts in src/utils/milestone-filter.ts (buildMilestonePickerLabels, buildAvailableMilestonePickerLabels), matching listMilestones in operations.ts. Added a numeric-ordering test (ids >= 10) in task-viewer-milestone-filter-model.test.ts. Verified both sort sites order m-0..m-14 numerically; tests, tsc, and biome pass.
<!-- SECTION:NOTES:END -->
