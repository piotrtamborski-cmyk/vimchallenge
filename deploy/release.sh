#!/usr/bin/env bash
# Builds a release and makes it current. Run as the service user, then restart both services:
#
#   sudo -u vimchallenge -H bash ~vimchallenge/current/deploy/release.sh [git ref, default main]
#   systemctl restart vimchallenge-judge vimchallenge-web
#
# Each release is a fresh clone in ~/releases/<UTC time>-<commit> with its own dependencies and
# build, so the running services keep serving the old one until the restart. ~/current points at
# the release to run; deploy/rollback.sh points it back at the previous one. The two newest
# releases are kept (current and the one before, about 700 MB each). Before the switch, the
# accounts database is copied, so a release that changes it can be rolled back with its data.
set -euo pipefail

repo=${VC_REPO:-https://github.com/piotrtamborski-cmyk/vimchallenge.git}
ref=${1:-main}
home=${VC_HOME:-$HOME}
database=${VC_DATABASE:-/var/lib/vimchallenge/accounts.db}
backups=${VC_BACKUPS:-/var/backups/vimchallenge}
keep=2

mkdir -p "$home/releases"
build=$(mktemp -d "$home/releases/.building-XXXXXX")
trap 'rm -rf "$build"' EXIT

git clone --quiet --depth 1 --branch "$ref" "$repo" "$build"
commit=$(git -C "$build" rev-parse --short=12 HEAD)
release="$home/releases/$(date -u +%Y%m%d-%H%M%S)-$commit"
mv "$build" "$release"
trap 'echo "release failed; $release is left for inspection and ~/current is unchanged" >&2' ERR

cd "$release"
npm ci --no-audit --no-fund --loglevel=error
NEXT_TELEMETRY_DISABLED=1 npm run -s build
# Marks a release that built completely; rollback.sh only goes back to these.
touch "$release/.complete"

if [ -f "$database" ]; then
  node --disable-warning=ExperimentalWarning "$release/packages/accounts/src/backup.ts" "$database" "$backups"
fi

ln -sfn "$release" "$home/current.new"
mv -T "$home/current.new" "$home/current"
echo "current → $release"

# Working directories of this user's processes: the services run from their release until they
# are restarted, which may be several releases back.
in_use=$(for p in /proc/[0-9]*; do [ -O "$p" ] && readlink "$p/cwd"; done 2>/dev/null || true)

# Keep the newest releases (names sort by time), and every release a running process works in.
ls -1d "$home"/releases/*/ | sort -r | tail -n +$((keep + 1)) | while read -r old; do
  old=$(readlink -f "$old")
  if grep -q -F -e "$old" <<<"$in_use"; then
    echo "kept $old: still in use until the services are restarted"
  else
    rm -rf "$old"
  fi
done
echo "restart to run it: systemctl restart vimchallenge-judge vimchallenge-web"
