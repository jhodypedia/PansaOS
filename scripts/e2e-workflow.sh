#!/usr/bin/env bash
set -euo pipefail
set -a; . ./.env; set +a
cd /home/boxd/PansaOS
api() { docker compose exec -T core sh -c "curl -s $* -H 'authorization: Bearer $DASH_TOKEN'"; }
SID=$(curl -s -X POST http://127.0.0.1:3001/api/sessions >/dev/null 2>&1 || true)
SID=$(docker compose exec -T core sh -c "curl -s -X POST http://127.0.0.1:3001/api/sessions -H 'authorization: Bearer $DASH_TOKEN' -H 'content-type: application/json' -d '{\"title\":\"E2E workflow 2\"}'" | jq -r .id)
echo "session=$SID"
docker compose exec -T core sh -c "mkdir -p /app/workspace/$SID && cd /app/workspace/$SID && printf 'export const hello = (name: string) => \`hi \${name}\`;\n' > example.ts && printf '{\"name\":\"demo\",\"private\":true}\n' > package.json && chown -R 1000:1000 /app/workspace/$SID"
docker compose exec -T core sh -c "curl -s -X POST http://127.0.0.1:3001/api/sessions/$SID/mode -H 'authorization: Bearer $DASH_TOKEN' -H 'content-type: application/json' -d '{\"mode\":\"plan\"}'" >/dev/null
docker compose exec -T core sh -c "curl -s -X POST http://127.0.0.1:3001/api/sessions/$SID/message -H 'authorization: Bearer $DASH_TOKEN' -H 'content-type: application/json' -d '{\"prompt\":\"Tambahkan fungsi goodbye(name) di example.ts dan satu test di example.test.ts. Susun rencana dulu.\"}'"; echo
for i in $(seq 1 120); do
  sleep 5
  RUN=$(docker compose exec -T core sh -c "curl -s http://127.0.0.1:3001/health" | jq -r .running)
  AP=$(docker compose exec -T core sh -c "curl -s http://127.0.0.1:3001/api/approvals -H 'authorization: Bearer $DASH_TOKEN'" | jq -r '.[0].id // empty')
  if [ -n "$AP" ]; then
    echo "approve $AP at step $i"
    docker compose exec -T core sh -c "curl -s -X POST http://127.0.0.1:3001/api/approvals/$AP -H 'authorization: Bearer $DASH_TOKEN' -H 'content-type: application/json' -d '{\"approved\":true}'" >/dev/null
    continue
  fi
  echo "wait $i running=$RUN"
  [ "$RUN" = "0" ] && break
done
echo "$SID" > /tmp/e2e-session2
