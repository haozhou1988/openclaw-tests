# Progress Notifier

`progress-notifier` is a lightweight observability plugin for long-running agent tasks in OpenClaw.

It gives long jobs a visible task state instead of leaving you to guess whether the agent is still working, waiting on an external API, or possibly stalled.

Core capabilities:

- structured task progress with stable `taskId`
- parent and child task trees
- automatic parent aggregation for `percent`, `status`, `stage`, and `label`
- weighted child progress with optional `weight`
- heartbeat and stale-task watchdog signals
- explicit external-wait tracking with `activityState: "waiting_external"`
- Feishu pinned cards with automatic refresh
- proactive Feishu alerts for severe states
- file persistence with startup restore for pinned cards and heartbeat visibility
- prompt-context injection for active work

## Positioning

This plugin is intentionally small in scope.

It does:

- record task state
- infer task visibility signals
- sync that state to text output and Feishu cards

It does not try to become:

- a workflow orchestrator
- a tracing platform
- a network diagnostics tool
- a general project-management system

## Installation

This repository can be used as a local OpenClaw plugin directory. The plugin manifest is:

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

If your OpenClaw setup requires an explicit path:

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

Restart OpenClaw and confirm tools such as `progress_update`, `progress_get`, `progress_tree`, and `progress_pin_card` are available.

## Recommended Workflow

The most useful pattern is:

1. Create one parent task for the overall job.
2. Create child tasks for meaningful work units.
3. Update child tasks as work advances.
4. Let the parent task aggregate automatically.
5. Pin the parent task to Feishu if you want an external progress surface.

Parent task:

```json
{
  "taskId": "paper-1",
  "label": "Paper workflow",
  "stage": "start",
  "status": "running"
}
```

Child task:

```json
{
  "taskId": "paper-1.search",
  "parentTaskId": "paper-1",
  "label": "Search sources",
  "stage": "research",
  "status": "running"
}
```

As child tasks move, the parent task automatically derives:

- `percent`
- `status`
- `stage`
- `label`

Example parent output:

```text
[research] 1/2 child tasks complete, 1 running
[======>---] 67%
activity: last activity 4s ago
```

## Weighted Progress

If child tasks do not contribute equally, set `weight`.

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

When weights are present, the parent percent becomes a weighted average:

```text
[research] 50% complete (weighted), 1/2 child tasks complete, 1 running
[====>-----] 50%
activity: last activity 8s ago
```

## Watchdog And External Waits

One of the main goals of this plugin is to make silent agent runs less opaque.

The watchdog separates:

- real progress
- heartbeat-only liveness
- external waiting
- severe waiting
- likely stalls

When you know a task is waiting on an external dependency, update the same task with:

```json
{
  "taskId": "paper-1",
  "label": "Waiting for OpenAI response",
  "status": "running",
  "activityState": "waiting_external",
  "waitingOn": "openai"
}
```

That produces text like:

```text
[research] [waiting:openai] Waiting for OpenAI response
[====>-----] 48%
activity: waiting on openai | waiting 42s | last activity 42s ago | heartbeat 5s ago
```

If the wait lasts longer than `staleAfterMs`, the state upgrades to a slow external call instead of a generic stall:

```text
[research] [api-slow:openai] Waiting for OpenAI response
[====>-----] 48%
watchdog: external call slow (openai) | waiting 3m | last activity 3m ago | heartbeat 5s ago
```

If there is no external wait signal and no real activity for too long:

```text
[research] [stale] Drafting report
[====>-----] 48%
watchdog: possibly stalled | last activity 4m ago | heartbeat 10s ago
```

A normal real `progress_update` clears the waiting state automatically.

## Parent Waiting Aggregation

Parents now surface the dominant waiting signal from unfinished descendants.

Examples:

- `waiting on openai`
- `external call slow (openai)`

Priority rules:

- `waiting_external_slow` wins over `waiting_external`
- ties fall back to the most recently updated waiting child

This keeps the parent card useful even when only children are being updated.

## Feishu Cards

Feishu is the main external visibility surface for this plugin.

Use `progress_pin_card` to create or bind a pinned card:

```json
{
  "taskId": "paper-1",
  "receiveId": "your-chat-id",
  "receiveIdType": "chat_id",
  "showSummary": true
}
```

When a pinned task changes:

- the card refreshes automatically
- pinned parent cards refresh when derived parent state changes
- watchdog state shows up in the card subtitle and activity section

The card is the main surface. Alerts are only a lightweight escalation layer.

## Proactive Feishu Alerts

If `enableFeishuAlerts` is enabled, the plugin sends a separate Feishu text alert when a pinned task enters one of these severe states:

- `waiting_external_slow`
- `stale`

