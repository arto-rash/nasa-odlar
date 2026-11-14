<?php

namespace App\Services;

use App\Exceptions\MlRequestException;
use App\Exceptions\MlUnavailableException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

/** Thin HTTP client for the internal FastAPI analytics service. */
class MlClient
{
    public function request(): PendingRequest
    {
        $cfg = config('odlar.ml');

        $request = Http::baseUrl($cfg['url'])
            ->acceptJson()
            ->timeout($cfg['timeout'])
            ->retry(
                max(1, $cfg['retries'] + 1),
                $cfg['retry_sleep_ms'],
                // Only retry transport failures and 5xx; a 404/422 will not change.
                fn (Throwable $e) => $e instanceof ConnectionException
                    || ($e instanceof RequestException && $e->response->serverError()),
                throw: false,
            );

        return filled($cfg['token']) ? $request->withHeaders(['X-Internal-Token' => $cfg['token']]) : $request;
    }

    /** @throws MlUnavailableException */
    public function get(string $path, array $query = [], array $options = []): Response
    {
        return $this->send(fn () => $this->request()->withOptions($options)->get($path, $query));
    }

    /** @throws MlUnavailableException */
    public function post(string $path, array $data = []): Response
    {
        return $this->send(fn () => $this->request()->asJson()->post($path, $data));
    }

    /**
     * Successful JSON body or an exception that renders as the right API error.
     *
     * @throws MlRequestException|MlUnavailableException
     */
    public function json(string $path, array $query = []): mixed
    {
        $response = $this->get($path, $query);

        if (! $response->successful()) {
            throw MlRequestException::fromResponse($response);
        }

        return $response->json();
    }

    /**
     * GET with the raw body cached for odlar.cache.ttl seconds (errors are never cached).
     *
     * @return array{body: string, type: string, hit: bool}
     */
    public function cachedGet(string $path, array $query = []): array
    {
        ksort($query);
        $key = 'ml:'.sha1($path.'?'.http_build_query($query));
        $hit = true;

        $payload = Cache::store(config('odlar.cache.store'))->remember(
            $key,
            config('odlar.cache.ttl'),
            function () use ($path, $query, &$hit) {
                $hit = false;
                $response = $this->get($path, $query);
                if (! $response->successful()) {
                    throw MlRequestException::fromResponse($response);
                }

                return ['body' => $response->body(), 'type' => $response->header('Content-Type') ?: 'application/json'];
            },
        );

        return [...$payload, 'hit' => $hit];
    }

    private function send(callable $call): Response
    {
        try {
            return $call();
        } catch (ConnectionException $e) {
            throw new MlUnavailableException($e->getMessage(), previous: $e);
        }
    }
}
