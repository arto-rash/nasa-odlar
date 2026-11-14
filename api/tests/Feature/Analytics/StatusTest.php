<?php

use Illuminate\Support\Facades\Http;

it('reports ok with the ML data vintage', function () {
    Http::fake([ml('/health') => Http::response(['status' => 'ok', 'data_end' => '2026-10-20', 'source' => 'FIRMS'])]);

    $this->getJson('/api/v1/status')
        ->assertOk()
        ->assertExactJson([
            'status' => 'ok',
            'version' => config('odlar.version'),
            'ml' => ['status' => 'ok', 'data_end' => '2026-10-20', 'source' => 'FIRMS'],
        ]);
});

it('stays 200 with ml down when the ML service is unreachable', function () {
    Http::fake([ml('/*') => Http::failedConnection()]);

    $this->getJson('/api/v1/status')
        ->assertOk()
        ->assertJsonPath('status', 'ok')
        ->assertJsonPath('ml', ['status' => 'down', 'data_end' => null, 'source' => null]);
});

it('surfaces the ML store status when ML has no data yet', function () {
    Http::fake([ml('/health') => Http::response(['status' => 'no_store'], 503)]);

    $this->getJson('/api/v1/status')->assertOk()->assertJsonPath('ml.status', 'no_store');
});

it('is never cached', function () {
    Http::fake([ml('/health') => Http::response(['status' => 'ok', 'data_end' => '2026-10-20', 'source' => 'x'])]);

    $this->getJson('/api/v1/status')->assertOk()->assertHeader('Cache-Control', 'no-store, private');
    $this->getJson('/api/v1/status')->assertOk();

    Http::assertSentCount(2);
});
