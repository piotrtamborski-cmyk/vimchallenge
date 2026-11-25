#!/usr/bin/env bash
# Points ~/current back at the newest complete release older than the current one. Run as the
# service user, then restart both services:
#
#   sudo -u vimchallenge -H bash ~vimchallenge/current/deploy/rollback.sh
#   systemctl restart vimchallenge-judge vimchallenge-web
set -euo pipefail

home=${VC_HOME:-$HOME}
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
ln -sfn "$target" "$home/current.new"
mv -T "$home/current.new" "$home/current"
echo "current → $target"
echo "restart to run it: systemctl restart vimchallenge-judge vimchallenge-web"
