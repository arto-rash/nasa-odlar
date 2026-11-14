<?php

use App\Models\Alert;
use App\Models\Region;
use App\Models\Subscription;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;

beforeEach(function () {
    $this->me = actingAsUser(['locale' => 'en']);
    $this->region = Region::factory()->create(['slug' => 'az-sabirabad', 'name_en' => 'Sabirabad', 'name_az' => 'Sabirabad']);
    $this->sub = Subscription::factory()->for($this->me)->create(['region_id' => $this->region->id]);
});

function alertFor(Subscription $sub, array $attrs = []): Alert
{
    $alert = Alert::factory()->create(['subscription_id' => $sub->id, ...$attrs]);
    $alert->notificationLogs()->createMany([
        ['channel' => 'in_app', 'status' => 'delivered'],
        ['channel' => 'email', 'status' => 'sent'],
    ]);

    return $alert;
}

it('requires authentication', function (string $method, string $uri) {
    $this->app['auth']->forgetGuards();
    $this->withHeader('Authorization', '')->json($method, $uri)->assertUnauthorized();
})->with([
    ['GET', '/api/v1/alerts'],
    ['GET', '/api/v1/alerts/unread-count'],
    ['POST', '/api/v1/alerts/1/read'],
    ['POST', '/api/v1/alerts/read-all'],
    ['POST', '/api/v1/alerts/evaluate'],
]);

it('lists my alerts newest first in the documented shape', function () {
    $old = alertFor($this->sub, ['as_of' => '2026-10-01', 'created_at' => now()->subDay()]);
    $new = alertFor($this->sub, ['as_of' => '2026-10-02', 'level' => 'extreme', 'probability' => 0.9]);
    alertFor(Subscription::factory()->create());

    $this->getJson('/api/v1/alerts')
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $new->id)
        ->assertJsonPath('data.1.id', $old->id)
        ->assertJsonPath('data.0', [
            'id' => $new->id,
            'region' => ['slug' => 'az-sabirabad', 'name_en' => 'Sabirabad', 'name_az' => 'Sabirabad'],
            'level' => 'extreme',
            'probability' => 0.9,
            'threshold' => 'high',
            'as_of' => '2026-10-02',
            'drivers' => [['code' => 'dry', 'value' => 1.2]],
            'read_at' => null,
            'created_at' => $new->created_at->toIso8601String(),
            'channels' => [['channel' => 'in_app', 'status' => 'delivered'], ['channel' => 'email', 'status' => 'sent']],
        ])
        ->assertJsonStructure(['data', 'links', 'meta' => ['current_page', 'per_page', 'total', 'last_page']]);
});

it('paginates 15 per page', function () {
    foreach (range(1, 17) as $i) {
        Alert::factory()->create(['subscription_id' => $this->sub->id]);
    }

    $this->getJson('/api/v1/alerts')->assertJsonCount(15, 'data')->assertJsonPath('meta.total', 17);
    $this->getJson('/api/v1/alerts?page=2')->assertJsonCount(2, 'data');
});

it('filters unread alerts', function () {
    $unread = alertFor($this->sub);
    alertFor($this->sub, ['read_at' => now()]);

    $this->getJson('/api/v1/alerts?unread=1')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $unread->id);
    $this->getJson('/api/v1/alerts')->assertJsonCount(2, 'data');
});

it('counts unread alerts', function () {
    alertFor($this->sub);
    alertFor($this->sub);
    alertFor($this->sub, ['read_at' => now()]);
    alertFor(Subscription::factory()->create());

    $this->getJson('/api/v1/alerts/unread-count')->assertOk()->assertExactJson(['count' => 2]);
});

it('marks an alert as read', function () {
    $alert = alertFor($this->sub);

    $this->postJson("/api/v1/alerts/{$alert->id}/read")->assertOk()->assertJsonPath('id', $alert->id);

    expect($alert->refresh()->read_at)->not->toBeNull();
    $this->getJson('/api/v1/alerts/unread-count')->assertExactJson(['count' => 0]);
});

it('keeps the original read_at when read twice', function () {
    $alert = alertFor($this->sub, ['read_at' => now()->subHour()]);
    $readAt = $alert->read_at->toIso8601String();

    $this->postJson("/api/v1/alerts/{$alert->id}/read")->assertOk()->assertJsonPath('read_at', $readAt);
});

it("cannot mark another user's alert as read", function () {
    $theirs = alertFor(Subscription::factory()->for(User::factory())->create());

    $this->postJson("/api/v1/alerts/{$theirs->id}/read")->assertNotFound();

    expect($theirs->refresh()->read_at)->toBeNull();
});

it('marks all my alerts as read', function () {
    alertFor($this->sub);
    alertFor($this->sub);
    $theirs = alertFor(Subscription::factory()->create());

    $this->postJson('/api/v1/alerts/read-all')->assertOk()->assertExactJson(['updated' => 2]);

    expect($this->me->alerts()->whereNull('read_at')->count())->toBe(0)
        ->and($theirs->refresh()->read_at)->toBeNull();
});

it("evaluates only the current user's subscriptions", function () {
    Mail::fake();
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'extreme', '2026-10-22', 0.88))]);
    $someoneElse = Subscription::factory()->create(['region_id' => $this->region->id]);

    $this->postJson('/api/v1/alerts/evaluate')
        ->assertOk()
        ->assertJsonPath('checked', 1)
        ->assertJsonCount(1, 'created')
        ->assertJsonPath('created.0.level', 'extreme')
        ->assertJsonPath('created.0.as_of', '2026-10-22')
        ->assertJsonPath('created.0.channels', [['channel' => 'in_app', 'status' => 'delivered'], ['channel' => 'email', 'status' => 'sent']]);

    expect($someoneElse->alerts()->count())->toBe(0);
    $this->postJson('/api/v1/alerts/evaluate')->assertOk()->assertJsonPath('created', []);
});

it('rate limits evaluate to 10 per minute', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'low'))]);

    foreach (range(1, 10) as $_) {
        $this->postJson('/api/v1/alerts/evaluate')->assertOk();
    }
    $this->postJson('/api/v1/alerts/evaluate')->assertStatus(429);
});
