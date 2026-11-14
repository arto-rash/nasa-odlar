<?php

namespace App\Console\Commands;

use App\Exceptions\MlRequestException;
use App\Exceptions\MlUnavailableException;
use App\Services\MlClient;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

#[Signature('odlar:sync-regions')]
#[Description('Upsert region metadata and PostGIS geometries from the ML service')]
class SyncRegions extends Command
{
    private const UPSERT = <<<'SQL'
        INSERT INTO regions (id, slug, name_en, name_az, country, level, parent_id, area_km2, lat, lon, geom, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)), 3)), now(), now())
        ON CONFLICT (id) DO UPDATE SET
            slug = EXCLUDED.slug, name_en = EXCLUDED.name_en, name_az = EXCLUDED.name_az,
            country = EXCLUDED.country, level = EXCLUDED.level, parent_id = EXCLUDED.parent_id,
            area_km2 = EXCLUDED.area_km2, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
            geom = EXCLUDED.geom, updated_at = now()
        SQL;

    public function handle(MlClient $ml): int
    {
        try {
            // The GeoJSON lacks parent/area/centroid; /regions has them.
            $meta = collect($ml->json('/regions'))->keyBy('id');
        } catch (MlUnavailableException|MlRequestException $e) {
            $this->error('ML service unavailable: '.$e->getMessage());

            return self::FAILURE;
        }

        // One country at a time (provinces at ~500 m detail): the whole world in
        // a single response would not fit in PHP's memory.
        $total = 0;
        foreach ($meta->pluck('country')->filter()->unique()->values() as $country) {
            try {
                $geojson = $ml->json('/regions/geojson', ['country' => $country, 'zoom' => 5]);
            } catch (MlUnavailableException|MlRequestException $e) {
                $this->error("ML service unavailable for {$country}: ".$e->getMessage());

                return self::FAILURE;
            }
            $features = $geojson['features'] ?? [];
            DB::transaction(function () use ($features, $meta) {
                foreach ($features as $feature) {
                    $p = $feature['properties'];
                    $m = $meta->get($p['id'], []);
                    // a rebuild can move a slug to another id (a province regained, finer
                    // borders): the old row gives it up, or the unique index would refuse it
                    DB::update("UPDATE regions SET slug = 'old-' || id WHERE slug = ? AND id <> ?", [$p['slug'], $p['id']]);
                    DB::statement(self::UPSERT, [
                        $p['id'], $p['slug'], $p['name_en'], $p['name_az'], $p['country'] ?? null, $p['level'],
                        $m['parent_id'] ?? null, $m['area_km2'] ?? null, $m['lat'] ?? null, $m['lon'] ?? null,
                        json_encode($feature['geometry']),
                    ]);
                }
            });
            $total += count($features);
        }

        // rows left without a slug no longer exist, unless someone subscribed to them
        DB::delete("DELETE FROM regions r WHERE r.slug LIKE 'old-%'
            AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.region_id = r.id)
            AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.region_id = r.id)");

        $this->info("Synced {$total} regions.");

        return self::SUCCESS;
    }
}
