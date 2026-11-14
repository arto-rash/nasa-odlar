<?php

use App\Models\NotificationLog;
use App\Models\Region;
use App\Models\Subscription;
use App\Models\User;
use App\Services\RiskEvaluator;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    config(['services.telegram' => ['token' => 'TEST:TOKEN', 'username' => 'odlar_test_bot', 'webhook_secret' => 'hook-secret']]);
});

function telegramUpdate(int $chat, string $text, string $lang = 'en'): array
{
    return ['update_id' => 1, 'message' => ['message_id' => 2, 'chat' => ['id' => $chat], 'from' => ['language_code' => $lang], 'text' => $text]];
}

function postHook(array $body, string $secret = 'hook-secret', ?string $header = 'hook-secret')
{
    return test()->postJson("/api/v1/telegram/webhook/{$secret}", $body, $header ? ['X-Telegram-Bot-Api-Secret-Token' => $header] : []);
}

it('hands out a one-time deep link', function () {
    $user = User::factory()->create();
    Sanctum::actingAs($user);

    $url = $this->postJson('/api/v1/telegram/link')->assertOk()->json('url');

    expect($url)->toStartWith('https://t.me/odlar_test_bot?start=')
        ->and(substr($url, strlen('https://t.me/odlar_test_bot?start=')))->toBe($user->fresh()->telegram_link_token);
    $this->getJson('/api/v1/auth/me')->assertJsonPath('telegram_linked', false)->assertJsonPath('telegram_available', true);
});

it('says when Telegram is not set up', function () {
    config(['services.telegram.token' => null]);
    Sanctum::actingAs(User::factory()->create());

    $this->postJson('/api/v1/telegram/link')->assertStatus(503);
});

it('links the chat on /start with a valid code, once', function () {
    Http::fake(['api.telegram.org/*' => Http::response(['ok' => true, 'result' => []])]);
    $user = User::factory()->create(['telegram_link_token' => 'abc123', 'telegram_link_expires_at' => now()->addMinutes(5)]);

    postHook(telegramUpdate(555, '/start abc123'))->assertOk();

    expect($user->fresh())->telegram_chat_id->toBe(555)->telegram_link_token->toBeNull();
    Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/sendMessage') && $r['chat_id'] === 555);

    postHook(telegramUpdate(777, '/start abc123'))->assertOk(); // used: not linked again
    expect($user->fresh()->telegram_chat_id)->toBe(555);
});

it('refuses expired codes', function () {
    Http::fake(['api.telegram.org/*' => Http::response(['ok' => true, 'result' => []])]);
    $user = User::factory()->create(['telegram_link_token' => 'old', 'telegram_link_expires_at' => now()->subMinute()]);

    postHook(telegramUpdate(555, '/start old'))->assertOk();

    expect($user->fresh()->telegram_chat_id)->toBeNull();
});

it('unlinks on /stop', function () {
    Http::fake(['api.telegram.org/*' => Http::response(['ok' => true, 'result' => []])]);
    $user = User::factory()->create(['telegram_chat_id' => 555]);

    postHook(telegramUpdate(555, '/stop'))->assertOk();

    expect($user->fresh()->telegram_chat_id)->toBeNull();
});

it('ignores calls without the secret', function (string $secret, ?string $header) {
    Http::fake();
    $user = User::factory()->create(['telegram_link_token' => 'abc', 'telegram_link_expires_at' => now()->addMinute()]);

    postHook(telegramUpdate(1, '/start abc'), $secret, $header)->assertNotFound();

    expect($user->fresh()->telegram_chat_id)->toBeNull();
    Http::assertNothingSent();
})->with(['wrong path' => ['nope', 'hook-secret'], 'no header' => ['hook-secret', null], 'wrong header' => ['hook-secret', 'nope']]);

it('sends alerts to a linked chat with a link to the region', function () {
    Mail::fake();
    $region = Region::factory()->create(['slug' => 'az-sabirabad', 'name_en' => 'Sabirabad', 'name_az' => 'Sabirabad rayonu']);
    Http::fake([
        ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'extreme')),
        'api.telegram.org/*' => Http::response(['ok' => true, 'result' => []]),
    ]);
    $user = User::factory()->create(['locale' => 'en', 'telegram_chat_id' => 555]);
    Subscription::factory()->for($user)->create(['region_id' => $region->id, 'channels' => ['telegram']]);

    app(RiskEvaluator::class)->evaluate();

    expect(NotificationLog::sole()->status)->toBe(NotificationLog::SENT);
    Http::assertSent(fn (Request $r) => str_contains($r->url(), 'api.telegram.org') && $r['chat_id'] === 555
        && str_contains($r['text'], 'Sabirabad: extreme')
        && $r['reply_markup']['inline_keyboard'][0][0]['url'] === 'http://localhost:3000/en/region/az-sabirabad');
});

it('marks Telegram unavailable for users who never linked it', function () {
    Mail::fake();
    $region = Region::factory()->create(['slug' => 'az-sabirabad']);
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'extreme'))]);
    Subscription::factory()->for(User::factory())->create(['region_id' => $region->id, 'channels' => ['telegram']]);

    app(RiskEvaluator::class)->evaluate();

    expect(NotificationLog::sole()->status)->toBe(NotificationLog::NOT_AVAILABLE);
});
