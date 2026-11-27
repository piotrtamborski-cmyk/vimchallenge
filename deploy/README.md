# Deployment

Two systemd services on an Ubuntu 24.04 host (an LXC container works), run from the same release:

| Service | Listens on | What |
|---|---|---|
| `vimchallenge-web` | `127.0.0.1:3100` | The Next.js app: pages, tasks, accounts, live rooms, the daily challenge and leaderboards, `/api/judge` (forwards to the judge, rate-limited per visitor, saves the solves of signed-in players), `/api/health`. Visitors reach it through the Cloudflare Tunnel. |
| `vimchallenge-judge` | `127.0.0.1:3101` | The judge (`packages/judge`): replays key logs in worker threads under time and memory limits. Only the web app calls it. Stores nothing. |

The web app keeps accounts and rooms in one SQLite file, `/var/lib/vimchallenge/accounts.db` (Node's
built-in `node:sqlite`, no database server). Rooms run inside the web app: their state is in the
database, and pages follow them over Server-Sent Events, which pass through the tunnel like any
response (a message every 20 seconds keeps the connection open). The daily challenge needs no timer
either: a day is settled by the first request after its last run could have ended. `vimchallenge-backup.timer` copies it every six hours to
`/var/backups/vimchallenge`. Releases live in the home directory of the `vimchallenge` user:

```text
/home/vimchallenge/
  current -> releases/20261125-100341-cb1bcf09c9ff     what the services run
  releases/
    20261125-100341-cb1bcf09c9ff/   a clone of the repository with its node_modules and build
    20261124-…/                     the previous release, for rollback
```

`deploy/release.sh` makes a new release next to the running one, copies the database, and moves
`current` only when the build succeeded, so the site keeps serving until the services are restarted
(about two seconds); `deploy/rollback.sh` moves it back.

Files in `deploy/systemd/`:

| File | Installed as | What |
|---|---|---|
| `vimchallenge-web.service`, `vimchallenge-judge.service` | `/etc/systemd/system/` | The services: user, port, memory cap, journal rate limit, the web app's database directory and secrets file. The judge may connect to localhost only. |
| `vimchallenge-backup.service`, `vimchallenge-backup.timer` | `/etc/systemd/system/` | The database copy, every six hours; copies older than 14 days are deleted. |
| `sandbox.conf` | `/etc/systemd/system/<service>.service.d/` for both services | No privileges or capabilities, a system call filter. Works in LXC. |
| `sandbox-mounts.conf` | same directories | Read-only file system (except the database directory), private `/tmp` and `/dev`. Needs mount namespaces, which some LXC containers refuse. |

Commands run as root unless they say otherwise.

## 1. Node.js 22.18 or newer, git

The judge runs the TypeScript sources directly, which needs Node 22.18+ at `/usr/bin/node`.

```bash
node -v
git --version
```

If Node is older or missing, install Node 22 from NodeSource (`curl -fsSL https://deb.nodesource.com/setup_22.x | bash -`,
then `apt install -y nodejs`), which gives the latest 22.x.

## 2. User and directories

```bash
adduser --disabled-password --gecos "" vimchallenge
install -d -o vimchallenge -g vimchallenge -m 0750 /var/backups/vimchallenge
install -d -m 0700 /etc/vimchallenge
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
cp vimchallenge-web.service vimchallenge-judge.service vimchallenge-backup.service vimchallenge-backup.timer /etc/systemd/system/
for s in vimchallenge-web vimchallenge-judge; do
  mkdir -p /etc/systemd/system/$s.service.d
  cp sandbox.conf sandbox-mounts.conf /etc/systemd/system/$s.service.d/
done
systemd-analyze verify /etc/systemd/system/vimchallenge-{web,judge,backup}.service /etc/systemd/system/vimchallenge-backup.timer
systemctl daemon-reload
systemctl enable --now vimchallenge-judge vimchallenge-web vimchallenge-backup.timer
systemctl status vimchallenge-judge vimchallenge-web --no-pager
```

