<?php

use Illuminate\Support\Facades\Http;

beforeEach(function () {
    Http::fake([ml('/*') => Http::response(['ok' => true])]);
    config(['odlar.frontend_token' => 'site-secret']);
});

it('gives the website server its own large allowance', function () {
    $this->getJson('/api/v1/overview', ['X-Frontend-Token' => 'site-secret'])
        ->assertOk()->assertHeader('X-RateLimit-Limit', 3000);
});

it('limits everyone else per address, a wrong token included', function (array $headers) {
    $this->getJson('/api/v1/overview', $headers)->assertOk()->assertHeader('X-RateLimit-Limit', 240);
})->with(['no token' => [[]], 'wrong token' => [['X-Frontend-Token' => 'guess']]]);

it('has no frontend allowance when no token is configured', function () {
    config(['odlar.frontend_token' => null]);

    $this->getJson('/api/v1/overview', ['X-Frontend-Token' => ''])->assertHeader('X-RateLimit-Limit', 240);
});
