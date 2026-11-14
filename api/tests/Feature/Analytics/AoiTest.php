<?php

use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

$polygon = ['type' => 'Polygon', 'coordinates' => [[[47, 40], [48, 40], [48, 41], [47, 40]]]];

it('posts the geometry to ML and returns the summary', function () use ($polygon) {
    Http::fake([ml('/aoi/summary') => Http::response(['area_km2' => 123.4, 'detections' => 7])]);

    $this->postJson('/api/v1/aoi/summary', ['geometry' => $polygon])
        ->assertOk()
        ->assertExactJson(['area_km2' => 123.4, 'detections' => 7]);

    Http::assertSent(fn (Request $r) => $r->method() === 'POST'
        && $r->url() === ml('/aoi/summary')
        && $r->data() === ['geometry' => $polygon]);
});

it('is not cached', function () use ($polygon) {
    Http::fake([ml('/aoi/summary') => Http::response(['detections' => 1])]);

    $this->postJson('/api/v1/aoi/summary', ['geometry' => $polygon])->assertOk();
    $this->postJson('/api/v1/aoi/summary', ['geometry' => $polygon])->assertOk();

    Http::assertSentCount(2);
});

it('accepts MultiPolygon', function () use ($polygon) {
    Http::fake([ml('/aoi/summary') => Http::response([])]);

    $this->postJson('/api/v1/aoi/summary', ['geometry' => [
        'type' => 'MultiPolygon', 'coordinates' => [$polygon['coordinates']],
    ]])->assertOk();
});

it('validates the geometry', function (mixed $body, string $field) {
    Http::fake();

    $this->postJson('/api/v1/aoi/summary', $body)->assertUnprocessable()->assertJsonValidationErrors($field);

    Http::assertNothingSent();
})->with([
    'missing' => [[], 'geometry'],
    'string' => [['geometry' => 'POLYGON((0 0,1 1))'], 'geometry'],
    'no type' => [['geometry' => ['coordinates' => [[[0, 0]]]]], 'geometry.type'],
    'point' => [['geometry' => ['type' => 'Point', 'coordinates' => [47, 40]]], 'geometry.type'],
    'no coordinates' => [['geometry' => ['type' => 'Polygon']], 'geometry.coordinates'],
    'scalar coordinates' => [['geometry' => ['type' => 'Polygon', 'coordinates' => 5]], 'geometry.coordinates'],
]);

it('passes ML geometry errors through', function () use ($polygon) {
    Http::fake([ml('/aoi/summary') => Http::response(['detail' => 'area of interest is limited to 60,000 km²'], 422)]);

    $this->postJson('/api/v1/aoi/summary', ['geometry' => $polygon])
        ->assertUnprocessable()
        ->assertJsonPath('message', 'area of interest is limited to 60,000 km²');
});

it('returns 503 when ML is down', function () use ($polygon) {
    Http::fake([ml('/*') => Http::failedConnection()]);

    $this->postJson('/api/v1/aoi/summary', ['geometry' => $polygon])->assertStatus(503);
});