`verify` prints nothing when the files are valid. Both services should be `active (running)`; the
judge logs `judge on http://127.0.0.1:3101 with 1 workers`, the web app `Ready in …`. The web app
creates `/var/lib/vimchallenge/accounts.db` the first time it needs it.

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
`cloudflared`, and only that header tells visitors apart for the rate limits. It also sets
`PUBLIC_URL=https://vimchallenge.com`, from which links in emails and OAuth redirects are built; a
site on another address (staging) sets its own with `systemctl edit vimchallenge-web`.

## 6. Sign-in

Players sign in with GitHub, Google or a link sent by email; each method works once its secrets are
in `/etc/vimchallenge/web.env`, and the sign-in page offers only those that are set. Without the file
the site works, but nobody can sign in. Each environment (staging, production) needs its own OAuth
clients, because the redirect address is part of them.

**GitHub.** On github.com: **Settings → Developer settings → OAuth Apps → New OAuth App**:

| Field | Value |
|---|---|
| Application name | `vimchallenge` |
| Homepage URL | `https://vimchallenge.com` |
| Authorization callback URL | `https://vimchallenge.com/api/auth/github/callback` |
| Enable Device Flow | off |

Then **Generate a new client secret**. The app asks for the `user:email` scope only: GitHub then tells
which addresses the player verified (used to spot a second account of the same person).

**Google.** In the Google Cloud console, a new project, then **Google Auth Platform**:

1. **Branding**: app name `vimchallenge`, support email, home page `https://vimchallenge.com`, privacy policy
   `https://vimchallenge.com/privacy`, authorised domain `vimchallenge.com`. No logo: with a logo Google
   reviews the app first.
2. **Audience**: External, then **Publish app** (to production). The app asks only for `openid` and
   `email`, which need no review.
3. **Clients → Create client**: Web application, authorised redirect URI
   `https://vimchallenge.com/api/auth/google/callback`. Note the client ID and secret.

