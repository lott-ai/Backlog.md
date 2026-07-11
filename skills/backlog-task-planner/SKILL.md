---
name: backlog-task-planner
description: Convert an approved implementation plan into a Backlog.md milestone and dependency-aware task graph, have a read-only subagent review coverage and parallelization, incorporate valid feedback, and land the tracker-only commit on local main. Use when the user asks to create a milestone and tasks from a plan, turn a plan into Backlog work, optimize task dependencies for multiple agents, review a task breakdown, or commit the resulting milestone and task files without implementing the plan.
---

# Backlog Task Planner

## Overview

Turn the latest approved plan into implementation-ready Backlog tasks. Preserve the plan's scope, maximize safe parallel work, obtain an independent review of the task graph, and land only the created tracker files on local `main`. Never implement the plan and never push.

## Inputs And Preconditions

- Use the latest complete approved plan in the conversation. When later revisions replace an earlier plan, use only the latest complete version.
- Require a Git repository with Backlog.md initialized and a local `main` branch.
- Require subagent tooling for the independent task review.

If no complete plan is available, ask the user to provide or approve one and stop. If the harness is still in Plan Mode or otherwise disallows mutations, tell the user to exit that mode and invoke the skill again. If subagent tooling is unavailable, report that the required independent review cannot run and stop before creating or committing tracker files.

## Ground Rules

- Run `backlog instructions overview` before any other Backlog action, then read `backlog instructions task-creation`.
- Use `backlog <command> --help` before unfamiliar commands.
- Use the Backlog CLI only. Never edit task, milestone, draft, document, or decision Markdown directly.
- Read and honor repository instructions before choosing names, worktree paths, task structure, or commit messages.
- Treat CLI help, shipped instructions, MCP schemas/resources, and documented configuration as the public Backlog contract. Do not depend on Backlog source internals.
- Treat the approved plan as the scope boundary. Do not implement it, add speculative work, or silently resolve product ambiguity.
- Preserve unrelated changes. Never stage them, revert them, or include them in the planning commit.
- Keep all Git operations local. Never push branches, tags, commits, or other refs.

## Prepare A Planning Worktree

1. Inspect the current repository state:

   ```bash
   git status --short --branch
   git worktree list --porcelain
   git branch --list main
   ```

2. Require a clean checkout that can safely receive a fast-forward onto `main`. If `main` is missing, dirty, or checked out in an unsafe state, stop and explain the blocker before mutating Backlog state.
3. Derive a short kebab-case slug from the plan title and create a dedicated branch and worktree from `main`. Honor a repository-specific convention when one exists; otherwise use:

   ```bash
   git worktree add -b planning/<slug> ../.worktrees/<repo-name>/planning/<slug> main
   ```

4. Run every Backlog mutation, review, and planning commit from that worktree.

## Resolve The Milestone

1. Search active and completed milestones plus existing tasks for the plan title and its main feature terms:

   ```bash
   backlog milestone list --show-completed --plain
   backlog search "<feature terms>" --plain
   ```

2. If an existing milestone or task set substantially overlaps the approved plan, stop and ask whether to reuse or replace it. Do not create duplicate tracking silently.
3. Derive a concise milestone title from the plan's outcome and a description that records the goal and boundaries.
4. Create the milestone and capture the returned id:

   ```bash
   backlog milestone add "<title>" --description "<goal and boundaries>"
   ```

## Design The Task Graph

Translate every implementation, test, documentation, migration, compatibility, and rollout commitment in the plan into one or more tasks. Apply these rules:

- Make each task a focused, reviewable delivery unit that one agent can complete without the original conversation.
- Include the outcome, necessary context, explicit boundaries, testable acceptance criteria, references, documentation, and likely modified files when the plan or repository provides them.
- Prefer separate milestone tasks over an umbrella coordination task. Use parent/subtask structure only when the plan genuinely describes one inseparable subsystem hierarchy.
- Split work by independently deliverable ownership. Keep tasks in the same dependency wave on disjoint files or clearly non-conflicting surfaces when possible.
- Add a shared foundation task only when downstream tasks truly require its contract or output.
- Add dependencies only for real producer-consumer, schema, interface, migration, or rollout prerequisites. Do not serialize tasks merely because the plan lists them in order.
- Do not use ordinals as a substitute for dependencies.
- Leave implementation tasks unassigned and in the repository's default todo state unless the approved plan says otherwise.
- Do not create placeholder, coordination-only, review-only, or speculative follow-up tasks.

