---
description: Read-only analysis rules for Sonos Music Card
alwaysApply: false
---

# ANALYZE — Sonos Music Card

## Hard Constraint

ANALYZE is strictly read-only. No file edits. No deploys. No service calls. Report only.

If asked to also fix something during ANALYZE: refuse the fix, deliver the report, then ask if the user wants to trigger DEPLOY separately.

## Log Locations

### Browser Console
- Open DevTools (F12 / Cmd+Option+I)
- Filter by `[sonos-music-card]` to see card-specific logs
- Check for red errors — any error is a P0 issue

### Home Assistant Logs
- Settings > System > Logs
- Filter by "sonos" or "music_assistant"
- Look for WebSocket connection errors, resource loading failures

### Music Assistant Logs
- Settings > Add-ons > Music Assistant > Logs
- Shows MA WebSocket API activity, provider sync status, playback errors

## Analysis Report Format

```
### ANALYZE REPORT — Sonos Music Card

**Date:** YYYY-MM-DD
**Scope:** {what was analyzed}

#### Findings
1. {finding} — SEVERITY: HIGH/MEDIUM/INFO

#### Log Excerpts
{relevant log lines}

#### Recommendation
{what to do next}
```
