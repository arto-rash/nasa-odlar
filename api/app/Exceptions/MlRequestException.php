<?php

namespace App\Exceptions;

use Illuminate\Http\Client\Response;
use Illuminate\Http\JsonResponse;
use RuntimeException;

/** The analytics service rejected the request (404 unknown region, 422 bad parameters). */
class MlRequestException extends RuntimeException
{
    public function __construct(public readonly int $status, string $detail, public readonly mixed $errors = null)
    {
        parent::__construct($detail, $status);
    }

    /** 404/422 are passed through; anything else means the service is unhealthy. */
    public static function fromResponse(Response $response): MlRequestException|MlUnavailableException
    {
        if (! in_array($response->status(), [404, 422], true)) {
            return new MlUnavailableException("ML responded {$response->status()}");
        }

        $detail = $response->json('detail');

        // FastAPI's own validation errors are a list of objects, not a string.
        return is_string($detail)
            ? new self($response->status(), $detail)
            : new self($response->status(), $response->status() === 404 ? 'Not found' : 'Invalid request', $detail);
    }

    public function render(): JsonResponse
    {
        $body = ['message' => $this->getMessage()];
        if ($this->errors !== null) {
            $body['errors'] = $this->errors;
        }

        return response()->json($body, $this->status);
    }
}
