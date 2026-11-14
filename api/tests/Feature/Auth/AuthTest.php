<?php

use App\Models\User;
use Illuminate\Support\Facades\Hash;

describe('register', function () {
    it('creates a user and returns a token', function () {
        $response = $this->postJson('/api/v1/auth/register', [
            'name' => 'Aysel', 'email' => 'Aysel@Example.com', 'password' => 'secret-pass', 'locale' => 'en',
        ]);

        $response->assertCreated()
            ->assertJsonStructure(['token', 'user' => ['id', 'name', 'email', 'locale', 'created_at']])
            ->assertJsonPath('user.email', 'aysel@example.com')
            ->assertJsonPath('user.locale', 'en')
            ->assertJsonMissingPath('user.password');

        $this->withToken($response->json('token'))->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('name', 'Aysel');
        expect(Hash::check('secret-pass', User::first()->password))->toBeTrue();
    });

    it('defaults locale to az', function () {
        $this->postJson('/api/v1/auth/register', ['name' => 'A', 'email' => 'a@example.com', 'password' => 'secret-pass'])
            ->assertCreated()
            ->assertJsonPath('user.locale', 'az');
    });

    it('validates input', function (array $body, array $errors) {
        $this->postJson('/api/v1/auth/register', $body)->assertUnprocessable()->assertJsonValidationErrors($errors);
    })->with([
        'empty' => [[], ['name', 'email', 'password']],
        'bad email' => [['name' => 'A', 'email' => 'nope', 'password' => 'secret-pass'], ['email']],
        'short password' => [['name' => 'A', 'email' => 'a@example.com', 'password' => 'short'], ['password']],
        'bad locale' => [['name' => 'A', 'email' => 'a@example.com', 'password' => 'secret-pass', 'locale' => 'ru'], ['locale']],
    ]);

    it('rejects a duplicate email (case-insensitive)', function () {
        User::factory()->create(['email' => 'taken@example.com']);

        $this->postJson('/api/v1/auth/register', ['name' => 'A', 'email' => 'TAKEN@example.com', 'password' => 'secret-pass'])
            ->assertJsonValidationErrors('email');
    });
});

describe('login', function () {
    beforeEach(fn () => User::factory()->create(['email' => 'u@example.com', 'password' => 'correct-horse']));

    it('returns a token for valid credentials', function () {
        $this->postJson('/api/v1/auth/login', ['email' => 'u@example.com', 'password' => 'correct-horse'])
            ->assertOk()
            ->assertJsonStructure(['token', 'user' => ['id', 'name', 'email', 'locale', 'created_at']]);
    });

    it('rejects a wrong password with 422', function () {
        $this->postJson('/api/v1/auth/login', ['email' => 'u@example.com', 'password' => 'wrong-horse'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email' => 'These credentials do not match our records.']);
    });

    it('rejects an unknown email with 422', function () {
        $this->postJson('/api/v1/auth/login', ['email' => 'ghost@example.com', 'password' => 'correct-horse'])
            ->assertJsonValidationErrors('email');
    });

    it('requires email and password', function () {
        $this->postJson('/api/v1/auth/login', [])->assertJsonValidationErrors(['email', 'password']);
    });

    it('is rate limited to 10 attempts per minute', function () {
        foreach (range(1, 10) as $_) {
            $this->postJson('/api/v1/auth/login', ['email' => 'u@example.com', 'password' => 'x'])->assertUnprocessable();
        }

        $this->postJson('/api/v1/auth/login', ['email' => 'u@example.com', 'password' => 'correct-horse'])
            ->assertStatus(429)
            ->assertJsonStructure(['message']);
    });
});

describe('me and logout', function () {
    it('requires authentication', function (string $method, string $uri) {
        $this->json($method, $uri)->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
    })->with([
        ['GET', '/api/v1/auth/me'],
        ['PATCH', '/api/v1/auth/me'],
        ['POST', '/api/v1/auth/logout'],
    ]);

    it('returns the current user', function () {
        $user = actingAsUser(['name' => 'Rashid', 'locale' => 'en']);

        $this->getJson('/api/v1/auth/me')->assertOk()->assertExactJson([
            'id' => $user->id, 'name' => 'Rashid', 'email' => $user->email, 'locale' => 'en',
            'telegram_linked' => false, 'telegram_available' => false,
            'created_at' => $user->created_at->toIso8601String(),
        ]);
    });

    it('updates name and locale', function () {
        $user = actingAsUser(['locale' => 'az']);

        $this->patchJson('/api/v1/auth/me', ['name' => 'New Name', 'locale' => 'en'])
            ->assertOk()
            ->assertJsonPath('name', 'New Name')
            ->assertJsonPath('locale', 'en');

        expect($user->refresh()->locale)->toBe('en');
    });

    it('ignores fields that are not editable', function () {
        $user = actingAsUser(['email' => 'keep@example.com']);

        $this->patchJson('/api/v1/auth/me', ['email' => 'hack@example.com'])->assertOk();

        expect($user->refresh()->email)->toBe('keep@example.com');
    });

    it('validates profile updates', function () {
        actingAsUser();

        $this->patchJson('/api/v1/auth/me', ['locale' => 'fr', 'name' => ''])->assertJsonValidationErrors(['locale', 'name']);
    });

    it('revokes the current token on logout', function () {
        $user = User::factory()->create();
        $token = $user->createToken('api')->plainTextToken;
        $other = $user->createToken('other')->plainTextToken;

        $this->withToken($token)->postJson('/api/v1/auth/logout')->assertNoContent();
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->withToken($other)->getJson('/api/v1/auth/me')->assertOk();
        expect($user->tokens()->count())->toBe(1);
    });
});
