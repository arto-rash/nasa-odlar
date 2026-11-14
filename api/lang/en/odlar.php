<?php

return [
    'levels' => [
        'low' => 'low',
        'moderate' => 'moderate',
        'high' => 'high',
        'very_high' => 'very high',
        'extreme' => 'extreme',
    ],
    'mail' => [
        'subject' => 'ODLAR fire risk alert: :level risk in :region',
        'greeting' => 'Hello :name,',
        'body' => 'The 7-day fire risk forecast for :region is now :level (as of :date).',
        'probability' => 'Chance of above-normal fire activity: :value%',
        'threshold' => 'You asked to be notified at ":threshold" or above.',
        'cta' => 'Open the region in ODLAR',
        'footer' => 'You receive this because you subscribed to fire-risk alerts on ODLAR. Manage subscriptions in your account.',
    ],
];
