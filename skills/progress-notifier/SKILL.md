# Feishu Progress Workflow

Use this skill when a Feishu-facing task is large enough that the user may wonder whether the agent is still working, waiting on an external API, or stuck.

The goal is not just to show progress. The goal is to make long-running work observable.

## Use This Skill When

Use the progress tools when the task has one or more of these properties:

- the work has multiple meaningful stages
- the work may take more than 1-2 minutes
- the user asked for Feishu updates or a pinned card
- the workflow includes reading, summarizing, rewriting, or writing back a Feishu document
- the workflow includes external waits such as model calls, search APIs, or document APIs

Do not use progress tools for:

- tiny one-shot questions
- very small edits
- tasks that can be completed in a single reply without noticeable wait time

## Core Principles

- Keep one stable `taskId` for the full lifecycle of a task.
- Prefer one parent task for the overall workflow and child tasks for meaningful sub-work.
- Update child tasks for real work. Let the parent aggregate automatically.
- If a task is pinned to Feishu and the tool returns no normal text, do not add extra filler messages.
- Do not fake progress just to look busy.
- Use waiting states when the agent is blocked on an external dependency.

## Recommended Workflow

For a long Feishu workflow:

1. Create a parent task with `progress_update`.
2. Create child tasks only when the workflow has real sub-steps.
3. If the user wants Feishu visibility, call `progress_pin_card` on the parent task.
4. Update child tasks as real work progresses.
5. When waiting on an external call, mark the task as `waiting_external`.
6. When the external call returns, send a normal `progress_update` and the waiting state clears automatically.
7. Finish with `stage="done"`, `status="done"`, and `percent=100` on the relevant final task.

## Recommended Stages

Use these stages unless the task needs a better domain-specific breakdown:

- `start`
- `research`
- `draft`
- `revise`
- `done`

## Status Values

- `queued`
- `running`
- `blocked`
- `retrying`
- `done`
- `failed`
- `canceled`

Use `running` by default.

## Parent And Child Tasks

Preferred pattern:

- parent task for the overall workflow
- child tasks for meaningful work units
- child tasks carry most updates
- parent task is what you pin to Feishu

Important:

- do not manually maintain parent `percent` if child tasks exist
- do not manually maintain parent `status` if child tasks exist
- do not manually maintain parent `stage` if child tasks exist
- use child `weight` when some subtasks matter more than others

Example parent:

```json
{
  "taskId": "feishu-report-1",
  "label": "Preparing report",
  "stage": "start",
  "status": "running"
}
```

Example child:

```json
{
  "taskId": "feishu-report-1.read-doc",
  "parentTaskId": "feishu-report-1",
  "label": "Reading source document",
  "stage": "research",
  "status": "running"
}
```

## External Wait States

When the agent is waiting on an external dependency, do not pretend the task is actively progressing.

Use:

- `activityState: "waiting_external"`
- `waitingOn: "<provider-or-tool>"`

Example:

```json
{
  "taskId": "feishu-report-1.read-doc",
  "label": "Waiting for OpenAI response",
  "status": "running",
  "activityState": "waiting_external",
  "waitingOn": "openai"
}
```

Good `waitingOn` values:

- `openai`
- `search-api`
- `feishu`
- `database`
- `web-fetch`

When work resumes, send a normal update without `activityState` and without `waitingOn`.

Example:

```json
{
  "taskId": "feishu-report-1.read-doc",
  "label": "Analyzing returned content",
  "status": "running",
  "stage": "research"
}
```

## Heartbeat And Stale Detection

The plugin already supports automatic heartbeat and stale detection.

Implications for the agent:

- do not create fake "still working" updates every few seconds
- do not use heartbeat to advance percent
- use real updates for real progress
- use `waiting_external` when the agent is blocked on an external call

The watchdog will then distinguish:

- active work
- waiting on external dependency
- external call slow
- possibly stalled

## Feishu Card Workflow

If the user wants progress visible in Feishu:

1. create the parent task
2. pin the parent task with `progress_pin_card`
3. continue updating child tasks
4. let the parent card auto-refresh

Example:

```json
{
  "taskId": "feishu-report-1",
  "receiveId": "chat_id_here",
  "receiveIdType": "chat_id",
  "showSummary": true
}
```

Use the parent task for pinned cards unless there is a clear reason to pin a specific child task.

## Tool Guidance

### `progress_update`

Use for:

- creating a task
- updating stage, label, status, or percent
- updating child tasks
- entering `waiting_external`
- resuming from `waiting_external`

Key parameters:

- `taskId`
- `label`
- `stage`
- `status`
- `parentTaskId`
- `weight`
- `activityState`
- `waitingOn`

### `progress_pin_card`

Use when:

- the user explicitly asks for a Feishu progress card
- the task is long enough that external visibility is useful

### `progress_refresh_card`

Use when:

- the user explicitly asks to refresh the card
- you need a manual sync after unusual state changes

### `progress_schedule`

Use sparingly.

In many cases, automatic heartbeat is already enough. Prefer `progress_schedule` only when:

- the task is very long-running
- periodic summaries are genuinely useful
- the user explicitly asks for recurring recap-style updates

Prefer:

- `heartbeat` when the user only needs reassurance that work is still alive
- `summary` when periodic recap is more useful than keep-alive noise

### `progress_summary`

Use when:

- the user asks for current progress
- the workflow needs a recovery summary after interruption

### `progress_tree`

Use when:

- the workflow is hierarchical
- the user needs to understand parent/child structure

## Suggested Task ID Patterns

- `feishu-doc-summary-1`
- `feishu-doc-rewrite-1`
- `feishu-meeting-note-1`
- `feishu-report-1`
- `feishu-report-1.read-doc`
- `feishu-report-1.write-summary`

## Suggested Labels

Keep labels short and user-facing. Examples:

- `Starting document review`
- `Reading source document`
- `Extracting key decisions`
- `Drafting summary`
- `Refining output`
- `Waiting for OpenAI response`
- `Writing back to Feishu`
- `Completed`

## Best Practices

- Prefer parent task + child tasks over one giant flat task.
- Pin the parent task, not every child task.
- Use `weight` only when unequal importance is real and obvious.
- Use `waiting_external` only for genuine external waits.
- Clear waiting state as soon as real work resumes.
- Keep labels understandable to the end user, not just the implementer.
- Use `progress_summary` for recap, not a burst of tiny progress updates.

## Anti-Patterns

Avoid these:

- creating a new `taskId` for every tiny step
- manually updating the parent when children already exist
- using heartbeat as fake progress
- setting `waiting_external` when the agent is actually computing locally
- over-updating the user with noisy progress messages for tiny intermediate actions
