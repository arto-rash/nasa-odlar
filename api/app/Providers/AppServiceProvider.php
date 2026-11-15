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
        // The website's own server fetches every page's data from one address, for all
        // visitors (cached 10 min): with its token it gets one large allowance of its own
        // instead of sharing a single visitor's 240 a minute. Browsers never send the token.
        RateLimiter::for('api', function (Request $r) {
            $token = (string) config('odlar.frontend_token');
            if ($token !== '' && hash_equals($token, (string) $r->header('X-Frontend-Token'))) {
                return Limit::perMinute(3000)->by('frontend');
            }

            return Limit::perMinute(240)->by($r->ip());
        });
        RateLimiter::for('auth', fn (Request $r) => Limit::perMinute(10)->by($r->ip()));
        RateLimiter::for('export', fn (Request $r) => Limit::perMinute(20)->by($r->ip()));
        RateLimiter::for('evaluate', fn (Request $r) => Limit::perMinute(10)->by($r->user()?->id ?: $r->ip()));

        // Single resources are returned unwrapped ({...} not {"data": {...}}); collections keep "data".
        JsonResource::withoutWrapping();
    }
}
