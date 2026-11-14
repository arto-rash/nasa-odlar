<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/** The analytics service could not be reached (or answered with an unexpected error). */
class MlUnavailableException extends RuntimeException
{
    public function render(): JsonResponse
    {
        return response()->json(['message' => 'Analytics service unavailable'], 503);
    }
}
