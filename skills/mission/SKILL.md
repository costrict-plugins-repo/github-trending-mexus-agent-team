---
name: mission
description: Use when starting a new Markdown-only Agent Team Mission with Claude Code or Codex background Agents and no Mexus server.
argument-hint: "\"<request>\" [--name <mission-name>]"
---

# `/mexus-team:mission`

Use this skill when the user invokes `/mexus-team:mission "<request>"`.

This skill **only creates a new Mission**. To continue an already-active Mission, use `/mexus-team:continue` instead. A `<request>` argument is required.

This is a standalone Agent Team workflow. It must not call `mexus`, create panes, use Mission Inbox, or rely on external A2A messaging. Communication happens through `agent-team/` Markdown files, especially `kanban.md`.

Starting a Mission makes it the only active Mission in the workspace. Any previous active Mission is archived by changing its `mission.md` lifecycle to `Lifecycle: archived`.

## Create The Mission

1. Preserve the user's request.
2. Choose a Mission name from `--name` or derive a short slug.
3. Run the standalone script from this plugin:

   ```bash
   node <plugin-root>/scripts/start-mission.mjs --root "$PWD" --name <mission-name> --request "<request>"
   ```

4. Read:
   - `agent-team/mission-workflow.md`
   - `agent-team/missions/<mission-name>/mission.md`
   - `agent-team/missions/<mission-name>/agents.md`
   - `agent-team/missions/<mission-name>/kanban.md`
   - `agent-team/missions/<mission-name>/roundtable.md`
5. Act as Squad Lead.
6. Refine the generated `agents.md` and `kanban.md` so the Mission has the right execution Agents and actionable worker tasks.

## Then Start The Board

