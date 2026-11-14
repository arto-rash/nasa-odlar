<?php

use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

dataset('proxied routes', [
    'overview' => ['/api/v1/overview', '/overview'],
    'regions' => ['/api/v1/regions', '/regions'],
    'regions geojson' => ['/api/v1/regions/geojson', '/regions/geojson'],
    'region detail' => ['/api/v1/regions/az-sabirabad', '/regions/az-sabirabad'],
    'weekly series' => ['/api/v1/regions/az-sabirabad/series/weekly', '/series/az-sabirabad/weekly'],
    'annual series' => ['/api/v1/regions/az-sabirabad/series/annual', '/series/az-sabirabad/annual'],
    'calendar' => ['/api/v1/regions/az-sabirabad/calendar', '/calendar/az-sabirabad'],
    'region risk' => ['/api/v1/regions/az-sabirabad/risk', '/risk/az-sabirabad'],
    'region forecast' => ['/api/v1/regions/az-sabirabad/forecast', '/forecast/az-sabirabad'],
    'risk map' => ['/api/v1/risk', '/risk'],
    'timeline' => ['/api/v1/timeline', '/timeline'],
    'grid' => ['/api/v1/grid', '/grid'],
    'harmonization skill' => ['/api/v1/harmonization/skill', '/harmonization/skill'],
    'model report' => ['/api/v1/model/report', '/model/report'],
]);

it('proxies to the right ML path and returns its JSON', function (string $uri, string $mlPath) {
    Http::fake([ml($mlPath) => Http::response(['ok' => true, 'path' => $mlPath])]);

    $this->getJson($uri)
        ->assertOk()
        ->assertHeader('Content-Type', 'application/json')
        ->assertExactJson(['ok' => true, 'path' => $mlPath]);

    Http::assertSent(fn (Request $r) => $r->method() === 'GET' && $r->url() === ml($mlPath));
})->with('proxied routes');

it('serves the second identical call from cache', function (string $uri, string $mlPath) {
    Http::fake([ml($mlPath) => Http::response(['n' => 1])]);

    $this->getJson($uri)->assertOk()->assertHeader('X-Cache', 'MISS');
    $this->getJson($uri)->assertOk()->assertHeader('X-Cache', 'HIT')->assertExactJson(['n' => 1]);

    Http::assertSentCount(1);
})->with('proxied routes');

it('sends the internal token header', function () {
    Http::fake([ml('/overview') => Http::response([])]);

    $this->getJson('/api/v1/overview')->assertOk();

    Http::assertSent(fn (Request $r) => $r->hasHeader('X-Internal-Token', 'test-internal-token'));
});

it('omits the internal token header when none is configured', function () {
    config(['odlar.ml.token' => null]);
    Http::fake([ml('/overview') => Http::response([])]);

    $this->getJson('/api/v1/overview')->assertOk();

    Http::assertSent(fn (Request $r) => ! $r->hasHeader('X-Internal-Token'));
});

it('keys the cache by query string', function () {
    Http::fake([ml('/grid*') => Http::response(['cells' => []])]);

    $this->getJson('/api/v1/grid?year=2020')->assertOk();
    $this->getJson('/api/v1/grid?year=2021')->assertOk();
    $this->getJson('/api/v1/grid?year=2020')->assertOk()->assertHeader('X-Cache', 'HIT');

    Http::assertSentCount(2);
});

it('passes ML 404 through with its detail', function () {
    Http::fake([ml('/regions/nowhere') => Http::response(['detail' => "region 'nowhere' not found"], 404)]);

    $this->getJson('/api/v1/regions/nowhere')
        ->assertNotFound()
        ->assertExactJson(['message' => "region 'nowhere' not found"]);
});

it('passes ML 422 through with its detail', function () {
    Http::fake([ml('/calendar/*') => Http::response(['detail' => 'bad input'], 422)]);

    $this->getJson('/api/v1/regions/az-x/calendar')->assertUnprocessable()->assertExactJson(['message' => 'bad input']);
});

it('keeps FastAPI validation error lists as errors', function () {
    $detail = [['loc' => ['query', 'year'], 'msg' => 'bad', 'type' => 'int_parsing']];
    Http::fake([ml('/grid') => Http::response(['detail' => $detail], 422)]);

    $this->getJson('/api/v1/grid')->assertUnprocessable()->assertJsonPath('errors', $detail);
});

it('does not cache error responses', function () {
    Http::fake([ml('/regions/az-x') => Http::sequence()
        ->push(['detail' => 'not found'], 404)
        ->push(['slug' => 'az-x'], 200)]);

    $this->getJson('/api/v1/regions/az-x')->assertNotFound();
    $this->getJson('/api/v1/regions/az-x')->assertOk()->assertJsonPath('slug', 'az-x');
});

it('returns 503 when the ML service is unreachable', function () {
    Http::fake([ml('/*') => Http::failedConnection()]);

    $this->getJson('/api/v1/overview')
        ->assertStatus(503)
        ->assertExactJson(['message' => 'Analytics service unavailable']);
});

