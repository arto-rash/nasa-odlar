<?php

use App\Models\Region;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    // Country covering everything, a district inside it.
    regionWithSquare(['id' => 1, 'slug' => 'az', 'name_en' => 'Azerbaijan', 'name_az' => 'Azərbaycan', 'level' => 'country', 'area_km2' => 86600], 44, 38, 51, 42);
    regionWithSquare(['id' => 31, 'slug' => 'az-sabirabad', 'name_en' => 'Sabirabad', 'name_az' => 'Sabirabad', 'level' => 'district', 'parent_id' => 1, 'area_km2' => 1470], 48.2, 39.8, 48.8, 40.2);
});

it('finds the district containing the point', function () {
    Http::fake();

    $this->getJson('/api/v1/regions/locate?lat=40.0&lon=48.5')
        ->assertOk()
        ->assertExactJson(['region' => [
            'id' => 31, 'slug' => 'az-sabirabad', 'name_en' => 'Sabirabad', 'name_az' => 'Sabirabad',
            'country' => 'AZ', 'level' => 'district',
        ]]);

    Http::assertNothingSent();
});

it('ignores country-level regions', function () {
    // Inside the country square but outside every district.
    $this->getJson('/api/v1/regions/locate?lat=41.5&lon=45')->assertNotFound()->assertJsonPath('message', 'No region contains this point');
});

it('returns 404 outside all regions', function () {
    $this->getJson('/api/v1/regions/locate?lat=10&lon=10')->assertNotFound();
});

it('prefers the smallest containing leaf region', function () {
    regionWithSquare(['id' => 99, 'slug' => 'az-tiny', 'level' => 'district', 'area_km2' => 5], 48.4, 39.9, 48.6, 40.1);

    $this->getJson('/api/v1/regions/locate?lat=40.0&lon=48.5')->assertOk()->assertJsonPath('region.slug', 'az-tiny');
});

it('does not expose the geometry', function () {
    expect(Region::find(31)->toArray())->not->toHaveKey('geom');
});

it('validates lat/lon', function (string $query, array $errors) {
    $this->getJson('/api/v1/regions/locate?'.$query)->assertUnprocessable()->assertJsonValidationErrors($errors);
})->with([
    'missing' => ['', ['lat', 'lon']],
    'lat too big' => ['lat=91&lon=48', ['lat']],
    'lat too small' => ['lat=-90.5&lon=48', ['lat']],
    'lon too big' => ['lat=40&lon=180.1', ['lon']],
    'not numeric' => ['lat=north&lon=east', ['lat', 'lon']],
]);
