#!/usr/bin/env bash
# Points ~/current back at the newest complete release older than the current one. Run as the
# service user, then restart both services:
#
#   sudo -u vimchallenge -H bash ~vimchallenge/current/deploy/rollback.sh
#   systemctl restart vimchallenge-judge vimchallenge-web
set -euo pipefail

home=${VC_HOME:-$HOME}
database=${VC_DATABASE:-/var/lib/vimchallenge/accounts.db}
current=$(readlink -f "$home/current")
target=
older=
# Release names start with their UTC time, so they sort by time; newest first.
while read -r dir; do
  dir=$(readlink -f "$dir")
  if [ "$dir" = "$current" ]; then older=1; continue; fi
  if [ -n "$older" ] && [ -e "$dir/.complete" ]; then target=$dir; break; fi
done < <(ls -1d "$home"/releases/*/ | sort -r)

if [ -z "$target" ]; then
  echo "no complete release older than $current" >&2
  exit 1
fi

# An older release stops at start when the database has a schema it cannot use. Then the copy made
# before the current release was installed has to come back first (deploy/README.md, "Rolling back").
if [ -f "$database" ] && [ -f "$current/packages/accounts/src/schema.ts" ]; then
  status=0
  node --disable-warning=ExperimentalWarning "$current/packages/accounts/src/schema.ts" "$database" "$target" || status=$?
  if [ "$status" -eq 3 ]; then
    before=$(cat "$current/.backup-before" 2>/dev/null || echo "the newest copy in /var/backups/vimchallenge from before $(basename "$current" | cut -d- -f1-2)")
    {
      echo "Not rolled back: $target cannot use the database as it is now."
      echo "Restore the copy made just before the current release was installed:"
      echo "  $before"
      echo "Changes since then are lost. As root, following deploy/README.md (\"Rolling back\"):"
      echo "  systemctl stop vimchallenge-web vimchallenge-judge"
      echo "  set aside $database with its -wal and -shm files, copy the backup in its place,"
      echo "  run this script again, then: systemctl start vimchallenge-judge vimchallenge-web"
    } >&2
    exit 3
  elif [ "$status" -ne 0 ]; then
    echo "could not check the database schema (exit $status); not rolled back" >&2
    exit 1
  fi
fi

ln -sfn "$target" "$home/current.new"
mv -T "$home/current.new" "$home/current"
echo "current → $target"
echo "restart to run it: systemctl restart vimchallenge-judge vimchallenge-web"
