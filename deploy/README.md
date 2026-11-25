# Deployment

The judge service runs under systemd on an Ubuntu 24.04 host (an LXC container works). The web app
will be added here when it is deployed. Commands run as root unless they say otherwise.

## Judge

`packages/judge` listens on `127.0.0.1:3101` and stores nothing. It needs no tunnel route: the web app on
the same host calls it (its `POST /api/judge` forwards to `JUDGE_URL`, default `http://127.0.0.1:3101`).

Files in `deploy/judge/`:

| File | Installed as | What |
|---|---|---|
| `vimchallenge-judge.service` | `/etc/systemd/system/` | The service: user, port, one worker, memory cap, journal rate limit. |
| `sandbox.conf` | `/etc/systemd/system/vimchallenge-judge.service.d/` | No privileges or capabilities, a system call filter, no outgoing connections. Works in LXC. |
| `sandbox-mounts.conf` | same directory | Read-only file system, private `/tmp` and `/dev`. Needs mount namespaces, which some LXC containers refuse. |

### 1. Node.js 22.18 or newer

The service runs the TypeScript sources directly, which needs Node 22.18+ at `/usr/bin/node`.

```bash
node -v
```

If it is older or missing, install Node 22 from NodeSource (`curl -fsSL https://deb.nodesource.com/setup_22.x | bash -`,
then `apt install -y nodejs`), which gives the latest 22.x.

### 2. User and code

```bash
adduser --disabled-password --gecos "" vimchallenge
sudo -u vimchallenge -H bash -c 'git clone https://github.com/piotrtamborski-cmyk/vimchallenge.git ~/app && cd ~/app && npm ci --omit=dev --workspace=@vimchallenge/judge'
```

This installs only what the judge needs (about 26 MB: jsdom, CodeMirror, vim-core). There is no build step.
Check that port 3101 is free: `ss -ltn | grep 3101` prints nothing.

### 3. Service and sandbox

```bash
cp /home/vimchallenge/app/deploy/judge/vimchallenge-judge.service /etc/systemd/system/
mkdir -p /etc/systemd/system/vimchallenge-judge.service.d
cp /home/vimchallenge/app/deploy/judge/sandbox.conf /home/vimchallenge/app/deploy/judge/sandbox-mounts.conf /etc/systemd/system/vimchallenge-judge.service.d/
systemd-analyze verify /etc/systemd/system/vimchallenge-judge.service
systemctl daemon-reload
systemctl enable --now vimchallenge-judge
systemctl status vimchallenge-judge --no-pager
```

`verify` prints nothing when the files are valid. The status should be `active (running)` with the line
`judge on http://127.0.0.1:3101 with 1 workers`.

If the service fails with `status=226/NAMESPACE`, the container does not allow mount namespaces. Remove that
drop-in and keep the rest of the sandbox:

```bash
rm /etc/systemd/system/vimchallenge-judge.service.d/sandbox-mounts.conf
systemctl daemon-reload && systemctl restart vimchallenge-judge
```

If it still fails, `journalctl -u vimchallenge-judge -n 50` shows why. Removing `sandbox.conf` too brings it to
the plain service; the judge then relies on its own limits (time, heap, text size) only.

### 4. Check

```bash
curl -s localhost:3101/healthz
curl -s -X POST localhost:3101/v1/judge -H 'content-type: application/json' -d '{"task":"undo-a-change","version":1,"keys":["x","u"]}'
curl -s -X POST localhost:3101/v1/judge -H 'content-type: application/json' -d '{"task":"undo-a-change","version":1,"keys":["9","9","9","9","9","i","x","<Esc>"]}'
curl -s -X POST localhost:3101/v1/judge -H 'content-type: application/json' -d '{"task":"undo-a-change","version":1,"keys":["x","u"]}'
```

Expected: `"verdict":"passed"`; then `"verdict":"rejected","reason":"time"` after about 2 seconds (that run
would keep the engine busy for a minute, so its worker is stopped); then `passed` again from the new worker.

```bash
systemd-analyze security vimchallenge-judge --no-pager | tail -1
systemctl show vimchallenge-judge -p MemoryCurrent -p MemoryMax
cat /sys/fs/cgroup/system.slice/vimchallenge-judge.service/memory.max
```

The exposure level should be low (1.7 with both drop-ins, measured under systemd 255). `memory.max` shows `367001600`
when the memory cap is enforced; `max` or a missing file means the container does not delegate the memory
controller, and only the judge's own heap limits apply (96 MB for the main thread, 128 MB per worker).

### Logs

```bash
journalctl -u vimchallenge-judge -f
```

One line per request: method, path, status, task, verdict and time, e.g.
`POST /v1/judge 200 undo-a-change passed 23ms`. Keys and client addresses are never logged.

### Settings

`systemctl edit vimchallenge-judge` creates an override, e.g.:

```ini
[Service]
Environment=JUDGE_WORKERS=2
```

| Variable | Default in the unit | Meaning |
|---|---|---|
| `JUDGE_WORKERS` | `1` | Worker threads. One takes about 135 MB with the service; two about 250 MB. Raise `MemoryHigh`/`MemoryMax` with it. |
| `PORT`, `HOST` | `3101`, `127.0.0.1` | Where the service listens. Keep it on localhost. |

Run limits (keys, text size, time, worker heap) are part of the judge's version and live in
`packages/judge/src/limits.ts`, not in the environment.

### Update

```bash
sudo -u vimchallenge -H bash -c 'cd ~/app && git pull --ff-only && npm ci --omit=dev --workspace=@vimchallenge/judge'
systemctl restart vimchallenge-judge
```

When a pull changes `deploy/judge/`, copy the changed files again as in step 3 and run
`systemctl daemon-reload` before the restart. A restart drops runs in progress; callers get no answer and
should retry.

### Remove

```bash
systemctl disable --now vimchallenge-judge
rm -r /etc/systemd/system/vimchallenge-judge.service /etc/systemd/system/vimchallenge-judge.service.d
systemctl daemon-reload
```
