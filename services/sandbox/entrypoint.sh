#!/bin/sh
set -eu
# Never start an unauthenticated execution daemon or print credentials.
if [ "${#SANDBOX_EXECD_TOKEN}" -lt 32 ]; then
  echo 'SANDBOX_EXECD_TOKEN must contain at least 32 characters' >&2
  exit 1
fi
export EXECD_ACCESS_TOKEN="$SANDBOX_EXECD_TOKEN"
unset SANDBOX_EXECD_TOKEN
# execd is PID 1 and reaps orphaned children. Keep its init entrypoint alive.
exec /usr/local/bin/execd --init --log-level 4 -- /bin/sleep infinity