7. After the roster and kanban are planned, start (or reuse) the read-only board so the user can watch execution:

   ```bash
   node <plugin-root>/scripts/start-board.mjs --root "$PWD" --host 0.0.0.0
   ```

   The script reuses a board that is already running for this project and only prints its URL; it starts a fresh board only when none is alive. It probes the board and API ports for up to 5 seconds before declaring success.

   **Verify the board actually started before continuing.** Check the command's exit status and look for `Agent Team board: <URL>` in the output. If the exit code is non-zero, or the success line is missing, tell the user the board did not start and surface the script's diagnostic output verbatim. Common causes:

   - `agent-team/` is missing in the current project (start the Mission first).
   - `pnpm` is not on `PATH`. Install pnpm (https://pnpm.io/installation) and retry.
   - Ports `4179` or `5179` (or whichever the script picked) are already in use.
   - The board-app dependencies have not been installed yet; the first run downloads them and may exceed the 5-second window. Re-run `/mexus-team:board` once pnpm finishes.

   Do not pretend the board is up if the script reported failure. Either wait for it to recover and re-run, or proceed without a board and note that to the user. Print the board URL only when the script confirmed the board is reachable.

## Then Execute

8. Use the Agent tool to start Claude Code or Codex background Agents in parallel for the independent kanban tasks planned in step 6.
9. Within this same session, Squad Lead keeps coordinating: when an Agent finishes, reports a blocker, or a new actionable task appears in `kanban.md`, Squad Lead dispatches the next background Agents itself. The user does not run a command for in-session follow-up; `/mexus-team:continue` is only for resuming a Mission in a later session.

## Execution Rules

- `Squad Lead` is a fixed coordination role name. Do not rename it, and do not consume one of the execution Agent names for Squad Lead.
- Squad Lead decomposition work is not a kanban task. `/mexus-team:mission` must finish with a planned roster, planned kanban tasks, a running board, and the first background Agents dispatched.
- Treat `agent-team/agents.md` as the long-term repository roster. Reuse existing Agents when their module history fits, and add new Agents only when no close owner exists.
- Use Claude Code or Codex background Agents for worker execution.
- Every execution Agent must be named according to `agent-team-mission-workflow`: short stable names drawn at random from the Ars Goetia / Lesser Key of Solomon name set, never sequential placeholders. A name must not repeat another Agent in this Mission or in `agent-team/agents.md`.
- Do not use external A2A, inbox, pane dispatch, or Mexus runtime features.
- Kanban is the communication protocol.
- Kanban task `From` must be Squad Lead or an executing Agent, never `User`.
- Dispatch one scoped task per background Agent.
- The executing background Agent, not the Squad Lead, must move and update its own kanban task block.
- Every background Agent must update `kanban.md` with status, Result, Files, Verification, and Updated before reporting back.
- Every task is accepted by its publisher: the Agent named in `From` reviews the completed task and fills `Review`.
- Squad Lead owns mission-level acceptance. If the overall result is below expectation, publish new focused tasks to the responsible Agents instead of editing another Agent's completed result.
- If a task is outside an Agent's scope and the correct owner is clear, reassign it in `kanban.md` with the reason in `Updated`.
- If task ownership is unclear, publish a clarification task to the Squad Lead.
- Use `roundtable.md` for decisions that affect multiple Agents, shared interfaces, mission scope, product direction, sequencing, acceptance criteria, or major risk trade-offs.
- Review Done tasks before declaring the Mission complete.

## Prompt Requirements For Background Agents

Every background Agent prompt must include:

- Mission name.
- Agent name and responsibility.
- The exact current task block.
- Scope boundary.
- Requirement to read Mission files.
- Requirement to claim, update, and complete its own task block in `kanban.md`.
- Requirement to self-test before moving the task to `Done`.
- Requirement to leave `Review` for the task publisher.
- Reassignment and Squad Lead clarification rules for responsibility mismatch.
- Statement that this is the first/current task, not all future work.
- When the task's `Acceptance` names an artifact path, the Agent must write that file under `agent-team/missions/<mission-name>/artifacts/` with the frontmatter described in `agent-team/mission-workflow.md` (`## Artifacts`), include the required sections, and list the artifact path in its own task's `Files:` field.
- The current value of `Output language:` from `mission.md` (default `en`), with the instruction to write all user-visible content in that language and keep structural words in English per `agent-team/mission-workflow.md` (`## Output Language`).
- No external A2A or Mexus dependency.

## Output Language

`start-mission.mjs` writes an `Output language:` field into `mission.md` based on the original request (CJK characters → `zh`, otherwise `en`). Read that field before refining the Mission, and apply the rule from `agent-team/mission-workflow.md` under `## Output Language`:

- User-visible content (Mission Intent, kanban `Request`/`Reason`/`Acceptance`/`Result`/`Verification`/`Review` values, RoundTable field values, Squad Lead log, artifact body and artifact `title`) is written in that language.
- Structural words (status names, field names, `Lifecycle` values, RoundTable section headings, artifact frontmatter keys) stay in English.

When dispatching background Agents, include this rule in their prompt so the kanban they write back stays consistent.

## Artifacts In This Mission

Squad Lead is responsible for routing long-form output to artifacts rather than letting it pile up inside kanban task blocks. Apply the rules in `agent-team/mission-workflow.md` under `## Artifacts`:

- When publishing a research, document, or decision-record task, write the `Acceptance` field so it names the exact artifact path (`artifacts/<YYYY-MM-DD>-<slug>.md`), lists minimum sections or questions the artifact must answer, and requires the executor's `Files:` field to list that path.
- When a RoundTable proposal moves into `## Approved` in `roundtable.md`, publish a follow-up kanban task that produces `artifacts/<YYYY-MM-DD>-rt-<topic-slug>.md`. This is not optional.
- Before declaring the Mission complete, verify: every approved RoundTable item has a matching `rt-*` artifact; every research / document task lists an artifact path in its `Files:` field and that file exists. Any gap is closed by publishing a new focused task, not by writing the artifact yourself on another Agent's behalf.

## Output

After creating the Mission, tell the user:

- Mission name.
- Files created or reused.
- Previous Missions archived, if any.
- Execution Agents planned and the kanban tasks published for them.
- The board URL (reused or newly started).
- Background Agents dispatched for the first task batch.
