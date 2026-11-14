<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\MlRequestException;
use App\Http\Controllers\Controller;
use App\Http\Requests\AoiSummaryRequest;
use App\Http\Requests\GridRequest;
use App\Http\Requests\HotspotsRequest;
use App\Http\Requests\RegionsGeojsonRequest;
use App\Http\Requests\RegionsRequest;
use App\Http\Requests\RiskRequest;
use App\Http\Requests\SkillRequest;
use App\Http\Requests\WeeklySeriesRequest;
use App\Services\MlClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/** Public read-only analytics, proxied to the ML service with a short cache. */
class AnalyticsController extends Controller
{
    public function __construct(private readonly MlClient $ml) {}

    public function overview(): Response
    {
        return $this->proxy('/overview');
    }

    public function regions(RegionsRequest $request): Response
    {
        return $this->proxy('/regions', $request->forwarded());
    }

    public function regionsGeojson(RegionsGeojsonRequest $request): Response
    {
        return $this->proxy('/regions/geojson', $request->forwarded());
    }

    public function region(string $slug): Response
    {
        return $this->proxy("/regions/{$slug}");
    }

    public function weekly(WeeklySeriesRequest $request, string $slug): Response
    {
        return $this->proxy("/series/{$slug}/weekly", $request->forwarded());
    }

    public function annual(string $slug): Response
    {
        return $this->proxy("/series/{$slug}/annual");
    }

    public function calendar(string $slug): Response
    {
        return $this->proxy("/calendar/{$slug}");
    }

    public function regionRisk(string $slug): Response
    {
        return $this->proxy("/risk/{$slug}");
    }

    public function risk(RiskRequest $request): Response
    {
        return $this->proxy('/risk', $request->forwarded());
    }

    public function hotspots(HotspotsRequest $request): Response
    {
        return $this->proxy('/hotspots', $request->forwarded());
    }

    /** A year of sampled detections; finished years never change, so browsers keep them. */
    public function weekPack(int $year): Response
    {
        return $this->pack("/week-pack/{$year}", $year);
    }

    public function homeWeekPack(int $year): Response
    {
        return $this->pack("/week-pack/home/{$year}", $year);
    }

    private function pack(string $path, int $year): Response
    {
        $result = $this->ml->cachedGet($path);

        return response($result['body'], 200, [
            'Content-Type' => $result['type'],
            'Cache-Control' => $year < (int) date('Y') ? 'public, max-age=2592000, immutable' : 'public, max-age=3600',
            'X-Cache' => $result['hit'] ? 'HIT' : 'MISS',
        ]);
    }

    public function timeline(): Response
    {
        return $this->proxy('/timeline');
    }

    public function grid(GridRequest $request): Response
    {
        return $this->proxy('/grid', $request->forwarded());
    }

    public function skill(SkillRequest $request): Response
    {
        return $this->proxy('/harmonization/skill', $request->forwarded());
    }

    public function modelReport(): Response
    {
        return $this->proxy('/model/report');
    }

    /** Arbitrary polygons: not cached. */
    public function aoiSummary(AoiSummaryRequest $request): JsonResponse
    {
        $response = $this->ml->post('/aoi/summary', ['geometry' => $request->input('geometry')]);

        if (! $response->successful()) {
            throw MlRequestException::fromResponse($response);
        }

        return response()->json($response->json());
    }

    private function proxy(string $path, array $query = []): Response
    {
        $result = $this->ml->cachedGet($path, $query);

        return response($result['body'], 200, [
            'Content-Type' => $result['type'],
            'Cache-Control' => 'public, max-age=300',
            'X-Cache' => $result['hit'] ? 'HIT' : 'MISS',
        ]);
    }
}
