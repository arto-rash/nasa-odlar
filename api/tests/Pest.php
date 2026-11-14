<?php

use App\Models\Region;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature', 'Unit');

/** Absolute ML URL as configured for tests. */
function ml(string $path = ''): string
{
    return 'http://ml.test'.$path;
}

function actingAsUser(array $attributes = []): User
{
    $user = User::factory()->create($attributes);
    Sanctum::actingAs($user);

    return $user;
}

/** A region with an axis-aligned square geometry [lon1,lat1]-[lon2,lat2]. */
function regionWithSquare(array $attributes, float $lon1, float $lat1, float $lon2, float $lat2): Region
{
    $region = Region::factory()->create($attributes);
    $geojson = json_encode(['type' => 'Polygon', 'coordinates' => [[
        [$lon1, $lat1], [$lon2, $lat1], [$lon2, $lat2], [$lon1, $lat2], [$lon1, $lat1],
    ]]]);
    DB::update('UPDATE regions SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)) WHERE id = ?', [$geojson, $region->id]);

    return $region;
}

/** ML GET /risk/{slug} payload. */
function riskPayload(string $slug, string $level, string $asOf = '2026-10-20', float $probability = 0.5): array
{
    return [
        'region' => ['slug' => $slug],
        'as_of' => $asOf,
        'short' => [
            'probability' => $probability,
            'level' => $level,
            'expected7' => 3.2,
            'drivers' => [['code' => 'dry_spell', 'value' => 12], ['code' => 'heat', 'value' => 2.1]],
        ],
    ];
}
