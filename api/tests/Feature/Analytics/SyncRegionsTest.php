<?php

use App\Models\Region;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/** Fakes ML; each successive sync sees the next English name for Sabirabad. */
function fakeRegionsMl(string ...$names): void
{
    $names = $names ?: ['Sabirabad'];
    $square = fn ($x, $y) => ['type' => 'Polygon', 'coordinates' => [[[$x, $y], [$x + 1, $y], [$x + 1, $y + 1], [$x, $y + 1], [$x, $y]]]];
    Http::fake([
        ml('/regions/geojson') => Http::sequence(array_map(fn ($nameEn) => ['type' => 'FeatureCollection', 'features' => [
            ['type' => 'Feature', 'geometry' => $square(44, 38), 'properties' => ['id' => 1, 'slug' => 'az', 'name_en' => 'Azerbaijan', 'name_az' => 'Azərbaycan', 'country' => 'AZ', 'level' => 'country']],
            ['type' => 'Feature', 'geometry' => ['type' => 'MultiPolygon', 'coordinates' => [$square(48, 39)['coordinates']]], 'properties' => ['id' => 31, 'slug' => 'az-sabirabad', 'name_en' => $nameEn, 'name_az' => 'Sabirabad', 'country' => 'AZ', 'level' => 'district']],
        ]], $names)),
        ml('/regions') => Http::response([
            ['id' => 1, 'slug' => 'az', 'parent_id' => null, 'area_km2' => 86600.0, 'lat' => 40.3, 'lon' => 47.7],
            ['id' => 31, 'slug' => 'az-sabirabad', 'parent_id' => 1, 'area_km2' => 1470.2, 'lat' => 39.98, 'lon' => 48.47],
        ]),
    ]);
}

it('upserts regions with PostGIS multipolygons', function () {
    fakeRegionsMl();

    $this->artisan('odlar:sync-regions')->expectsOutput('Synced 2 regions.')->assertSuccessful();

    expect(Region::count())->toBe(2);
    $sab = Region::find(31);
    expect($sab->only(['slug', 'level', 'parent_id', 'area_km2', 'lat', 'lon']))->toBe([
        'slug' => 'az-sabirabad', 'level' => 'district', 'parent_id' => 1, 'area_km2' => 1470.2, 'lat' => 39.98, 'lon' => 48.47,
    ]);
    expect(DB::scalar('SELECT GeometryType(geom) FROM regions WHERE id = 1'))->toBe('MULTIPOLYGON')
        ->and(DB::scalar('SELECT ST_SRID(geom) FROM regions WHERE id = 31'))->toBe(4326);

    $this->getJson('/api/v1/regions/locate?lat=39.5&lon=48.5')->assertOk()->assertJsonPath('region.id', 31);
});

it('is idempotent and updates changed fields', function () {
    fakeRegionsMl('Sabirabad', 'Sabirabad District');

    $this->artisan('odlar:sync-regions')->assertSuccessful();
    $this->artisan('odlar:sync-regions')->assertSuccessful();

    expect(Region::count())->toBe(2)->and(Region::find(31)->name_en)->toBe('Sabirabad District');
});

it('fails cleanly when ML is unavailable', function () {
    Http::fake([ml('/*') => Http::failedConnection()]);

    $this->artisan('odlar:sync-regions')->assertFailed();
    expect(Region::count())->toBe(0);
});
