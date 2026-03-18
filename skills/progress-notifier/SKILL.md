# Feishu Progress Reporting

When handling a Feishu chat request that involves reading, summarizing, rewriting, structuring, or writing back a Feishu document, treat the work as a multi-step workflow rather than a single reply. For tasks that require noticeable processing time or multiple stages, use the progress tools to report meaningful milestones, keep one stable `taskId` across the whole task lifecycle, and send the returned progress message back to the user after each `progress_update`. Prefer short, user-facing labels such as "开始处理文档""正在读取并分析文档""正在整理摘要""正在写回文档", and use summary/tree/metrics tools only when they provide clear value for the user or help resume interrupted work.

## When to use this skill

Use the progress tools when a Feishu chat task involves:
- reading a long Feishu document
- summarizing a Feishu document
- extracting action items or decisions from notes
- rewriting or restructuring document content
- generating a new document from source material
- multi-step analysis
- writing results back to a Feishu document
- any workflow that clearly has multiple meaningful stages

Do **not** use progress tools for:
- very short tasks that can be answered immediately
- simple one-shot questions
- tiny edits that do not need staged reporting

## Main behavior

For a long or multi-stage task:

1. Start the task with `progress_update`
2. Send the returned progress message to the user
3. Continue the work
4. Update progress when the task reaches a meaningful new stage
5. Finish with a final `progress_update(..., stage="done", status="done", percent=100)`

Always keep one stable `taskId` for the whole task lifecycle.

## Recommended stages

Use these stages unless the task needs a different breakdown:

- `start` → 10%
- `research` → 40%
- `draft` → 75%
- `revise` → 90%
- `done` → 100%

## Status values

- `queued` | `running` | `blocked` | `retrying` | `done` | `failed` | `canceled`

Use `running` by default.

## Tool: progress_update

**Parameters:**
- `taskId` (required): stable identifier
- `label` (required): short user-facing label
- `percent` (optional): 0-100
- `stage` (optional): start/research/draft/revise/done
- `model` (optional): model name
- `status` (optional): task status
- `parentTaskId` (optional): parent task for subtasks

**Example:**
```
taskId="feishu-doc-summary-1", stage="start", label="开始处理文档"
taskId="feishu-doc-summary-1", stage="research", label="正在读取并分析文档"
taskId="feishu-doc-summary-1", stage="draft", label="正在整理摘要"
taskId="feishu-doc-summary-1", stage="done", label="已完成", status="done", percent=100
```

## Tool: progress_get

Get current progress for one task.
- `taskId` (required)
- `outputMode` (optional): text/compact/json

## Tool: progress_list

List tasks in current conversation.
- `status` (optional)
- `outputMode` (optional)

## Tool: progress_clear

Clear task records.
- `taskId` (optional)
- `all` (optional)

## Tool: progress_summary

Generate concise task summary. Use when:
- user asks "现在进展如何"
- task was interrupted and needs recovery

## Tool: progress_replay

Full event timeline. Use for debugging.

## Tool: progress_metrics

Workflow timing, retries, blocks.

## Tool: progress_children

Direct child tasks of a parent.

## Tool: progress_tree

Render task hierarchy. Use when workflow is hierarchical.

## Tool: progress_conversations

List persisted conversation IDs. (Admin/debug)

## Tool: progress_health

Plugin health check. (Admin/debug)

## Tool: progress_cleanup

Clean expired/empty conversations. (Admin/debug)

## Tool: progress_schedule

Enable periodic progress updates for long-running tasks.

**Parameters:**
- `taskId` (required)
- `intervalMs` (optional): update interval in milliseconds
- `mode` (optional): `heartbeat | summary`
- `enabled` (optional): set to `false` to stop scheduling

**When to use:**
- Task may run for a noticeable amount of time
- User would benefit from periodic progress visibility
- Workflow may otherwise appear stalled

**Mode guidance:**
- `heartbeat`: Simple keep-alive updates. Use when user just needs reassurance task is active.
- `summary`: Periodic recap. Use when repeated heartbeats would be too noisy (e.g., Feishu chat).

**Best practices:**
- Only enable for genuinely long-running tasks
- Prefer intervals of at least 30-60 seconds
- Prefer `summary` mode in Feishu to avoid message spam

## Tool: progress_unschedule

Stop scheduled progress updates for a task.

**Parameters:**
- `taskId` (required)

**When to use:**
- Task is done, failed, or canceled
- Periodic updates no longer needed
- User asks to stop automatic reporting

Note: Scheduled updates stop automatically when task reaches `done`, `failed`, or `canceled`.

## Feishu-specific guidance

- use stable `taskId` for document workflow
- document reading = `research`
- content generation = `draft`
- refinement = `revise`
- write-back = update before and after

**Suggested taskId patterns:**
- `feishu-doc-summary-1`
- `feishu-doc-rewrite-1`
- `feishu-meeting-note-1`

**Suggested labels:**
- `开始处理文档`
- `正在读取并分析文档`
- `正在提取关键信息`
- `正在整理摘要`
- `正在润色内容`
- `正在写回文档`
- `已完成`

## Best practices

- Use progress tools only for meaningfully multi-step tasks
- Keep one stable `taskId` for task lifecycle
- Send returned message after every `progress_update`
- Prefer concise labels
- Prefer `progress_summary` for user recap
- Avoid over-updating for tiny intermediate actions
