# Progress Notifier Plugin

A lightweight OpenClaw plugin for task-based progress tracking and workflow management in long-running agent conversations.

## Features

- **Task-based Progress**: Track multiple tasks with stable `taskId` per conversation
- **Stage & Percent**: Auto-infer percent from stage, or set manually
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

## Usage Examples

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
