<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\LocateRequest;
use App\Http\Resources\RegionResource;
use App\Models\Region;
use Illuminate\Http\JsonResponse;

class RegionLocateController extends Controller
{
    /** Which district contains this point (PostGIS point-in-polygon over synced regions). */
    public function __invoke(LocateRequest $request): JsonResponse
    {
        $region = Region::locate((float) $request->validated('lat'), (float) $request->validated('lon'));

        if (! $region) {
            return response()->json(['message' => 'No region contains this point'], 404);
        }

        return response()->json(['region' => new RegionResource($region)]);
    }
}
