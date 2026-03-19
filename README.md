# Progress Notifier

`progress-notifier` is an OpenClaw plugin for tracking long-running work with task-based progress updates.

It supports:

- task progress records with stable `taskId`
- parent/child task trees
- automatic parent aggregation for `percent`, `status`, `stage`, and `label`
- weighted child progress with optional `weight`
- progress history, replay, and metrics
- scheduled heartbeat and summary updates
- Feishu pinned cards with automatic refresh
- prompt-context injection for active tasks

## How It Works

The plugin is designed around task updates rather than one-off status messages.

You create a task with `progress_update`, then keep updating the same `taskId` as work advances.
If you use parent and child tasks, the parent task can automatically derive:

- `percent` from child progress
- `status` from child states
- `stage` from the earliest unfinished child stage
- `label` from an aggregated summary

If child tasks have different importance, add `weight` to each child task and the parent will use a weighted average instead of equal weighting.

## Installation

This repository is a local OpenClaw plugin directory. The plugin manifest is:

- [openclaw.plugin.json](./openclaw.plugin.json)

Enable it in your OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "progress-notifier": {
        "enabled": true
      }
    }
  }
}
```

If your OpenClaw setup requires an explicit local path, use the repository path:

```json
{
  "plugins": {
    "entries": {
      "progress-notifier": {
        "enabled": true,
        "path": "C:\\path\\to\\openclaw-progress-notifier",
        "config": {
          "injectPromptContext": true,
          "persistenceMode": "file",
          "persistenceDir": ".progress-store"
        }
      }
    }
  }
}
```

After enabling it, restart OpenClaw and confirm tools such as `progress_update`, `progress_get`, and `progress_tree` are available.

## Configuration

The plugin config schema is defined in [openclaw.plugin.json](./openclaw.plugin.json).

Common options:

| Config | Type | Default | Description |
|---|---|---:|---|
| `ttlMs` | `number` | `600000` | Task expiration time in milliseconds |
| `injectPromptContext` | `boolean` | `true` | Inject active progress context into prompts |
| `promptContextLimit` | `number` | `2` | Maximum active tasks injected into prompts |
| `defaultStages` | `string[]` | `["start","research","draft","revise","done"]` | Stage pipeline used for stage-based percent inference |
| `persistenceMode` | `"memory" \| "file"` | `"memory"` | Storage backend |
| `persistenceDir` | `string` | `".progress-store"` | File persistence directory |
| `enableScheduledUpdates` | `boolean` | `false` | Enable periodic updates |
| `defaultUpdateIntervalMs` | `number` | `60000` | Default schedule interval |
| `pushScheduledMessages` | `boolean` | `true` | Send scheduled update messages to the conversation |
| `feishuAppId` | `string` | none | Feishu app id for card push |
| `feishuAppSecret` | `string` | none | Feishu app secret for card push |

## Recommended Workflow

The most useful setup is:

1. Create one parent task for the overall job.
2. Create child tasks for meaningful work units.
3. Update child tasks as they progress.
4. Let the parent task aggregate automatically.

### Parent Task

```json
{
  "taskId": "paper-1",
  "label": "Paper workflow",
  "stage": "start",
  "status": "running"
}
```

### Child Tasks

```json
{
  "taskId": "paper-1.search",
  "parentTaskId": "paper-1",
  "label": "Search sources",
  "stage": "research",
  "status": "running"
}
```

```json
{
  "taskId": "paper-1.outline",
  "parentTaskId": "paper-1",
  "label": "Draft outline",
  "stage": "draft",
  "status": "running"
}
```

As child tasks change, the parent can automatically become something like:

```text
[research] 1/2 child tasks complete, 1 running
[======>---] 67%
```

## Weighted Progress

If child tasks are not equally important, use `weight`.

Example:

```json
{
  "taskId": "paper-1.search",
  "parentTaskId": "paper-1",
  "label": "Search sources",
  "weight": 1,
  "stage": "done",
  "status": "done"
}
```

```json
{
  "taskId": "paper-1.write",
  "parentTaskId": "paper-1",
  "label": "Write main draft",
  "weight": 3,
  "stage": "research",
  "status": "running"
}
```

Now the parent percent is based on weighted average, not equal average. The parent label can show weighted context:

```text
[research] 50% complete (weighted), 1/2 child tasks complete, 1 running
[====>-----] 50%
```

## Core Tools

### Task Management

| Tool | Purpose |
|---|---|
| `progress_update` | Create or update a task |
| `progress_get` | Get a task by `taskId` |
| `progress_list` | List tasks in the current conversation |
| `progress_clear` | Remove one task or all tasks |

### Analysis

| Tool | Purpose |
|---|---|
| `progress_summary` | Summarize task progress |
| `progress_replay` | Replay the full event history |
| `progress_metrics` | Show duration, retries, blocks, and metrics |
| `progress_children` | List direct children of a task |
| `progress_tree` | Render the task tree |

### Admin

| Tool | Purpose |
|---|---|
| `progress_conversations` | List persisted conversation ids |
| `progress_health` | Show plugin health and config |
| `progress_cleanup` | Remove expired or empty task records |

### Scheduled Updates

| Tool | Purpose |
|---|---|
| `progress_schedule` | Start scheduled updates for a task |
| `progress_unschedule` | Stop scheduled updates |

Scheduled modes:

- `heartbeat`: keep a task visibly active
- `summary`: send periodic recap-style updates

### Feishu Cards

| Tool | Purpose |
|---|---|
| `progress_pin_card` | Create or bind a pinned Feishu card |
| `progress_refresh_card` | Refresh an existing pinned card |
| `progress_unpin_card` | Remove a pinned card binding |
| `progress_card_status` | Show card binding state |

When a pinned task is updated, the plugin refreshes the Feishu card automatically. If a child task changes a derived parent value, the parent card can be refreshed too.

## Output Modes

Query-style tools support these output modes:

- `text`
- `compact`
- `json`

## Development

Install dependencies:

```bash
npm install
```

Type-check:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

## Repository Layout

```text
src/
  analytics/
  feishu/
  hooks/
  persistence/
  render/
  scheduler/
  state/
  tree/
  index.ts
  ProgressManager.ts
  types.ts
  utils.ts

test/
  *.test.ts
```

## Notes

- Task data is scoped by conversation id.
- Parent aggregation is automatic, but only after child task events exist.
- If you do not provide `percent`, the plugin can infer it from `stage`.
- If you do not provide either `percent` or `stage`, leaf tasks can still advance via history-based fallback.

## License

MIT
