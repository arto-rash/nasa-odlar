<?php

use App\Models\Region;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;

it('returns JSON 404 for unknown API routes', function () {
    $this->get('/api/v1/does-not-exist')
        ->assertNotFound()
        ->assertHeader('Content-Type', 'application/json')
        ->assertExactJson(['message' => 'Not Found']);
});

it('returns JSON 405 for wrong methods', function () {
    $this->delete('/api/v1/overview')->assertStatus(405)->assertHeader('Content-Type', 'application/json');
});

it('returns JSON 401 for guests even without an Accept header', function () {
    $this->get('/api/v1/auth/me')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('uses the standard validation shape without an Accept header', function () {
    $this->post('/api/v1/auth/login', [])
        ->assertUnprocessable()
        ->assertJsonStructure(['message', 'errors' => ['email', 'password']]);
});

it('allows configured and vercel preview origins', function (string $origin) {
    Http::fake([ml('/risk') => Http::response([])]);

    $this->getJson('/api/v1/risk', ['Origin' => $origin])->assertHeader('Access-Control-Allow-Origin', $origin);
})->with(['http://localhost:3000', 'https://odlar.example', 'https://odlar-git-main-team.vercel.app']);

it('rejects other origins', function (string $origin) {
    Http::fake([ml('/risk') => Http::response([])]);

    $this->getJson('/api/v1/risk', ['Origin' => $origin])->assertHeaderMissing('Access-Control-Allow-Origin');
})->with(['https://evil.example', 'https://vercel.app.evil.example', 'http://odlar.vercel.app']);

it('answers CORS preflight', function () {
    $this->call('OPTIONS', '/api/v1/auth/login', server: [
        'HTTP_ORIGIN' => 'http://localhost:3000',
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
        'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization,content-type',
    ])->assertNoContent()->assertHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
});

it('applies the global 240/min api limit', function () {
    Http::fake([ml('/risk') => Http::response([])]);

    $this->getJson('/api/v1/risk')->assertOk()->assertHeader('X-RateLimit-Limit', '240');
});

it('seeds the demo account and its subscriptions', function () {
    Region::factory()->create(['slug' => 'az-sabirabad']);
    Region::factory()->create(['slug' => 'az-qabala']);

    $this->seed(DatabaseSeeder::class);
    $this->seed(DatabaseSeeder::class); // idempotent

    $demo = User::where('email', DemoSeeder::EMAIL)->sole();
    expect(Hash::check(DemoSeeder::PASSWORD, $demo->password))->toBeTrue()
        ->and($demo->locale)->toBe('az')
        ->and($demo->subscriptions()->with('region')->get()->mapWithKeys(fn ($s) => [$s->region->slug => $s->threshold->value])->all())
        ->toEqual(['az-sabirabad' => 'high', 'az-qabala' => 'moderate']);
});

it('does not seed the demo account in production unless SEED_DEMO is set', function () {
    app()->detectEnvironment(fn () => 'production');
    $seed = fn () => app(DatabaseSeeder::class)->setContainer(app())->__invoke();

    $seed();
    expect(User::count())->toBe(0);

    config(['odlar.seed_demo' => true]);
    $seed();
    expect(User::where('email', DemoSeeder::EMAIL)->exists())->toBeTrue();
});
