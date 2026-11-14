<?php

return [
    'paths' => ['api/*'],

    'allowed_methods' => ['*'],

    // FRONTEND_URLS: comma-separated exact origins (e.g. https://odlar.az,http://localhost:3000).
    'allowed_origins' => array_values(array_filter(array_map(
        fn ($o) => rtrim(trim($o), '/'),
        explode(',', (string) env('FRONTEND_URLS', 'http://localhost:3000')),
    ))),

    // Vercel preview deployments.
    'allowed_origins_patterns' => ['#^https://[a-z0-9-]+\.vercel\.app$#'],

    'allowed_headers' => ['*'],

    // Lets the browser read the export filename.
    'exposed_headers' => ['Content-Disposition'],

    'max_age' => 3600,

    // Bearer tokens, not cookies.
    'supports_credentials' => false,
];
