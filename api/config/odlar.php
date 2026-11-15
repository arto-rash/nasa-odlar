<?php

return [
    'version' => env('ODLAR_VERSION', '1.0.0'),

    // Internal FastAPI analytics service (../ml).
    'ml' => [
        'url' => rtrim(env('ODLAR_ML_URL', 'http://ml:8001'), '/'),
        'token' => env('ODLAR_INTERNAL_TOKEN'),
        'timeout' => (int) env('ODLAR_ML_TIMEOUT', 20),
        'retries' => (int) env('ODLAR_ML_RETRIES', 2),
        'retry_sleep_ms' => (int) env('ODLAR_ML_RETRY_SLEEP_MS', 250),
    ],

    // Proxied ML responses are cached here (large bodies: file store by default, not the DB).
    'cache' => [
        'store' => env('ODLAR_CACHE_STORE', 'file'),
        'ttl' => (int) env('ODLAR_CACHE_TTL', 600),
    ],

    // Shared secret the website's server sends with its own data fetches (rate limits).
    'frontend_token' => env('FRONTEND_TOKEN'),

    // First FRONTEND_URLS entry: used for links in emails.
    'frontend_url' => rtrim(trim(explode(',', (string) env('FRONTEND_URLS', 'http://localhost:3000'))[0]), '/'),

    // Seed the demo account even when APP_ENV=production.
    'seed_demo' => (bool) env('SEED_DEMO', false),
];
