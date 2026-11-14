<?php

use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

it('streams the ML export with its headers', function () {
    $csv = "# ODLAR weekly export\nweek,modis\n2020-01-06,3\n";
    Http::fake([ml('/export/*') => Http::response($csv, 200, [
        'Content-Type' => 'text/csv; charset=utf-8',
        'Content-Disposition' => 'attachment; filename="odlar_az-qabala_weekly.csv"',
    ])]);

    $response = $this->get('/api/v1/export/az-qabala?kind=weekly&format=csv&start=2020-01-01');

    $response->assertOk()
        ->assertHeader('Content-Type', 'text/csv; charset=utf-8')
        ->assertHeader('Content-Disposition', 'attachment; filename="odlar_az-qabala_weekly.csv"');
    expect($response->streamedContent())->toBe($csv);

    Http::assertSent(fn (Request $r) => $r->url() === ml('/export/az-qabala?format=csv&kind=weekly&start=2020-01-01'));
});

it('is not cached', function () {
    Http::fake([ml('/export/*') => Http::response('[]', 200, ['Content-Type' => 'application/json'])]);

    $this->get('/api/v1/export/az-qabala?format=json')->assertOk();
    $this->get('/api/v1/export/az-qabala?format=json')->assertOk();

    Http::assertSentCount(2);
});

it('validates kind and format', function () {
    $this->getJson('/api/v1/export/az-qabala?kind=daily')->assertJsonValidationErrors('kind');
    $this->getJson('/api/v1/export/az-qabala?format=xlsx')->assertJsonValidationErrors('format');
});

it('passes ML errors through', function () {
    Http::fake([ml('/export/*') => Http::response(['detail' => 'geojson export is only available for hotspots'], 422)]);

    $this->getJson('/api/v1/export/az-qabala?kind=weekly&format=geojson')
        ->assertUnprocessable()
        ->assertExactJson(['message' => 'geojson export is only available for hotspots']);
});

it('has a stricter rate limit of 20 per minute', function () {
    Http::fake([ml('/export/*') => Http::response('x', 200, ['Content-Type' => 'text/csv'])]);

    foreach (range(1, 20) as $_) {
        $this->get('/api/v1/export/az-qabala')->assertOk();
    }
    $this->getJson('/api/v1/export/az-qabala')->assertStatus(429);
});

it('exposes Content-Disposition to browsers via CORS', function () {
    Http::fake([ml('/export/*') => Http::response('x', 200, ['Content-Disposition' => 'attachment; filename="a.csv"'])]);

    $this->get('/api/v1/export/az-qabala', ['Origin' => 'http://localhost:3000'])
        ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:3000')
        ->assertHeader('Access-Control-Expose-Headers', 'Content-Disposition');
});
