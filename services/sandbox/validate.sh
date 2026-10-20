#!/usr/bin/env bash
set -euo pipefail
image="${1:-red-sandbox:story-0002}"
fixture_name="red-sandbox-fixture-$$"
export SANDBOX_EXECD_TOKEN
SANDBOX_EXECD_TOKEN="$(openssl rand -hex 32)"
cleanup() { docker rm -f "$fixture_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# This fixture deliberately has no access to a target or operator substrate.
docker run -d --name "$fixture_name" --cap-drop ALL --security-opt no-new-privileges \
  --read-only --tmpfs /tmp:rw,mode=1777 --tmpfs /home/sandboxer:rw,uid=1000,gid=1000 \
  --tmpfs /workspace:rw,uid=1000,gid=1000,mode=0700 --pids-limit 256 --memory 1g --cpus 1 \
  -p 127.0.0.1::44772 -e SANDBOX_EXECD_TOKEN "$image" >/dev/null
fixture_port="$(docker port "$fixture_name" 44772/tcp | awk -F: 'NR==1 {print $NF}')"
export SANDBOX_URL="http://127.0.0.1:$fixture_port"
ready=false
for ((attempt=0;attempt<30;attempt++)); do
  if curl --fail --silent "$SANDBOX_URL/ready" >/dev/null; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'Sandbox fixture did not become ready' >&2
  exit 1
fi
[[ "$(docker exec "$fixture_name" id -u)" == 1000 ]]
# The app packages are ESM-only; compile the fixture as ESM rather than using
# tsx's CommonJS fallback for this repository's root scripts.
pnpm --filter @cogni/ai-tools exec tsup ../../services/sandbox/validate-client.ts \
  --config false --format esm --platform node --tsconfig ../../app/tsconfig.app.json \
  --out-dir ../../app/node_modules/.cache/sandbox-runtime --no-splitting \
  --external @cogni/ai-tools --external @cogni/ai-core --external @cogni/node-shared --external pino
mv app/node_modules/.cache/sandbox-runtime/validate-client.js app/node_modules/.cache/sandbox-runtime/validate-client.mjs
node app/node_modules/.cache/sandbox-runtime/validate-client.mjs
