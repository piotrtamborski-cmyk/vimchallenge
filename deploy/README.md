# Deployment

Two systemd services on an Ubuntu 24.04 host (an LXC container works), run from the same release:

| Service | Listens on | What |
|---|---|---|
| `vimchallenge-web` | `127.0.0.1:3100` | The Next.js app: pages, tasks, `/api/judge` (forwards to the judge, rate-limited per visitor), `/api/health`. Visitors reach it through the Cloudflare Tunnel. |
| `vimchallenge-judge` | `127.0.0.1:3101` | The judge (`packages/judge`): replays key logs in worker threads under time and memory limits. Only the web app calls it. |

Neither stores anything. Releases live in the home directory of the `vimchallenge` user:

```text
/home/vimchallenge/
  current -> releases/20261125-100341-cb1bcf09c9ff     what the services run
  releases/
    20261125-100341-cb1bcf09c9ff/   a clone of the repository with its node_modules and build
    20261124-…/                     the previous release, for rollback
```

`deploy/release.sh` makes a new release next to the running one and moves `current` only when the
build succeeded, so the site keeps serving until the services are restarted (about two seconds);
`deploy/rollback.sh` moves it back.

Files in `deploy/systemd/`:

| File | Installed as | What |
|---|---|---|
| `vimchallenge-web.service`, `vimchallenge-judge.service` | `/etc/systemd/system/` | The services: user, port, memory cap, journal rate limit. |
| `sandbox.conf` | `/etc/systemd/system/<service>.service.d/` for both | No privileges or capabilities, a system call filter, no connections beyond localhost. Works in LXC. |
| `sandbox-mounts.conf` | same directories | Read-only file system, private `/tmp` and `/dev`. Needs mount namespaces, which some LXC containers refuse. |

Commands run as root unless they say otherwise.

## 1. Node.js 22.18 or newer, git

The judge runs the TypeScript sources directly, which needs Node 22.18+ at `/usr/bin/node`.

```bash
node -v
git --version
```

If Node is older or missing, install Node 22 from NodeSource (`curl -fsSL https://deb.nodesource.com/setup_22.x | bash -`,
then `apt install -y nodejs`), which gives the latest 22.x.

## 2. User

```bash
adduser --disabled-password --gecos "" vimchallenge
ss -ltn | grep -E ':310[01]\b'      # prints nothing: both ports are free
```

## 3. First release

The script comes with the repository, so the first run uses a temporary clone:

```bash
sudo -u vimchallenge -H bash -c 'git clone -q --depth 1 https://github.com/piotrtamborski-cmyk/vimchallenge.git /tmp/vc-bootstrap && bash /tmp/vc-bootstrap/deploy/release.sh; rm -rf /tmp/vc-bootstrap'
```

It clones `main` into `~/releases/`, runs `npm ci` and `npm run build`, and points `~/current` at it.
That takes about half a minute and 700 MB of disk per release. If `next build` is killed for lack of
memory, run it with `NODE_OPTIONS=--max-old-space-size=1024` in front of `bash`.

## 4. Services and sandbox

```bash
cd /home/vimchallenge/current/deploy/systemd
cp vimchallenge-web.service vimchallenge-judge.service /etc/systemd/system/
for s in vimchallenge-web vimchallenge-judge; do
  mkdir -p /etc/systemd/system/$s.service.d
  cp sandbox.conf sandbox-mounts.conf /etc/systemd/system/$s.service.d/
done
systemd-analyze verify /etc/systemd/system/vimchallenge-web.service /etc/systemd/system/vimchallenge-judge.service
systemctl daemon-reload
systemctl enable --now vimchallenge-judge vimchallenge-web
systemctl status vimchallenge-judge vimchallenge-web --no-pager
```

`verify` prints nothing when the files are valid. Both services should be `active (running)`; the
judge logs `judge on http://127.0.0.1:3101 with 1 workers`, the web app `Ready in …`.

If a service fails with `status=226/NAMESPACE`, the container does not allow mount namespaces. Remove
that drop-in from both services and keep the rest of the sandbox:

```bash
rm /etc/systemd/system/vimchallenge-{web,judge}.service.d/sandbox-mounts.conf
systemctl daemon-reload && systemctl restart vimchallenge-judge vimchallenge-web
```

If one still fails, `journalctl -u <service> -n 50` shows why. Removing `sandbox.conf` too brings it to
the plain service.

## 5. Public hostname

In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels**, open the tunnel that already runs on
this host, **Public Hostname → Add a public hostname**:

| Field | Value |
|---|---|
| Subdomain | *(empty)* |
| Domain | `vimchallenge.com` |
| Type | `HTTP` |
| URL | `127.0.0.1:3100` |

