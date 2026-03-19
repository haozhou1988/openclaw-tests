# Progress Notifier Plugin

A lightweight OpenClaw plugin for task-based progress tracking and workflow management in long-running agent conversations.

## What's New in v0.4.0

- **Scheduled Updates**: `progress_schedule` / `progress_unschedule` for long-running tasks
- **Feishu Cards**: Pinned progress cards that auto-refresh on updates
- **Better Renderer**: Status-colored headers, progress bars, metrics overview

See [CHANGELOG.md](./CHANGELOG.md) for full history.

## Features

- **Task-based Progress**: Track multiple tasks with stable `taskId` per conversation
- **Stage & Percent**: Auto-infer percent from stage, or set manually
- **Weighted Progress**: Use child-task `weight` values for more realistic parent progress
- **History & Replay**: Full event timeline for each task
- **Metrics**: Duration, retries, blocks, stage timing
- **Tree View**: Parent-child task hierarchy visualization
- **Persistence**: In-memory (default) or file-based with atomic writes
- **Prompt Injection**: Auto-inject active task context into LLM prompts

## Architecture

```
src/
├── types.ts           # Shared TypeScript interfaces
├── utils.ts           # Helpers: percent, progress bar, context pickers
├── ProgressManager.ts # Core orchestrator
├── analytics/         # WorkflowAnalytics: replay, metrics, summary
├── hooks/            # injectPromptContext: prompt injection logic
├── persistence/      # PersistenceAdapter, MemoryAdapter, FileAdapter
├── render/           # ProgressRenderer: text/compact/json output
├── state/            # TaskStateMachine: status transitions
└── tree/             # TaskTreeManager: parent-child hierarchy
```

## Installation

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

## Configuration

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `ttlMs` | number | 600000 | Task expiration time (ms) |
| `injectPromptContext` | boolean | true | Auto-inject progress into prompts |
| `promptContextLimit` | number | 2 | Max active tasks in prompt |
| `defaultStages` | string[] | ["start","research","draft","done"] | Stage pipeline |
| `persistenceMode` | "memory" \| "file" | "memory" | Storage backend |
| `persistenceDir` | string | ".progress-store" | File adapter directory |
| `enableScheduledUpdates` | boolean | false | Enable scheduled progress updates |
| `defaultUpdateIntervalMs` | number | 60000 | Default interval for scheduled updates (ms) |
| `pushScheduledMessages` | boolean | true | Push scheduled updates to conversation |

## Tools

### Task Management

| Tool | Description |
|------|-------------|
| `progress_update` | Create/update a task |
| `progress_get` | Get single task by ID |
| `progress_list` | List tasks (filter by status) |
| `progress_clear` | Clear one or all tasks |

### Analysis

| Tool | Description |
|------|-------------|
| `progress_summary` | Human-readable task summary |
| `progress_replay` | Full event timeline |
| `progress_metrics` | Duration, retries, blocks, stage timing |
| `progress_children` | Direct child tasks |
| `progress_tree` | Task hierarchy tree |

### Admin

| Tool | Description |
|------|-------------|
| `progress_conversations` | List persisted conversation IDs |
| `progress_health` | Plugin & adapter health check |
| `progress_cleanup` | Remove expired/empty tasks, rebuild index |

### Scheduled Updates

The plugin can enable scheduled progress updates for long-running tasks.

**Use cases:**
- Task may run for a noticeable amount of time
- User would benefit from periodic progress visibility
- Workflow may otherwise appear stalled

#### Modes

**`heartbeat`**: Lightweight periodic update that keeps task alive
- Updates internal task history
- Refreshes current task status
- Can optionally push progress message to conversation

**`summary`**: Recap-oriented periodic update
- Updates internal task history
- Generates compact progress recap
- Suitable for document-heavy workflows

#### Configuration

```json
{
  "enableScheduledUpdates": true,
  "defaultUpdateIntervalMs": 60000,
  "pushScheduledMessages": true
}
```

#### Tools

| Tool | Description |
|------|-------------|
| `progress_schedule` | Enable scheduled progress updates |
| `progress_unschedule` | Stop scheduled progress updates |

#### Example

```json
{
  "taskId": "paper-1",
  "intervalMs": 60000,
  "mode": "heartbeat"
}
```

**Note:** Scheduled updates stop automatically when task reaches `done`, `failed`, or `canceled`.

## Usage Examples

### Recommended: Parent + Child Tasks

The recommended workflow is to create one parent task for the overall job, then update child tasks as work progresses.

You only need to update child tasks in most cases. The parent task will automatically derive:

- `percent` from child progress
- `percent` can use weighted averages when child tasks provide `weight`
- `status` from child states
- `stage` from the earliest unfinished child stage
- `label` from a short Chinese summary such as `1/2 子任务已完成，1 个运行中`
- `label` can show weighted completion text such as `已完成 50%（按权重）`

Example:

Create the parent task:

```json
{
  "taskId": "paper-1",
  "label": "论文整理",
  "stage": "start",
  "status": "running"
}
```

Create and update child tasks:

```json
{
  "taskId": "paper-1.search",
  "parentTaskId": "paper-1",
  "label": "检索资料",
  "stage": "research",
  "status": "running"
}
```

```json
{
  "taskId": "paper-1.outline",
  "parentTaskId": "paper-1",
  "label": "整理提纲",
  "stage": "draft",
  "status": "running"
}
```

Once child tasks advance, the parent task can automatically become something like:

```text
[research] 1/2 子任务已完成，1 个运行中
[======>---] 67%
```

### Weighted Child Progress

If child tasks do not contribute equally, add `weight` to each child task.

Example:

```json
{
  "taskId": "paper-1.search",
  "parentTaskId": "paper-1",
  "label": "检索资料",
  "weight": 1,
  "stage": "done",
  "status": "done"
}
```

```json
{
  "taskId": "paper-1.write",
  "parentTaskId": "paper-1",
  "label": "写正文",
  "weight": 3,
  "stage": "research",
  "status": "running"
}
```

In this case, the parent task uses a weighted average instead of treating both child tasks equally:

```text
[research] 已完成 50%（按权重），1/2 子任务已完成，1 个运行中
[====>-----] 50%
```

### Basic Progress Update

```json
{
  "taskId": "paper-1",
  "label": "正在检索资料",
  "stage": "research",
  "status": "running"
}
```

Output:
```
[research] 正在检索资料
████░░░░░░ 40%
```

### Query Task Tree

```json
{ "taskId": "paper-1" }
```

Output:
```
- paper-1 [draft] [running] 75% 正在整理答案
  - paper-1.search [done] 100% 检索完成
  - paper-1.outline [running] 60% 正在整理提纲
```

### Health Check

```json
{}
```

Output:
```
状态：healthy。conversation 数量：3。配置：ttlMs=600000, promptContextLimit=2。
```

## Output Modes

All query tools support `outputMode` parameter:

- `text` (default): Human-readable
- `compact`: Pipe-separated, e.g. `Task=paper-1 | Status=running`
- `json`: Structured JSON

## Development

```bash
# Type check
npm run typecheck

# Run tests
npm test

# Watch mode
npm run test:watch
```

## Test Coverage

- `store.test.ts`: Core CRUD, TTL, active filtering
- `analytics.test.ts`: Replay, metrics, summary
- `tree.test.ts`: Hierarchy build, render
- `file-adapter.test.ts`: Atomic writes, index, corruption handling
- `conversations.test.ts`: List conversations
- `admin-tools.test.ts`: Health, cleanup

## Version

Current: **0.3.0**

## License

MIT
