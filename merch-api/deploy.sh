#!/bin/bash
# Деплой merch-api: zip (без node_modules — облако ставит зависимости из package.json) + новая версия функции.
set -euo pipefail
cd "$(dirname "$0")"
YC=~/yandex-cloud/bin/yc
rm -f merch-api.zip
zip -qr merch-api.zip index.js package.json package-lock.json ru-ca.pem lib schema.yql
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" =~ ^[A-Z_]+= ]] && [[ "$line" == *,* || "$line" == *'"'* ]]; then
    echo 'env value contains , or " — not supported by yc --environment' >&2
    exit 1
  fi
done < .deploy.env
ARGS=()
while IFS= read -r line || [[ -n "$line" ]]; do [[ "$line" =~ ^[A-Z_]+= ]] && ARGS+=(--environment "$line"); done < .deploy.env
$YC serverless function version create \
  --function-name merch-api --runtime nodejs18 --entrypoint index.handler \
  --memory 256m --execution-timeout 30s --service-account-id "$(grep '^SA_ID=' .deploy.env | cut -d= -f2)" \
  --source-path merch-api.zip "${ARGS[@]}"
echo "deployed: $($YC serverless function get merch-api --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)["http_invoke_url"])')"