Cloudflare creates the proxied DNS record for the name. The judge gets no hostname. For `www`, add a
proxied `CNAME www → vimchallenge.com` and a redirect rule to the apex, as for the other sites.

The web unit sets `CLIENT_IP_HEADER=cf-connecting-ip`: behind the tunnel every request comes from
`cloudflared`, and only that header tells visitors apart for the rate limit on `/api/judge`.

## 6. Check

```bash
curl -s localhost:3100/api/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:3100/tasks/undo-a-change
curl -s -X POST localhost:3100/api/judge -H 'content-type: application/json' -H 'cf-connecting-ip: 192.0.2.1' -d '{"task":"undo-a-change","version":1,"keys":["x","u"]}'
curl -s -X POST localhost:3101/v1/judge -H 'content-type: application/json' -d '{"task":"undo-a-change","version":1,"keys":["9","9","9","9","9","i","x","<Esc>"]}'
```

Expected: `{"ok":true,"release":"<commit>","judge":"up"}` (the judge needs a second or two after a
start to say `up`); `200`; `"verdict":"passed"`; and `"verdict":"rejected","reason":"time"` after about
2 seconds: that run would keep the engine busy for a minute, so its worker is stopped and replaced.

Then open https://vimchallenge.com, solve a task and press Check: the page should say *Confirmed by the
server*. `curl -sI https://vimchallenge.com | grep -i -E 'x-frame|strict-transport'` shows the security
headers.

```bash
systemd-analyze security vimchallenge-web vimchallenge-judge --no-pager | grep Overall
systemctl show vimchallenge-web vimchallenge-judge -p MemoryCurrent -p MemoryMax
cat /sys/fs/cgroup/system.slice/vimchallenge-*.service/memory.max
```

With both drop-ins the exposure level is low (1.7 for each, measured under systemd 255). Idle, the web
app takes about 50 MB and the judge about 130 MB. `memory.max` shows the cap in bytes when it is
enforced; `max` or a missing file means the container does not delegate the memory controller, and
only the services' own heap limits apply.

## Releases

New release of `main` (or another branch or tag as the argument), then restart onto it:

```bash
sudo -u vimchallenge -H bash ~vimchallenge/current/deploy/release.sh
systemctl restart vimchallenge-judge vimchallenge-web
curl -s localhost:3100/api/health        # the new commit
```

A failed build leaves `~/current` unchanged and prints where the broken release is. The script keeps the
two newest releases and never deletes one a running service still works in. When a release changes
`deploy/systemd/`, copy the changed files again as in step 4 and run `systemctl daemon-reload` before the
restart.

Rollback to the newest complete release before the current one:

```bash
sudo -u vimchallenge -H bash ~vimchallenge/current/deploy/rollback.sh
systemctl restart vimchallenge-judge vimchallenge-web
```

A restart drops runs the judge is replaying at that moment; the page then says the server check is not
available, and the solve still counts in training.

## Logs

```bash
journalctl -u vimchallenge-web -u vimchallenge-judge -f
```

The judge writes one line per request (method, path, status, task, verdict, time); the web app logs
errors only. Neither logs keys or visitor addresses.

## Settings

`systemctl edit <service>` creates an override, e.g. for the judge:

```ini
[Service]
Environment=JUDGE_WORKERS=2
```

| Service | Variable | Default in the unit | Meaning |
|---|---|---|---|
| judge | `JUDGE_WORKERS` | `1` | Worker threads. One takes about 130 MB with the service; two about 250 MB. Raise `MemoryHigh`/`MemoryMax` with it. |
| judge | `PORT`, `HOST` | `3101`, `127.0.0.1` | Where the judge listens. Keep it on localhost. |
| web | `JUDGE_URL` | `http://127.0.0.1:3101` | Where the web app finds the judge. |
| web | `CLIENT_IP_HEADER` | `cf-connecting-ip` | Header with the visitor's address, for the rate limit. |
| web | `JUDGE_RATE_BURST`, `JUDGE_RATE_PER_MINUTE` | `20`, `30` | Checks per visitor address on `/api/judge`. |

Run limits of the judge (keys, text size, time, worker heap) are part of its version and live in
`packages/judge/src/limits.ts`, not in the environment.

## Remove

```bash
systemctl disable --now vimchallenge-web vimchallenge-judge
rm -r /etc/systemd/system/vimchallenge-{web,judge}.service /etc/systemd/system/vimchallenge-{web,judge}.service.d
systemctl daemon-reload
```

Then remove the public hostname from the tunnel, and the user with `deluser --remove-home vimchallenge`.
