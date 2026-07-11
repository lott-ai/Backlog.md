---
name: backlog-task-orchestrator
description: Orchestrate Backlog.md milestone execution with parallel subagents. Use when the user asks to run, execute, complete, coordinate, or be the task orchestrator for a Backlog milestone; when they mention `backlog sequence list`, dependency waves, spawning subagents for unblocked tasks, marking tasks in progress/done, auditing after each sequence, creating follow-up milestone tasks, creating a milestone worktree, landing each task as a commit, and landing completed work on main without pushing.
---

# Backlog Task Orchestrator

## Overview

Run a Backlog.md milestone as a dependency-wave orchestrator. Create a dedicated git worktree for the milestone, use Backlog as the source of truth, spawn independent task workers when possible, land each completed task as a commit in the worktree, audit each completed wave, create follow-up tasks for discovered gaps, continue until the milestone is complete, then land the worktree commits on `main`. Never push.

## Inputs

- Milestone id or title from the user prompt, for example `m-4` or `"Multi-provider receptionist voice pipelines"`.
- A repository that uses the `backlog` CLI and stores task state through Backlog.md.

If no milestone is provided, ask for exactly that and stop.

## Ground Rules

- Run `backlog instructions overview` before any other Backlog action in the repo.
- Use the Backlog CLI only. Never edit Backlog task, draft, document, decision, or milestone markdown files directly.
- Use `backlog <command> --help` before unfamiliar Backlog commands.
- Honor repository instructions and dirty-worktree safety rules. Do not revert unrelated changes.
- Do all milestone implementation work in the milestone worktree. Do not commit task work in the primary checkout.
- Land each completed task as its own commit in the worktree.
- Never `git push`. Never push tags, branches, or remotes. Keep all git operations local.
- If subagent tooling is unavailable, report that true parallel orchestration is unavailable and ask whether to continue serially.

## Resolve The Milestone

1. Run:

   ```bash
   backlog milestone list --show-completed --plain
   ```

2. Resolve the prompt input to one concrete milestone id.
   - If the input is already a milestone id such as `m-4`, use it.
   - If it is a title or partial title, choose the single matching id.
   - If multiple milestones plausibly match, ask for clarification before changing tasks.

## Create The Milestone Worktree

After resolving the milestone id, create a dedicated worktree and branch before any task work.

1. From the primary repo checkout, ensure `main` is the intended base (or the repo's default integration branch if it is not named `main`).
2. Create the worktree and branch:

   ```bash
   git worktree add -b milestone/<milestone id> ../.worktrees/<repo-name>/milestone/<milestone id> main
   ```

   - Reuse an existing matching worktree/branch if one already exists for this milestone.
   - If the path is taken by an unrelated worktree, stop and ask before choosing another path.
3. Run all subsequent implementation, commits, audits, and verification from that worktree path.
4. Keep Backlog CLI usage available from the worktree; task state remains the shared Backlog source of truth.

## Main Loop

Repeat until every task assigned to the milestone is `Done` and the final audit finds no milestone-scoped follow-up work.

1. Read execution guidance:

   ```bash
   backlog instructions task-execution
   ```

2. Compute current dependency waves:

   ```bash
   backlog sequence list --plain --milestone <milestone id>
   ```

3. For the next sequence, identify every task in that sequence that is not already `Done`.
4. For each ready task:
   - Read it with `backlog task view <task id> --plain`.
   - Mark it in progress before assigning it:

     ```bash
     backlog task edit <task id> --status "In Progress" --plain
     ```

   - Spawn one subagent for each ready task when subagent tooling is available.
   - Give each subagent only its task id, milestone id, worktree path, task details, repository instructions, allowed file ownership, and required verification expectations.

Use this subagent assignment contract:

```text
You own <task id> for milestone <milestone id>.

Work only in the milestone worktree at <worktree path>.
Read `backlog instructions overview`, `backlog instructions task-execution`, and `backlog task view <task id> --plain`.
Work only on the assigned task and its explicitly owned files.
Use the Backlog CLI, not direct markdown edits.
Run focused verification for the task.
When complete, create exactly one local commit for this task's work in the worktree.
Do not push. Do not commit unrelated dirty files. Do not work outside the worktree.
Report commit hash, changed files, verification commands/results, blockers, and follow-up issues.
```

5. Track active workers. When spawning agents or when the user asks for status, report a compact table with task id, agent/thread name if known, assignment, status, elapsed time, and latest evidence.
6. When a subagent reports completion:
   - Confirm the task landed as a commit in the milestone worktree.
   - Inspect the commit and diff it produced.
   - Confirm acceptance criteria and Definition of Done.
   - Read finalization guidance:

     ```bash
     backlog instructions task-finalization
     ```

   - Mark completed AC and DoD items through the CLI with `--check-ac <index>` and `--check-dod <index>` as appropriate.
   - Mark the task done only after verification:

     ```bash
     backlog task edit <task id> --status "Done" --plain
     ```

## Sequence Audit

After every sequence completes, audit before starting the next sequence. Run audits in the milestone worktree.

1. Inspect current state:

   ```bash
   git status --short
   git log --oneline -n 12
   backlog task list --milestone <milestone id> --plain
   backlog sequence list --plain --milestone <milestone id>
   ```

2. Run focused checks required by completed tasks.
3. Run broader checks when shared code, contracts, build configuration, user-facing behavior, or cross-module behavior changed.
4. Review for incomplete work, bugs, missing pieces, duplicate work, sequencing mistakes, optimization opportunities, missing docs, and missing tests.

## Follow-Up Tasks

For every real issue found during a sequence audit:

1. Search existing tasks first:

   ```bash
   backlog task list --milestone <milestone id> --search "<issue summary>" --plain
   ```

2. Read task creation guidance:

   ```bash
   backlog instructions task-creation
   ```

3. Create a new task in the same milestone with clear acceptance criteria and dependencies that place it in the correct later wave:

   ```bash
   backlog task create "<title>" --description "<why>" --ac "<verifiable outcome>" --milestone <milestone id> --depends-on <task ids> --plain
   ```

4. Re-run:

   ```bash
   backlog sequence list --plain --milestone <milestone id>
   ```

Use the updated dependency waves for subsequent work.

## Land On Main

When every milestone task is `Done` and the final audit finds no milestone-scoped follow-up work:

1. In the milestone worktree, confirm a clean status and collect the commit range to land:

   ```bash
   git status --short
   git log --oneline main..HEAD
   ```

2. In the primary checkout on `main`, land the worktree branch locally:

   ```bash
   git checkout main
   git merge --ff-only milestone/<milestone id>
   ```

   - Prefer a fast-forward land so each task commit remains intact on `main`.
   - If fast-forward is not possible, stop and report the divergence; do not force, reset, or push.

3. Never `git push` after landing.

4. Optionally remove the worktree after a successful local land:

   ```bash
   git worktree remove ../.worktrees/<repo-name>/milestone/<milestone id>
   ```

## Final Handoff

When the milestone is complete and landed on `main`:

1. Run:

   ```bash
   backlog task list --milestone <milestone id> --plain
   backlog sequence list --plain --milestone <milestone id>
   git status --short
   git log --oneline -n 20
   ```

2. Summarize:
   - Worktree path and branch used.
   - Completed task ids.
   - Per-task commit hashes.
   - That commits were landed on `main` locally.
   - That nothing was pushed.
   - Verification commands and results.
   - Follow-up tasks created and completed.
   - Remaining work intentionally outside milestone scope.
   - Checks that could not run and why.

Never silently skip a task, never mark a task done before verification, never commit unrelated dirty files, and never push.
