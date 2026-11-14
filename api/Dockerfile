# syntax=docker/dockerfile:1
# ODLAR API: nginx + php-fpm + scheduler under supervisord, listening on $PORT (default 8080).
FROM php:8.3-fpm-bookworm

# PHP2Shell (CVE-2026-109618, CVE-2026-109619): 8.3.36 is the first safe 8.3.
RUN php -r 'if (version_compare(PHP_VERSION, "8.3.36", "<")) { fwrite(STDERR, "PHP ".PHP_VERSION." is vulnerable to PHP2Shell: need 8.3.36 or later\n"); exit(1); }'

COPY --from=mlocati/php-extension-installer:latest /usr/bin/install-php-extensions /usr/bin/
RUN install-php-extensions pdo_pgsql pgsql mbstring bcmath intl zip opcache \
    && apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends supervisor gettext-base \
    && rm -rf /var/lib/apt/lists/*

# nginx from nginx.org's stable repo (bookworm's 1.22 lacks the Oct 2026 fixes in 1.30.6).
ADD https://nginx.org/keys/nginx_signing.key /usr/share/keyrings/nginx.asc
RUN chmod 644 /usr/share/keyrings/nginx.asc \
    && echo "deb [signed-by=/usr/share/keyrings/nginx.asc] https://nginx.org/packages/debian bookworm nginx" > /etc/apt/sources.list.d/nginx.list \
    && printf 'Package: *\nPin: origin nginx.org\nPin-Priority: 900\n' > /etc/apt/preferences.d/99nginx \
    && apt-get update \
    && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/conf.d/default.conf \
    && nginx -v 2>&1 | php -r '$v = preg_replace("~.*nginx/~", "", trim(stream_get_contents(STDIN))); if (version_compare($v, "1.30.6", "<")) { fwrite(STDERR, "nginx $v is unpatched: need 1.30.6 or later\n"); exit(1); }'

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Dependencies first for layer caching.
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-scripts --no-progress

COPY . .

RUN composer dump-autoload --optimize --no-dev --no-interaction \
    && php artisan package:discover --ansi \
    && chown -R www-data:www-data storage bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache

COPY docker/php.ini /usr/local/etc/php/conf.d/zz-app.ini
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/zz-app.conf
COPY docker/nginx.conf.template /etc/nginx/templates/app.conf.template
COPY docker/supervisord.conf /etc/supervisor/conf.d/app.conf
COPY docker/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

EXPOSE 8080
CMD ["/usr/local/bin/start.sh"]
