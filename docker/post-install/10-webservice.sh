#!/bin/sh
# Se ejecuta dentro del contenedor de PrestaShop justo después de la instalación
# automática. Aplica el mismo SQL que scripts/setup-webservice.sh.
set -e
cd /var/www/html
if ! echo "$PS_WEBSERVICE_KEY" | grep -Eq '^[A-Z0-9]{32}$'; then
  echo "* [catalog-sync] AVISO: PS_WEBSERVICE_KEY no tiene 32 caracteres A-Z0-9; PrestaShop la rechazará." >&2
fi
echo "* [catalog-sync] Activando Webservice y creando clave de API..."
sed "s/__WS_KEY__/${PS_WEBSERVICE_KEY}/g" /opt/catalog-sync/webservice.sql \
  | mysql -h "$DB_SERVER" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWD" "$DB_NAME"

# URL amigables + .htaccess regenerado para que /api/ resuelva al dispatcher del
# Webservice. En CLI no hay petición HTTP, así que simulamos el host de la tienda.
HTTP_HOST="$PS_DOMAIN" php -r '
  $_SERVER["HTTP_HOST"] = getenv("HTTP_HOST");
  $_SERVER["REQUEST_URI"] = "/";
  require "config/config.inc.php";
  Configuration::updateValue("PS_REWRITING_SETTINGS", 1);
  Tools::generateHtaccess();
'
chown www-data:www-data .htaccess
echo "* [catalog-sync] Webservice listo"
