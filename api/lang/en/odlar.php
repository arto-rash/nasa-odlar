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
    'telegram' => [
        'alert' => '🔥 Fire risk in :region: :level for the next 7 days (:probability% chance of above-normal fire activity, as of :date).',
        'linked' => 'Done, :name. ODLAR fire-risk alerts will come here. Send /stop to turn them off.',
        'stopped' => 'Telegram alerts are off. You can turn them on again on the ODLAR alerts page.',
        'expired' => 'This link has expired or was already used. Open the alerts page on :url and press "Connect Telegram" again.',
        'help' => 'This bot sends ODLAR fire-risk alerts. Connect it from the alerts page on :url. /stop turns alerts off.',
    ],
];
