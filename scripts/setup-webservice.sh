#!/usr/bin/env bash
# Activa el Webservice de PrestaShop y crea (o actualiza) la clave de API con
# permisos sobre los recursos que usa catalog-sync. Es idempotente: se puede
# ejecutar tantas veces como se quiera.
#
# Uso: ./scripts/setup-webservice.sh            (lee PS_WEBSERVICE_KEY de .env)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

KEY="${PS_WEBSERVICE_KEY:?Define PS_WEBSERVICE_KEY en .env (32 caracteres A-Z0-9)}"
if ! [[ "$KEY" =~ ^[A-Z0-9]{32}$ ]]; then
  echo "PS_WEBSERVICE_KEY debe tener exactamente 32 caracteres en mayúsculas/dígitos" >&2
  exit 1
fi

DB_PASS="${DB_ROOT_PASSWORD:-prestashop}"
# Las imágenes recientes de MariaDB traen "mariadb"; las antiguas, "mysql".
SQL_CLIENT="$(docker compose exec -T db sh -c 'command -v mariadb || command -v mysql')"

docker compose exec -T db "$SQL_CLIENT" -uroot -p"$DB_PASS" prestashop \
  < <(sed "s/__WS_KEY__/$KEY/g" docker/webservice.sql)

echo "Webservice activado. Clave: ${KEY:0:4}…${KEY: -4}"
echo "Prueba: curl -u \"\$PS_WEBSERVICE_KEY:\" 'http://localhost:${PS_HTTP_PORT:-8080}/api/products?output_format=JSON'"
