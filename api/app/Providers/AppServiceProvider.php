<?php

namespace App\Providers;

use App\Services\MlClient;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(MlClient::class);
    }

    public function boot(): void
    {
        RateLimiter::for('api', fn (Request $r) => Limit::perMinute(240)->by($r->ip()));
        RateLimiter::for('auth', fn (Request $r) => Limit::perMinute(10)->by($r->ip()));
        RateLimiter::for('export', fn (Request $r) => Limit::perMinute(20)->by($r->ip()));
        RateLimiter::for('evaluate', fn (Request $r) => Limit::perMinute(10)->by($r->user()?->id ?: $r->ip()));

        // Single resources are returned unwrapped ({...} not {"data": {...}}); collections keep "data".
        JsonResource::withoutWrapping();
    }
}
