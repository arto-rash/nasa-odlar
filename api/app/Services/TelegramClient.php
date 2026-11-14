<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/** The few Telegram Bot API calls ODLAR needs. Off until a bot token is configured. */
class TelegramClient
{
    public function enabled(): bool
    {
        return filled(config('services.telegram.token')) && filled(config('services.telegram.username'));
    }

    /** Deep link that opens the bot with a one-time code: t.me/<bot>?start=<code>. */
    public function startLink(string $code): string
    {
        return 'https://t.me/'.config('services.telegram.username').'?start='.$code;
    }

    /** @param  array{text: string, url: string}|null  $button  one link button under the message */
    public function send(int|string $chatId, string $text, ?array $button = null): void
    {
        $body = ['chat_id' => $chatId, 'text' => $text, 'disable_web_page_preview' => true];
        if ($button) {
            $body['reply_markup'] = ['inline_keyboard' => [[['text' => $button['text'], 'url' => $button['url']]]]];
        }
        $this->call('sendMessage', $body);
    }

    public function setWebhook(string $url): void
    {
        $this->call('setWebhook', [
            'url' => $url,
            'secret_token' => config('services.telegram.webhook_secret'),
            'allowed_updates' => ['message'],
        ]);
    }

    private function call(string $method, array $body): array
    {
        if (! $this->enabled()) {
            throw new RuntimeException('Telegram is not configured');
        }
        $res = Http::timeout(10)->asJson()
            ->post('https://api.telegram.org/bot'.config('services.telegram.token').'/'.$method, $body);
        if (! $res->successful() || ! $res->json('ok')) {
            throw new RuntimeException('Telegram '.$method.' failed: '.mb_substr((string) $res->json('description', $res->status()), 0, 200));
        }

        return (array) $res->json('result');
    }
}
