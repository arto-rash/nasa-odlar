#!/usr/bin/env bash
set -e

export PORT="${PORT:-8080}"

# Render the nginx config with the runtime port (only ${PORT} is substituted).
envsubst '${PORT}' < /etc/nginx/templates/app.conf.template > /etc/nginx/conf.d/app.conf

# Cache config/routes from the live environment.
php artisan config:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache

# Migrations on every boot (idempotent).
php artisan migrate --force || echo ">> Migration failed: check DB_* env vars."

# Region geometries come from the ML service, which may still be starting.
for attempt in 1 2 3 4 5; do
    if php artisan odlar:sync-regions; then
        break
    fi
    echo ">> Region sync attempt ${attempt} failed; retrying in 6s"
    sleep 6
done || true

# Demo account: seeded outside production, or in production when SEED_DEMO=true. Idempotent.
php artisan db:seed --force || echo ">> Seeding failed (continuing)."

# Anything root wrote under storage/ (logs, file cache) goes back to the web user.
chown -R www-data:www-data storage bootstrap/cache

exec supervisord -c /etc/supervisor/conf.d/app.conf -n
