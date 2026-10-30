# catalog-sync-prestashop

Integra catálogos de proveedores externos en una tienda PrestaShop 1.7 como productos nativos.

> 🚧 En construcción (fase 1 de 5). La documentación completa llegará en la fase 5.

## Arranque rápido

```bash
cp .env.example .env   # y rellena PS_WEBSERVICE_KEY (ver abajo)
docker compose up -d   # PrestaShop 1.7.8 + MariaDB; la 1.ª instalación tarda ~2 min
npm ci
npm run ps:ping        # comprueba la conexión y los permisos de la clave
```

Genera una clave de API válida (32 caracteres A-Z0-9):

```bash
LC_ALL=C tr -dc 'A-Z0-9' </dev/urandom | head -c 32; echo
```

- Tienda: http://localhost:8080 · Back-office: http://localhost:8080/admin-dev (`PS_ADMIN_MAIL` / `PS_ADMIN_PASSWORD`)
- `npm run ps:demo-product` crea un producto simple de prueba (idempotente).

## Webservice y clave de API

Al terminar la instalación automática, `docker/post-install/10-webservice.sh` activa el Webservice,
crea la clave `PS_WEBSERVICE_KEY` con permisos GET/POST/PUT/DELETE/HEAD sobre `products`,
`combinations`, `product_options`, `product_option_values`, `stock_availables`, `categories` e
`images`, y regenera el `.htaccess` para que `/api/` funcione.

Si la tienda ya estaba instalada (o cambias la clave), ejecuta:

```bash
npm run setup:webservice
```

### Pasos manuales (tienda existente, sin Docker)

1. Back-office → **Parámetros avanzados → Webservice** → «¿Activar el webservice de PrestaShop?» = **Sí**.
2. **Añadir nueva clave de webservice** → genera la clave, estado **Sí**.
3. Marca **Ver (GET), Modificar (PUT), Añadir (POST), Eliminar (DELETE) y Ver encabezados (HEAD)** en:
   `products`, `combinations`, `product_options`, `product_option_values`, `stock_availables`, `categories`, `images`.
4. Comprueba que **Parámetros de la tienda → Tráfico y SEO → URL amigables** esté activo (necesario para `/api/`).
5. Copia la clave en `PS_WEBSERVICE_KEY` y ejecuta `npm run ps:ping`.