Alert text stays intentionally short:

- `External call slow: waiting on openai`
- `Possibly stalled: no real activity for 4m`

Alert behavior:

- alerts trigger on state transition, not every heartbeat
- the same severe state does not repeatedly alert on every refresh
- `alertCooldownMs` provides extra protection against noisy flapping
- alerts are sent to the same Feishu target as the pinned card

## Persistence And Startup Restore

When `persistenceMode` is set to `file`, the plugin persists task state and Feishu card bindings on disk.

If `restoreStateOnStartup` is enabled, startup restore will:

- restore pinned Feishu card bindings
- restart heartbeat visibility for tasks in `running` or `retrying`

First version limits:

- it restores pinned cards and heartbeat/watchdog visibility
- it does not replay old manual `summary` schedules
- it does not try to reconstruct full workflow orchestration

## Configuration

The config schema lives in [openclaw.plugin.json](./openclaw.plugin.json).

Common options:

| Config | Type | Default | Description |
|---|---|---:|---|
| `ttlMs` | `number` | `600000` | Task expiration time in milliseconds |
| `injectPromptContext` | `boolean` | `true` | Inject active progress context into prompts |
| `promptContextLimit` | `number` | `2` | Maximum active tasks injected into prompts |
| `defaultStages` | `string[]` | `["start","research","draft","revise","done"]` | Stage pipeline used for stage-based percent inference |
| `persistenceMode` | `"memory" \| "file"` | `"memory"` | Storage backend |
| `persistenceDir` | `string` | `".progress-store"` | File persistence directory |
| `enableScheduledUpdates` | `boolean` | `false` | Enable manual scheduled updates |
| `defaultUpdateIntervalMs` | `number` | `60000` | Default heartbeat interval |
| `pushScheduledMessages` | `boolean` | `true` | Send scheduled update messages to the conversation |
| `staleAfterMs` | `number` | `180000` | Mark active tasks as stale after this much real inactivity |
| `autoHeartbeatOnProgress` | `boolean` | `true` | Auto-start heartbeat when a task becomes `running` or `retrying` |
| `enableFeishuAlerts` | `boolean` | `false` | Send proactive Feishu alerts for severe pinned-task states |
| `alertCooldownMs` | `number` | `300000` | Extra anti-flap cooldown for proactive Feishu alerts |
| `restoreStateOnStartup` | `boolean` | `true` | Restore pinned cards and heartbeat visibility on startup in file mode |
| `feishuAppId` | `string` | none | Feishu app id for card push |
| `feishuAppSecret` | `string` | none | Feishu app secret for card push |

Recommended file-persistence setup:

```json
{
  "plugins": {
    "entries": {
      "progress-notifier": {
        "enabled": true,
        "config": {
          "persistenceMode": "file",
          "persistenceDir": ".progress-store",
          "defaultUpdateIntervalMs": 60000,
          "autoHeartbeatOnProgress": true,
          "staleAfterMs": 180000,
          "restoreStateOnStartup": true,
          "enableFeishuAlerts": true,
          "alertCooldownMs": 300000
        }
      }
    }
  }
}
```

## Core Tools

Task management:

| Tool | Purpose |
|---|---|
| `progress_update` | Create or update a task |
| `progress_get` | Get a task by `taskId` |
| `progress_list` | List tasks in the current conversation |
| `progress_clear` | Remove one task or all tasks |

Analysis:

| Tool | Purpose |
|---|---|
| `progress_summary` | Summarize task progress |
| `progress_replay` | Replay the full event history |
| `progress_metrics` | Show duration, retries, blocks, and metrics |
| `progress_children` | List direct children of a task |
| `progress_tree` | Render the task tree |

Admin:

| Tool | Purpose |
|---|---|
| `progress_conversations` | List persisted conversation ids |
| `progress_health` | Show plugin health and config |
| `progress_cleanup` | Remove expired or empty task records |

Scheduling:

| Tool | Purpose |
|---|---|
| `progress_schedule` | Start scheduled updates for a task |
| `progress_unschedule` | Stop scheduled updates |

Feishu:

| Tool | Purpose |
|---|---|
| `progress_pin_card` | Create or bind a pinned Feishu card |
| `progress_refresh_card` | Refresh an existing pinned card |
| `progress_unpin_card` | Remove a pinned card binding |
| `progress_card_status` | Show current card bindings |

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

## Notes

- Task data is conversation-scoped.
- Parent aggregation only happens after child task events exist.
- If you do not provide `percent`, the plugin can infer it from `stage`.
- If you do not provide either `percent` or `stage`, leaf tasks can still advance via history-based fallback.
- Heartbeats do not count as real progress for fallback percent inference.

## License

MIT