Create independent tasks first, then dependent tasks in topological order so referenced task ids already exist:

```bash
backlog task create "<title>" \
  --description "<self-contained outcome and context>" \
  --milestone <milestone id> \
  --ac "<verifiable outcome>" \
  --modified-file "<project-relative path>" \
  --plain

backlog task create "<dependent title>" \
  --description "<self-contained outcome and context>" \
  --milestone <milestone id> \
  --depends-on <prerequisite task ids> \
  --ac "<verifiable outcome>" \
  --plain
```

Use single-quoted shell arguments whenever task text contains literal backticks.

## Inspect Dependency Waves

Read every created task and compute the initial execution waves:

```bash
backlog task list --milestone <milestone id> --plain
backlog task view <task id> --plain
backlog sequence list --plain --milestone <milestone id>
```

Confirm that every plan commitment maps to a task, dependency chains contain no cycles, and the earliest sequence contains all work that can safely start immediately.

## Run The Independent Review

Spawn exactly one read-only subagent. Give it the approved plan, repository instructions, planning worktree path, milestone id, full plain-text task views, and sequence output. Do not give it conclusions or proposed fixes.

Use this review contract:

```text
Review this Backlog milestone and task graph against the approved plan.

This is a read-only review. Do not create, edit, delete, assign, or commit anything. You may run read-only Backlog and Git commands in <planning worktree>.

Report only concrete findings in these categories:
1. Plan commitments missing from the tasks.
2. Tasks that are not self-contained or are too broad/narrow for one agent.
3. Missing, unnecessary, or cyclic dependencies.
4. Tasks serialized unnecessarily that can run in parallel.
5. Same-wave tasks likely to conflict on files or interfaces.
6. Missing acceptance criteria, test, documentation, migration, compatibility, or rollout coverage required by the plan.

For every finding, name the affected task ids and the exact task or dependency change you recommend. If there are no findings, say so explicitly.
```

Evaluate each finding against the approved plan and repository evidence. Do not accept suggestions that expand scope. If a finding exposes genuine product ambiguity, stop and ask the user before changing the task graph.

Apply valid changes through the CLI only. Read `backlog task edit --help` before the first edit, search before adding any missing task, and use `--depends-on` to replace a task's dependency set when needed. Then rerun all task views and:

```bash
backlog sequence list --plain --milestone <milestone id>
```

Do not proceed until coverage is complete, dependencies are acyclic, and all safe parallelism is exposed.

## Commit And Land On Main

1. Inspect the planning worktree and identify only milestone and task files created or changed by this workflow:

   ```bash
   git status --short
   git diff --name-only
   ```

2. Stage those files explicitly. Never use `git add .`, broad directory staging, or include implementation files.
3. Honor the repository's commit convention. If none exists, use:

   ```text
   chore(backlog): plan <milestone id> <milestone title>
   ```

4. Commit once and confirm the worktree has no uncommitted planning changes.
5. In the clean checkout for `main`, fast-forward the planning branch:

   ```bash
   git checkout main
   git merge --ff-only planning/<slug>
   ```

6. If the fast-forward fails or `main` changed unexpectedly, stop and report the divergence. Never force, reset, rebase, or push.
7. After a successful landing, remove the planning worktree and delete its branch.

## Final Handoff

Report:

- Milestone id and title.
- Created task ids and titles.
- Final dependency waves and which tasks can start in parallel.
- Reviewer findings and the changes applied from them.
- Commit hash and confirmation that it is on local `main`.
- Worktree and branch cleanup status.
- Confirmation that only tracker files were committed and nothing was pushed.
- Any unresolved ambiguity or intentionally excluded scope.

Never claim the plan was implemented. This skill plans and records the work only.
