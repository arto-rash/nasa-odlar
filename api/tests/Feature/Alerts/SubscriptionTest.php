<?php

use App\Models\Region;
use App\Models\Subscription;
use App\Models\User;

beforeEach(function () {
    $this->region = Region::factory()->create(['id' => 31, 'slug' => 'az-sabirabad', 'name_en' => 'Sabirabad', 'name_az' => 'Sabirabad']);
});

it('requires authentication', function (string $method, string $uri) {
    $this->json($method, $uri)->assertUnauthorized();
})->with([
    ['GET', '/api/v1/subscriptions'],
    ['POST', '/api/v1/subscriptions'],
    ['PATCH', '/api/v1/subscriptions/1'],
    ['DELETE', '/api/v1/subscriptions/1'],
]);

it('lists only my subscriptions with region info', function () {
    $me = actingAsUser();
    Subscription::factory()->for($me)->create(['region_id' => $this->region->id]);
    Subscription::factory()->count(2)->create();

    $this->getJson('/api/v1/subscriptions')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.region', [
            'id' => 31, 'slug' => 'az-sabirabad', 'name_en' => 'Sabirabad', 'name_az' => 'Sabirabad', 'country' => 'AZ', 'level' => 'district',
        ])
        ->assertJsonStructure(['data' => [['id', 'region', 'threshold', 'channels', 'active', 'created_at', 'updated_at']]]);
});

it('creates a subscription with defaults', function () {
    $me = actingAsUser();

    $this->postJson('/api/v1/subscriptions', ['region_slug' => 'az-sabirabad'])
        ->assertCreated()
        ->assertJsonPath('region.slug', 'az-sabirabad')
        ->assertJsonPath('threshold', 'high')
        ->assertJsonPath('channels', ['in_app', 'email'])
        ->assertJsonPath('active', true);

    expect($me->subscriptions()->count())->toBe(1);
});

it('creates a subscription with a custom threshold and channels', function () {
    actingAsUser();

    $this->postJson('/api/v1/subscriptions', ['region_slug' => 'az-sabirabad', 'threshold' => 'extreme', 'channels' => ['sms', 'push']])
        ->assertCreated()
        ->assertJsonPath('threshold', 'extreme')
        ->assertJsonPath('channels', ['sms', 'push']);
});

it('rejects an unknown region', function () {
    actingAsUser();

    $this->postJson('/api/v1/subscriptions', ['region_slug' => 'az-atlantis'])->assertJsonValidationErrors('region_slug');
});

it('rejects invalid thresholds and channels', function (array $body, string $field) {
    actingAsUser();

    $this->postJson('/api/v1/subscriptions', ['region_slug' => 'az-sabirabad', ...$body])->assertJsonValidationErrors($field);
})->with([
    'low threshold' => [['threshold' => 'low'], 'threshold'],
    'unknown threshold' => [['threshold' => 'apocalyptic'], 'threshold'],
    'unknown channel' => [['channels' => ['email', 'telegram']], 'channels.1'],
    'duplicate channel' => [['channels' => ['email', 'email']], 'channels.0'],
    'empty channels' => [['channels' => []], 'channels'],
    'channels not array' => [['channels' => 'email'], 'channels'],
]);

it('rejects a second subscription to the same region', function () {
    $me = actingAsUser();
    Subscription::factory()->for($me)->create(['region_id' => $this->region->id]);

    $this->postJson('/api/v1/subscriptions', ['region_slug' => 'az-sabirabad'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['region_slug' => 'You are already subscribed to this region.']);
});

it('lets different users subscribe to the same region', function () {
    Subscription::factory()->create(['region_id' => $this->region->id]);
    actingAsUser();

    $this->postJson('/api/v1/subscriptions', ['region_slug' => 'az-sabirabad'])->assertCreated();
});

it('shows my subscription', function () {
    $me = actingAsUser();
    $sub = Subscription::factory()->for($me)->create(['region_id' => $this->region->id]);

    $this->getJson("/api/v1/subscriptions/{$sub->id}")->assertOk()->assertJsonPath('id', $sub->id);
});

it('updates threshold, channels and active', function () {
    $me = actingAsUser();
    $sub = Subscription::factory()->for($me)->create(['region_id' => $this->region->id]);

    $this->patchJson("/api/v1/subscriptions/{$sub->id}", ['threshold' => 'moderate', 'channels' => ['in_app'], 'active' => false])
        ->assertOk()
        ->assertJsonPath('threshold', 'moderate')
        ->assertJsonPath('channels', ['in_app'])
        ->assertJsonPath('active', false);

    expect($sub->refresh()->active)->toBeFalse();
});

it('validates updates', function () {
    $me = actingAsUser();
    $sub = Subscription::factory()->for($me)->create(['region_id' => $this->region->id]);

    $this->patchJson("/api/v1/subscriptions/{$sub->id}", ['threshold' => 'low', 'channels' => ['fax'], 'active' => 'maybe'])
        ->assertJsonValidationErrors(['threshold', 'channels.0', 'active']);
});

it('deletes my subscription', function () {
    $me = actingAsUser();
    $sub = Subscription::factory()->for($me)->create(['region_id' => $this->region->id]);

    $this->deleteJson("/api/v1/subscriptions/{$sub->id}")->assertNoContent();

    expect(Subscription::find($sub->id))->toBeNull();
});

it("hides other users' subscriptions behind a 404", function (string $method) {
    $theirs = Subscription::factory()->for(User::factory())->create(['region_id' => $this->region->id]);
    actingAsUser();

    $this->json($method, "/api/v1/subscriptions/{$theirs->id}", ['threshold' => 'extreme'])
        ->assertNotFound()
        ->assertExactJson(['message' => 'Not Found']);

    expect($theirs->refresh()->threshold->value)->toBe('high');
})->with(['GET', 'PATCH', 'DELETE']);

it("returns 404 for another user's subscription even with an invalid body", function () {
    $theirs = Subscription::factory()->create();
    actingAsUser();

    $this->patchJson("/api/v1/subscriptions/{$theirs->id}", ['threshold' => 'nope'])->assertNotFound();
});

it('returns 404 for a missing subscription', function () {
    actingAsUser();

    $this->getJson('/api/v1/subscriptions/999999')->assertNotFound()->assertExactJson(['message' => 'Not Found']);
});

it('returns 404 for non-numeric ids', function () {
    actingAsUser();

    $this->getJson('/api/v1/subscriptions/abc')->assertNotFound();
    $this->postJson('/api/v1/alerts/abc/read')->assertNotFound();
});
