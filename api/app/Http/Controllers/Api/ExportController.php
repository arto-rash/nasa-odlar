<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\MlRequestException;
use App\Http\Controllers\Controller;
use App\Http\Requests\ExportRequest;
use App\Services\MlClient;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ExportController extends Controller
{
    /** Streams the ML export body through unbuffered, keeping its Content-Type/Disposition. */
    public function __invoke(ExportRequest $request, MlClient $ml, string $slug): StreamedResponse
    {
        $query = $request->forwarded();
        ksort($query);
        $response = $ml->get("/export/{$slug}", $query, ['stream' => true]);

        if (! $response->successful()) {
            throw MlRequestException::fromResponse($response);
        }

        $body = $response->toPsrResponse()->getBody();

        return response()->stream(function () use ($body) {
            while (! $body->eof()) {
                echo $body->read(65536);
                flush();
            }
        }, 200, array_filter([
            'Content-Type' => $response->header('Content-Type') ?: 'application/octet-stream',
            'Content-Disposition' => $response->header('Content-Disposition') ?: null,
            'Cache-Control' => 'no-store',
            'X-Accel-Buffering' => 'no',
        ]));
    }
}