it('retries connection failures before giving up', function () {
    Http::fake([ml('/*') => Http::failedConnection()]);

    $this->getJson('/api/v1/risk')->assertStatus(503);

    Http::assertSentCount(config('odlar.ml.retries') + 1);
});

it('returns 503 on ML server errors and other statuses', function (int $status) {
    Http::fake([ml('/risk') => Http::response(['detail' => 'boom'], $status)]);

    $this->getJson('/api/v1/risk')->assertStatus(503)->assertJsonPath('message', 'Analytics service unavailable');
})->with([500, 503, 401]);

it('rejects malformed region slugs without calling ML', function () {
    Http::fake();

    $this->getJson('/api/v1/regions/Bad_Slug!')->assertNotFound()->assertExactJson(['message' => 'Not Found']);

    Http::assertNothingSent();
});

describe('query forwarding and validation', function () {
    it('forwards weekly start/end', function () {
        Http::fake([ml('/series/*') => Http::response([])]);

        $this->getJson('/api/v1/regions/az-qabala/series/weekly?start=2020-01-01&end=2020-12-31&junk=1')->assertOk();

        Http::assertSent(fn (Request $r) => $r->url() === ml('/series/az-qabala/weekly?end=2020-12-31&start=2020-01-01'));
    });

    it('validates weekly dates', function () {
        Http::fake();

        $this->getJson('/api/v1/regions/az-qabala/series/weekly?start=2020-13-01')->assertJsonValidationErrors('start');
        $this->getJson('/api/v1/regions/az-qabala/series/weekly?start=2021-01-01&end=2020-01-01')->assertJsonValidationErrors('end');

        Http::assertNothingSent();
    });

    it('forwards hotspots params', function () {
        Http::fake([ml('/hotspots*') => Http::response(['total' => 0, 'points' => []])]);

        $this->getJson('/api/v1/hotspots?start=2025-07-01&end=2025-08-15&sensor=VIIRS&region=az-qabala&limit=500')->assertOk();

        Http::assertSent(fn (Request $r) => $r->url()
            === ml('/hotspots?end=2025-08-15&limit=500&region=az-qabala&sensor=VIIRS&start=2025-07-01'));
    });

    it('requires hotspots dates', function () {
        $this->getJson('/api/v1/hotspots')->assertUnprocessable()->assertJsonValidationErrors(['start', 'end']);
    });

    it('limits the hotspots range to 92 days', function () {
        Http::fake([ml('/hotspots*') => Http::response([])]);

        $this->getJson('/api/v1/hotspots?start=2025-01-01&end=2025-04-03')->assertOk();
        $this->getJson('/api/v1/hotspots?start=2025-01-01&end=2025-04-04')
            ->assertUnprocessable()
            ->assertJsonPath('errors.end.0', 'The date range may not exceed 92 days.');
    });

    it('validates hotspots sensor, limit and order', function (string $query, string $field) {
        $this->getJson('/api/v1/hotspots?'.$query)->assertJsonValidationErrors($field);
    })->with([
        ['start=2025-01-01&end=2025-01-10&sensor=GOES', 'sensor'],
        ['start=2025-01-01&end=2025-01-10&limit=0', 'limit'],
        ['start=2025-01-01&end=2025-01-10&limit=60000', 'limit'],
        ['start=2025-02-01&end=2025-01-10', 'end'],
        ['start=2025-01-01&end=2025-01-10&region=../etc', 'region'],
    ]);

    it('validates grid params', function () {
        $this->getJson('/api/v1/grid?year=abc')->assertJsonValidationErrors('year');
        $this->getJson('/api/v1/grid?sensor=GOES')->assertJsonValidationErrors('sensor');
    });

    it('forwards grid and skill params', function () {
        Http::fake([ml('/*') => Http::response([])]);

        $this->getJson('/api/v1/grid?year=2024&sensor=MODIS')->assertOk();
        $this->getJson('/api/v1/harmonization/skill?region=az-qabala')->assertOk();

        Http::assertSent(fn (Request $r) => $r->url() === ml('/grid?sensor=MODIS&year=2024'));
        Http::assertSent(fn (Request $r) => $r->url() === ml('/harmonization/skill?region=az-qabala'));
    });
});

it('proxies a forecast week for the map with its view', function () {
    Http::fake([ml('/forecast/map').'*' => Http::response(['week' => '2026-11-16', 'values' => []])]);

    $this->getJson('/api/v1/forecast/map?week=2026-11-16&bbox=44,38,51,42')
        ->assertOk()
        ->assertJsonPath('week', '2026-11-16');

    Http::assertSent(fn (Request $r) => str_starts_with($r->url(), ml('/forecast/map'))
        && $r['week'] === '2026-11-16' && $r['bbox'] === '44,38,51,42');
});

it('validates the forecast week', function (string $query) {
    Http::fake();

    $this->getJson('/api/v1/forecast/map'.$query)->assertUnprocessable();

    Http::assertNothingSent();
})->with(['missing' => [''], 'not a date' => ['?week=soon'], 'bad bbox' => ['?week=2026-11-16&bbox=1,2']]);
