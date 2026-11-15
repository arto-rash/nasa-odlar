# ODLAR gateway

- **PHP version: production and CI run PHP 8.3** (`odlar-api` image, GitHub Actions). A local PHP may be newer; do not use syntax or functions newer than 8.3.
- This gateway proxies the FastAPI analytics service (`App\Services\MlClient`, `AnalyticsController`) and owns users, subscriptions, alerts (mail and Telegram) and PostGIS region geometry. Validation of proxied queries lives in `App\Http\Requests\*Request` classes extending `ProxyQueryRequest`.
- Tests need PostgreSQL with PostGIS (`phpunit.xml`: 127.0.0.1:5436, database `odlar_test`). CI provides it as a service container.
- Run `vendor/bin/pint --test` before committing; CI fails on style.
- Secrets (Telegram token, mail, app key) live only in the server's `/opt/odlar/deploy/.env`, never in the repo.
- **Deployment is self-hosted**, not Laravel Cloud: the gateway runs as the `api` service of `deploy/docker-compose.prod.yml` on the project's own server (code rsynced to `/opt/odlar`, image built there with `composer install --no-dev`). Ignore suggestions to deploy elsewhere.
