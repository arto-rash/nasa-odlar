<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/** A region mirrored from the ML service; `geom` is a PostGIS MultiPolygon (SRID 4326). */
class Region extends Model
{
    use HasFactory;

    public $incrementing = false;

    protected $keyType = 'int';

    protected $guarded = [];

    protected $hidden = ['geom'];

    protected function casts(): array
    {
        return [
            'area_km2' => 'float',
            'lat' => 'float',
            'lon' => 'float',
        ];
    }

    /** Smallest non-country region containing the point, or null. */
    public static function locate(float $lat, float $lon): ?self
    {
        return static::query()
            ->select(['id', 'slug', 'name_en', 'name_az', 'country', 'level', 'parent_id', 'area_km2', 'lat', 'lon'])
            ->where('level', '!=', 'country')
            ->whereRaw('ST_Contains(geom, ST_SetSRID(ST_MakePoint(?, ?), 4326))', [$lon, $lat])
            ->orderBy('area_km2')
            ->first();
    }
}
