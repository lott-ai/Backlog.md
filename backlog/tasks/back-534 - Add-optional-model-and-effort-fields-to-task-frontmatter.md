---
id: BACK-534
title: Add optional model and effort fields to task frontmatter
status: Done
assignee:
  - '@lott-ai'
created_date: '2026-07-10 12:28'
updated_date: '2026-07-10 12:41'
labels: []
dependencies: []
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add two optional free-form string properties, model and effort, to task frontmatter so agents/harnesses can record which model and reasoning-effort a task should run with. Values are free-form (Backlog.md is agent/tool-agnostic). Expose across the full surface: domain type, markdown parse/serialize, CLI create/edit + plain view, MCP task tools, Web UI task detail/edit, and TUI task view.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Task type has optional model?: string and effort?: string fields
- [x] #2 Markdown serializer writes model/effort to frontmatter only when set; parser reads them back (round-trips)
- [x] #3 backlog task create and edit accept --model and --effort; values shown in plain view output
- [x] #4 MCP task_create, task_edit, and task_view support model/effort
- [x] #5 Web task detail/edit and TUI task view display and edit model/effort
- [x] #6 Tests cover round-trip serialization and CLI create/edit of the new fields
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Types: add optional model/effort to Task, TaskCreateInput, TaskUpdateInput.
2. Markdown: serializer writes model/effort to frontmatter when set; parser reads trimmed strings.
3. Core backlog.ts: createTaskFromInput includes model/effort when non-empty; updateTask handles model/effort (empty clears).
4. CLI: --model/--effort on create + edit; help-schema fields.
5. Plain formatter: Model/Effort lines (covers CLI plain, TUI viewer, MCP view).
6. MCP: add model/effort to create+edit schemas + handlers + schema-generators.
7. Web server: create + update handlers map model/effort.
8. Web UI TaskDetailsModal: state, refresh sync, save payload, inline update, text-input fields.
9. Tests: serializer round-trip + CLI create/edit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added model/effort as optional free-form strings across the stack, reusing existing patterns:
- Domain: Task, TaskCreateInput, TaskUpdateInput, TaskEditArgs.
- Markdown: serializer writes model/effort only when set (after priority); parser reads trimmed strings.
- Core: createTaskFromInput includes non-empty values; updateTask uses a shared applyOptionalHint helper (empty string clears).
- CLI: --model/--effort on create + edit (+ help-schema fields); empty string clears on edit.
- Plain formatter (task-plain-text.ts) adds Model/Effort lines — single renderer shared by CLI --plain, TUI viewer, and MCP task_view.
- MCP: schema-generators create+edit schemas; create handler wires args; edit reuses buildTaskUpdateInput.
- Web server create+update handlers; Web TaskDetailsModal text inputs (inline update on blur, empty clears).
Validation: bunx tsc --noEmit clean; bun run check . clean; new tests markdown round-trip + cli-model-effort (4) pass; cli-plain-create-edit, cli-refs-docs, all MCP suites pass. Pre-existing unrelated failure in mcp-server.test.ts (expected tool-name list missing definition_of_done_defaults_get) reproduces on clean main — left untouched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added optional free-form model and effort properties to task frontmatter, exposed end-to-end: domain types, markdown parse/serialize (round-trips; omitted when unset), CLI create/edit flags + plain view, MCP task_create/task_edit/task_view, web server routes, and the web TaskDetailsModal (plus TUI/MCP view via the shared plain formatter). Empty string clears the field on edit. Verified with new markdown round-trip tests and a cli-model-effort suite; tsc + biome clean.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 bunx tsc --noEmit passes when TypeScript touched
- [x] #2 bun run check . passes when formatting/linting touched
- [x] #3 bun test (or scoped test) passes
<!-- DOD:END -->
