<?php

namespace App\Console\Commands;

use App\Services\TelegramClient;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('odlar:telegram-webhook {base : Public base URL of this API, e.g. https://odlar-api.46-224-126-66.sslip.io}')]
#[Description('Point the Telegram bot at this API (run once after setting TELEGRAM_* in the environment)')]
class TelegramWebhook extends Command
{
    public function handle(TelegramClient $telegram): int
    {
        if (! $telegram->enabled() || blank(config('services.telegram.webhook_secret'))) {
            $this->error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET first.');

            return self::FAILURE;
        }
        $url = rtrim((string) $this->argument('base'), '/').'/api/v1/telegram/webhook/'.config('services.telegram.webhook_secret');
        $telegram->setWebhook($url);
        $this->info('Webhook set.');

        return self::SUCCESS;
    }
}
