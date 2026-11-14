<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\MlUnavailableException;
use App\Http\Controllers\Controller;
use App\Services\MlClient;
use Illuminate\Http\JsonResponse;

class StatusController extends Controller
{
    /** Liveness of the gateway plus the ML service's data vintage; never cached, always 200. */
    public function __invoke(MlClient $ml): JsonResponse
    {
        $health = ['status' => 'down', 'data_end' => null, 'source' => null];

        try {
            $response = $ml->get('/health');
            $health = [
                'status' => $response->successful() ? 'ok' : ($response->json('status') ?: 'down'),
                'data_end' => $response->json('data_end'),
                'source' => $response->json('source'),
            ];
        } catch (MlUnavailableException) {
            // keep "down"
        }

        return response()->json([
            'status' => 'ok',
            'version' => config('odlar.version'),
            'ml' => $health,
        ])->header('Cache-Control', 'no-store');
    }
}