**Email links** go out through [Resend](https://resend.com). **Domains → Add domain**: `vimchallenge.com`;
Resend lists DNS records (DKIM, and SPF/MX for its bounce subdomain) to add in Cloudflare DNS as they
are, DNS only. When the domain shows *Verified*, **API Keys → Create API key** with *Sending access*
for that domain only.

The secrets file, readable by root only (systemd reads it before starting the service as
`vimchallenge`):

```bash
install -m 0600 /dev/null /etc/vimchallenge/web.env
nano /etc/vimchallenge/web.env
```

```ini
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
RESEND_API_KEY=re_...
MAIL_FROM=vimchallenge <sign-in@vimchallenge.com>
```

```bash
systemctl restart vimchallenge-web
```

Leave out the lines of a method you do not use yet. Do not quote the values and do not `source` the
file in a shell: systemd reads it as `KEY=value` lines.

## 7. Check

```bash
curl -s localhost:3100/api/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:3100/tasks/undo-a-change
curl -s -X POST localhost:3100/api/judge -H 'content-type: application/json' -H 'cf-connecting-ip: 192.0.2.1' -d '{"task":"undo-a-change","version":1,"keys":["x","u"]}'
curl -s -X POST localhost:3101/v1/judge -H 'content-type: application/json' -d '{"task":"undo-a-change","version":1,"keys":["9","9","9","9","9","i","x","<Esc>"]}'
```

Expected: `{"ok":true,"release":"<commit>","judge":"up","accounts":"ok"}` (the judge needs a second
or two after a start to say `up`); `200`; `"verdict":"passed"` with `"saved":false,"signedIn":false`;
and `"verdict":"rejected","reason":"time"` after about 2 seconds: that run would keep the engine busy
for a minute, so its worker is stopped and replaced.

Then open https://vimchallenge.com: solve a task and press Check, and the page should say *Confirmed
by the server*. Start a room in one browser and join it from another (or a private window); after
both press *I'm ready* and the host starts, both should see the countdown and the same task at the
same moment, without reloading. The live stream should print a `data:` line at once and another
within 20 seconds:

```bash
curl -s -N https://vimchallenge.com/api/rooms/<code>/events | cut -c1-80
``` Sign in with each method you set up; the name in the top right opens the account
page, which lists the solved task after another Check. Connect a second method there, sign out, and
sign in with it: the same account and progress come back.

`curl -sI https://vimchallenge.com | grep -i -E 'content-security|x-frame|strict-transport'` shows the
security headers; the browser console should show no Content Security Policy errors.

```bash
systemd-analyze security vimchallenge-web vimchallenge-judge --no-pager | grep Overall
systemctl show vimchallenge-web vimchallenge-judge -p MemoryCurrent -p MemoryMax
cat /sys/fs/cgroup/system.slice/vimchallenge-*.service/memory.max
systemctl start vimchallenge-backup && ls -l /var/backups/vimchallenge
```

With both drop-ins the exposure level is low (1.7 for each, measured under systemd 255 before the web
app was allowed to connect out to the sign-in providers; expect a little more for it now). Idle, the web app takes about 50 MB and the judge
about 130 MB. `memory.max` shows the cap in bytes when it is enforced; `max` or a missing file means
the container does not delegate the memory controller, and only the services' own heap limits apply.
The backup prints nothing when the database does not exist yet (nobody has signed in).

## A test server on the home network

The same release can run as a test on a machine in the home network, without Cloudflare: the web app
then listens on the network, builds links from the address you open, and uses the connection's own
address for the rate limits. A drop-in next to the sandbox does it, e.g. for a machine reached at
`http://test-box:3100`:

```ini
# /etc/systemd/system/vimchallenge-web.service.d/test-lan.conf
[Service]
Environment=PUBLIC_URL=http://test-box:3100
Environment=CLIENT_IP_HEADER=
Environment=MAIL_TO_LOG=1
ExecStart=
ExecStart=/usr/bin/node --max-old-space-size=192 --disable-warning=ExperimentalWarning /home/vimchallenge/current/node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3100
```

With `MAIL_TO_LOG=1` and no Resend, *Email me a link* prints the message to the journal; open the link
from there:

```bash
journalctl -u vimchallenge-web -n 50 --no-pager | grep 'sign-in/email' | tail -1
```

Google sign-in needs HTTPS (or `localhost`), so it does not work on such a test; GitHub does, with a
callback on the test address.

## Releases

New release of `main` (or another branch or tag as the argument), then restart onto it:

```bash
sudo -u vimchallenge -H bash ~vimchallenge/current/deploy/release.sh
systemctl restart vimchallenge-judge vimchallenge-web
curl -s localhost:3100/api/health        # the new commit
```

A failed build leaves `~/current` unchanged and prints where the broken release is. Before switching,
the script copies the database to `/var/backups/vimchallenge` (a failed copy stops the release). It
keeps the two newest releases and never deletes one a running service still works in. When a
release changes `deploy/systemd/`, copy the changed files again as in step 4 and run
`systemctl daemon-reload` before the restart.

### Rolling back

Rollback to the newest complete release before the current one:

```bash
sudo -u vimchallenge -H bash ~vimchallenge/current/deploy/rollback.sh
systemctl restart vimchallenge-judge vimchallenge-web
```

A release may add to the database's schema, which it does when it first opens it. Each change of
schema says which older releases can still use the database (`READERS` in
`packages/accounts/src/db.ts`). An added table or column keeps them working; then the rollback
simply switches. When the older release cannot use the database, or predates that record (before
schema 4), `rollback.sh` does not switch. Instead, it names the copy that `release.sh` made just before
the current release was installed (`~/current/.backup-before`). That copy has to come back first, and
everything written since it was made is lost:

```bash
systemctl stop vimchallenge-web vimchallenge-judge
cd /var/lib/vimchallenge
# Keep the newer database, with its write-ahead log, to look at later.
mv accounts.db accounts.db.newer; [ -e accounts.db-wal ] && mv accounts.db-wal accounts.db.newer-wal; rm -f accounts.db-shm
install -o vimchallenge -g vimchallenge -m 0600 "$(cat ~vimchallenge/current/.backup-before)" accounts.db
sudo -u vimchallenge -H bash ~vimchallenge/current/deploy/rollback.sh
systemctl start vimchallenge-judge vimchallenge-web
```

To see beforehand whether a release can use the database:
`node packages/accounts/src/schema.ts /var/lib/vimchallenge/accounts.db <release directory>`.

A restart drops runs the judge is replaying at that moment; the page then says the server check is not
available, and the solve still counts in training.

## Backups and restore

`vimchallenge-backup.timer` runs at 00:17, 06:17, 12:17 and 18:17 (and after a boot that missed one).
Each copy is a complete SQLite file, `vimchallenge-<UTC time>.db`, checked with `PRAGMA integrity_check`
before it is kept; copies older than 14 days are deleted. Pull them off the host like other backups.
`journalctl -u vimchallenge-backup` shows each run; a failed one leaves the unit `failed`.

To restore a copy:

```bash
systemctl stop vimchallenge-web
cd /var/lib/vimchallenge
mv accounts.db accounts.db.broken; rm -f accounts.db-wal accounts.db-shm
install -o vimchallenge -g vimchallenge -m 0600 /var/backups/vimchallenge/vimchallenge-<time>.db accounts.db
systemctl start vimchallenge-web
```

Sign-ins and solves after that copy are lost; sessions made since then end.

### Restore drill

Every copy should open and give the same leaderboards as the site. Practise this on the host, without
touching the live database, at least once before launch and after each change of schema:

```bash
cd /home/vimchallenge/current
sudo -u vimchallenge node --disable-warning=ExperimentalWarning packages/daily/src/restore-check.ts \
  "$(ls -1 /var/backups/vimchallenge/vimchallenge-*.db | tail -1)" /var/lib/vimchallenge/accounts.db
```

The script works on a scratch copy of the backup:
1. It opens the copy as this release would, migrating it if it is older, and checks it.
2. It counts every table beside the live one.
3. It compares every daily, weekly, monthly and all-time table with the same table rebuilt from the
   stored attempts.

It prints how long the restore took, and exits with 1 when the copy is damaged or a table
differs. The live side has more rows when the site changed since the copy. For the recovery-point and
recovery-time targets (2 h and 4 h to begin with), note the age of the newest copy
(`ls -l /var/backups/vimchallenge | tail -2`) and how long the steps above take by hand.

## Daily challenge corrections

When a task of a day's set turns out to be faulty (a wrong goal, a judge fault), take it out of that
day for everyone. The day's entries are rebuilt, and with them the daily, weekly, monthly and
all-time tables; the entries before are kept with the correction. Run it as the service user, with
the day (UTC) and the task's position in the set (1 to 5):

```bash
cd /home/vimchallenge/current
sudo -u vimchallenge node --disable-warning=ExperimentalWarning packages/daily/src/admin.ts /var/lib/vimchallenge/accounts.db show 2026-12-01
sudo -u vimchallenge node --disable-warning=ExperimentalWarning packages/daily/src/admin.ts /var/lib/vimchallenge/accounts.db void 2026-12-01 3 "wrong expected text"
```

`restore` undoes a void with the same arguments; `rebuild <day>` works out a day's entries again from
its attempts (after restoring a backup, say). The web app reads the tables straight from the entries,
so it shows the change at once; there is nothing to restart.

## What to watch

| What | How | Look for |
|---|---|---|
| Both services up, the release | `curl -s localhost:3100/api/health` | `"ok":true`, `"judge":"up"`, `"accounts":"ok"`, the expected commit |
| The judge's pool | `curl -s localhost:3101/healthz` | busy workers and the queue; a queue that does not drain means more checks than workers |
| Memory and CPU of each service | `systemctl show -p MemoryCurrent,MemoryPeak,CPUUsageNSec vimchallenge-web vimchallenge-judge` | memory well under `MemoryMax` (web 400 MB, judge 350 MB); CPU seconds per minute |
| Disk | `df -h /home /var/lib /var/backups` | room for two releases (about 700 MB each) and 14 days of copies |
| Backups | `systemctl list-timers vimchallenge-backup.timer`, `journalctl -u vimchallenge-backup -n 5` | a copy every six hours, none `failed` |
| Errors | `journalctl -u vimchallenge-web -u vimchallenge-judge -p warning --since -1h` | judge timeouts, sign-in failures, database errors |
| Check times | the judge's log lines (time per request) | most well under 500 ms |
| Open connections | `ss -tn state established '( sport = :3100 )' \| wc -l` | about one per open room or daily page |

## Load test

`packages/loadtest/src/rooms.ts` plays rooms against a running site from another machine. Each
simulated guest keeps the room's event stream open, types each round's published solution in key
packets, and checks it. It measures:
- the time from a check to its verdict;
- the time from a solver's check to every other player's stream showing the solve;
- errors.

The launch test is 10 rooms of 8 players for 30 minutes. Targets: 95% of verdicts within 500 ms, 95%
of solves shown to the others within 1 s.

The site limits new rooms and joins per client address, and all simulated players come from one
machine. For the test only, let the web app take each player's address from a header the tool sends:

```ini
# /etc/systemd/system/vimchallenge-web.service.d/loadtest.conf: remove after the test
[Service]
Environment=CLIENT_IP_HEADER=x-loadtest-client
```

Never on a public site: anyone could then pick their own address and escape the limits. Then:

```bash
node --disable-warning=ExperimentalWarning packages/loadtest/src/rooms.ts --url http://test-box:3100 \
  --rooms 10 --players 8 --minutes 30 --client-header x-loadtest-client --out loadtest.json
```

While it runs, watch the host as in "What to watch", for example every 10 seconds:
`while sleep 10; do date +%T; systemctl show -p MemoryCurrent,CPUUsageNSec vimchallenge-web vimchallenge-judge; curl -s localhost:3101/healthz; echo; done`.
Restarting both services in the middle of a match is part of the drill. The rooms carry on with the
same round after the restart, and the tool counts the reconnects. Ctrl+C stops it after the matches
under way.

Page speed, from a machine with Chromium:

```bash
node --disable-warning=ExperimentalWarning packages/loadtest/src/pages.ts --url http://test-box:3100 --out pages.json
```

It loads each main page with an empty cache, as a desktop and as a phone (CPU four times slower,
slow 4G), and reports LCP and CLS. Then it types into a task's editor at about twelve keys a second
and reports each key's time to the next paint, and how much of it the page's own handlers took.
Headless Chromium on a busy machine adds waiting of its own, so compare runs on the same machine.
Field data from real visits comes only after launch.

## Logs

```bash
journalctl -u vimchallenge-web -u vimchallenge-judge -f
```

The judge writes one line per request (method, path, status, task, verdict, time); the web app logs
errors only, such as a provider that refused a sign-in or an email that could not be sent. Neither
logs keys, addresses or tokens.

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
| web | `PUBLIC_URL` | `https://vimchallenge.com` | Where visitors reach the site: links in emails, OAuth redirects, the origin forms must come from. Cookies are `Secure` when it is `https`. |
| web | `DATABASE_PATH` | `/var/lib/vimchallenge/accounts.db` | The accounts database. |
| web | `JUDGE_URL` | `http://127.0.0.1:3101` | Where the web app finds the judge. |
| web | `CLIENT_IP_HEADER` | `cf-connecting-ip` | Header with the visitor's address, for the rate limits. |
| web | `JUDGE_RATE_BURST`, `JUDGE_RATE_PER_MINUTE` | `20`, `30` | Checks per visitor address on `/api/judge`. |
| web | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `MAIL_FROM` | in `/etc/vimchallenge/web.env` | Sign-in methods (step 6). |
| web | `MAIL_TO_LOG` | unset | `1` on a test server without Resend: sign-in links go to the journal instead of an inbox. Ignored when `PUBLIC_URL` is `https`: whoever reads the log could sign in as anyone. |

Run limits of the judge (keys, text size, time, worker heap) are part of its version and live in
`packages/judge/src/limits.ts`, not in the environment. Sign-in limits are in the code too: a session
ends after 30 days without a visit and after 180 days in any case; an email link works once within 15
minutes; an address gets at most 5 links an hour.

## Remove

```bash
systemctl disable --now vimchallenge-web vimchallenge-judge vimchallenge-backup.timer
rm -r /etc/systemd/system/vimchallenge-{web,judge}.service /etc/systemd/system/vimchallenge-{web,judge}.service.d \
  /etc/systemd/system/vimchallenge-backup.{service,timer}
systemctl daemon-reload
```

Then remove the public hostname from the tunnel, and the user with `deluser --remove-home vimchallenge`.
The database (`/var/lib/vimchallenge`), its copies (`/var/backups/vimchallenge`) and the secrets
(`/etc/vimchallenge`) stay until you delete them; revoke the OAuth clients and the Resend key too.
