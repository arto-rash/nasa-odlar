<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\TelegramClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Throwable;

/**
 * Linking a user's Telegram chat for alerts: the site hands out a one-time code
 * in a t.me deep link; the bot receives "/start <code>" on its webhook and keeps
 * that chat for the user. "/stop" unlinks.
 */
class TelegramController extends Controller
{
    private const LINK_MINUTES = 30;

    public function __construct(private readonly TelegramClient $telegram) {}

    public function link(Request $request): JsonResponse
    {
        abort_unless($this->telegram->enabled(), 503, 'Telegram alerts are not available yet');
        $code = Str::random(32);
        $request->user()->forceFill([
            'telegram_link_token' => $code,
            'telegram_link_expires_at' => now()->addMinutes(self::LINK_MINUTES),
        ])->save();

        return response()->json(['url' => $this->telegram->startLink($code), 'expires_in' => self::LINK_MINUTES * 60]);
    }

    public function unlink(Request $request): JsonResponse
    {
        $request->user()->forceFill(['telegram_chat_id' => null, 'telegram_link_token' => null, 'telegram_link_expires_at' => null])->save();

        return response()->json(['telegram_linked' => false]);
    }

    public function webhook(Request $request, string $secret): JsonResponse
    {
        $expected = (string) config('services.telegram.webhook_secret');
        abort_unless($expected !== '' && hash_equals($expected, $secret)
            && hash_equals($expected, (string) $request->header('X-Telegram-Bot-Api-Secret-Token')), 404);

        $chatId = $request->input('message.chat.id');
        $text = trim((string) $request->input('message.text', ''));
        if (! is_numeric($chatId) || $text === '') {
            return response()->json(['ok' => true]); // not a text message: nothing to do
        }
        $locale = str_starts_with((string) $request->input('message.from.language_code', ''), 'en') ? 'en' : 'az';

        try {
            if (preg_match('/^\/start(?:@\w+)?\s+(\S+)$/', $text, $m)) {
                $this->start((int) $chatId, $m[1], $locale);
            } elseif (preg_match('/^\/stop(?:@\w+)?$/', $text)) {
                $user = User::where('telegram_chat_id', $chatId)->first();
                $user?->forceFill(['telegram_chat_id' => null])->save();
                $this->telegram->send($chatId, __('odlar.telegram.stopped', [], $user?->preferredLocale() ?? $locale));
            } else {
                $this->telegram->send($chatId, __('odlar.telegram.help', ['url' => config('odlar.frontend_url')], $locale));
            }
        } catch (Throwable $e) {
            report($e);
        }

        // always 200: Telegram retries anything else
        return response()->json(['ok' => true]);
    }

    private function start(int $chatId, string $code, string $locale): void
    {
        $user = User::where('telegram_link_token', $code)->where('telegram_link_expires_at', '>', now())->first();
        if (! $user) {
            $this->telegram->send($chatId, __('odlar.telegram.expired', ['url' => config('odlar.frontend_url')], $locale));

            return;
        }
        // one chat belongs to one account
        User::where('telegram_chat_id', $chatId)->whereKeyNot($user->id)->update(['telegram_chat_id' => null]);
        $user->forceFill(['telegram_chat_id' => $chatId, 'telegram_link_token' => null, 'telegram_link_expires_at' => null])->save();
        $this->telegram->send($chatId, __('odlar.telegram.linked', ['name' => $user->name], $user->preferredLocale()));
    }
}
