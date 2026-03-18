# Changelog

All notable changes to this project will be documented in this file.

## 0.4.0

### Added
- add scheduled progress update support
- add `progress_schedule` and `progress_unschedule`
- add optional scheduled message push callback support
- add Feishu pinned progress card support
- add `progress_pin_card`, `progress_refresh_card`, `progress_unpin_card`
- add `progress_card_status`
- add persistent store for Feishu pinned card bindings
- add file-based Feishu card binding adapter
- add improved Feishu progress card renderer
- add tests for Feishu pinned card store, service, persistence, and index tools

## 0.3.0

### Added
- add task-based progress store
- add output modes: `text`, `compact`, `json`
- add `progress_summary`
- add `progress_replay`
- add `progress_metrics`
- add `progress_children`
- add `progress_tree`
- add `progress_conversations`
- add `progress_health`
- add `progress_cleanup`
- add prompt-context injection
- add memory and file persistence
- add workflow analytics and task tree support
- add vitest coverage for core workflow behavior

## 0.2.0

### Added
- add taskId-based progress tracking
- add history tracking for progress updates
- add `progress_get`
- add `progress_list`
- add `progress_clear`
- add TTL cleanup support
- add initial README and testing setup

## 0.1.0

### Added
- initial `progress-notifier` plugin prototype
- basic staged progress update tool
- simple progress message formatting

---

## Versioning

This project follows a simple semantic-style versioning approach:
- major: breaking changes
- minor: new features
- patch: fixes and small improvements
