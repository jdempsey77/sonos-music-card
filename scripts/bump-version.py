#!/usr/bin/env python3
"""Bump the ?v= cache-buster on the sonos-music-card HA Lovelace resource.

The HA resource registry is WebSocket-only on this install — the REST endpoint
(/api/lovelace/resources) 404s. Reads the current ?v=N, increments it, and writes
?v=N+1 back via lovelace/resources/update. Token comes from HOME_ASSISTANT_TOKEN
(sourced from .env by deploy.sh) — never hard-coded.
"""
import json, websocket, os, re, sys

token = os.environ['HOME_ASSISTANT_TOKEN']
resource_id = '209d071230f4490e838dba8d0eac535e'
ha_url = 'wss://ha.dempsey5.com/api/websocket'

ws = websocket.create_connection(ha_url, timeout=15)
ws.recv()  # hello
ws.send(json.dumps({'type': 'auth', 'access_token': token}))
ws.recv()  # auth_ok

# Fetch current resources to read current ?v=
ws.send(json.dumps({'id': 1, 'type': 'lovelace/resources'}))
resp = json.loads(ws.recv())
resources = resp.get('result', [])
entry = next((r for r in resources if r.get('id') == resource_id), None)
if not entry:
    print(f'ERROR: resource {resource_id} not found', file=sys.stderr)
    sys.exit(1)

current_url = entry['url']
m = re.search(r'\?v=(\d+)$', current_url)
current_v = int(m.group(1)) if m else 0
next_v = current_v + 1
new_url = re.sub(r'\?v=\d+$', f'?v={next_v}', current_url)
if '?v=' not in new_url:
    new_url = current_url + f'?v={next_v}'

ws.send(json.dumps({
    'id': 2,
    'type': 'lovelace/resources/update',
    'resource_id': resource_id,
    'url': new_url,
    'res_type': 'module'
}))
result = json.loads(ws.recv())
ws.close()

if result.get('success'):
    print(f'?v= bumped: {current_v} -> {next_v}  ({new_url})')
else:
    print(f'ERROR: bump failed: {result}', file=sys.stderr)
    sys.exit(1)
