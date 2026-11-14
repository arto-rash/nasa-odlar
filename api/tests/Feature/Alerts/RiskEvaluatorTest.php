<?php

use App\Mail\RiskAlertMail;
use App\Models\Alert;
use App\Models\NotificationLog;
use App\Models\Region;
use App\Models\Subscription;
use App\Models\User;
use App\Services\RiskEvaluator;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;

beforeEach(function () {
    Mail::fake();
    $this->region = Region::factory()->create(['slug' => 'az-sabirabad', 'name_en' => 'Sabirabad', 'name_az' => 'Sabirabad rayonu']);
});

function subscribe(Region $region, array $attrs = [], array $user = []): Subscription
{
    return Subscription::factory()->for(User::factory()->state($user))->create(['region_id' => $region->id, ...$attrs]);
}

$levels = ['low', 'moderate', 'high', 'very_high', 'extreme'];
$thresholds = ['moderate', 'high', 'very_high', 'extreme'];
$matrix = [];
foreach ($thresholds as $t) {
    foreach ($levels as $l) {
        $matrix["{$l} vs threshold {$t}"] = [$l, $t, array_search($l, $levels) >= array_search($t, $levels)];
    }
}

it('alerts exactly when level >= threshold', function (string $level, string $threshold, bool $expected) {
    Http::fake([ml('/risk/az-sabirabad') => Http::response(riskPayload('az-sabirabad', $level))]);
    subscribe($this->region, ['threshold' => $threshold, 'channels' => ['in_app']]);

    $result = app(RiskEvaluator::class)->evaluate();

    expect($result['checked'])->toBe(1)
        ->and($result['created'])->toHaveCount($expected ? 1 : 0)
        ->and(Alert::count())->toBe($expected ? 1 : 0);
})->with($matrix);

it('stores the risk snapshot on the alert', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'very_high', '2026-10-20', 0.7312))]);
    $sub = subscribe($this->region, ['threshold' => 'high']);

    app(RiskEvaluator::class)->evaluate();

    $alert = Alert::sole();
    expect($alert->subscription_id)->toBe($sub->id)
        ->and($alert->user_id)->toBe($sub->user_id)
        ->and($alert->level->value)->toBe('very_high')
        ->and($alert->threshold->value)->toBe('high')
        ->and($alert->probability)->toBe(0.7312)
        ->and($alert->as_of->toDateString())->toBe('2026-10-20')
        ->and($alert->drivers)->toBe([['code' => 'dry_spell', 'value' => 12], ['code' => 'heat', 'value' => 2.1]])
        ->and($alert->read_at)->toBeNull();
});

it('is idempotent per as_of', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'extreme', '2026-10-20'))]);
    subscribe($this->region);

    $first = app(RiskEvaluator::class)->evaluate();
    $second = app(RiskEvaluator::class)->evaluate();

    expect($first['created'])->toHaveCount(1)
        ->and($second['created'])->toHaveCount(0)
        ->and($second['checked'])->toBe(1)
        ->and(Alert::count())->toBe(1)
        ->and(NotificationLog::count())->toBe(2);
    Mail::assertSentCount(1);
});

it('creates a new alert for a new forecast date', function () {
    Http::fake([ml('/risk/*') => Http::sequence()
        ->push(riskPayload('az-sabirabad', 'extreme', '2026-10-20'))
        ->push(riskPayload('az-sabirabad', 'extreme', '2026-10-21'))]);
    subscribe($this->region);

    app(RiskEvaluator::class)->evaluate();
    app(RiskEvaluator::class)->evaluate();

    expect(Alert::orderBy('as_of')->pluck('as_of')->map->toDateString()->all())->toBe(['2026-10-20', '2026-10-21']);
});

it('records a status per channel', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'extreme'))]);
    subscribe($this->region, ['channels' => ['in_app', 'email', 'sms', 'push']]);

    $alert = app(RiskEvaluator::class)->evaluate()['created']->sole();

    expect($alert->notificationLogs->pluck('status', 'channel')->all())->toBe([
        'in_app' => 'delivered', 'email' => 'sent', 'sms' => 'not_available', 'push' => 'not_available',
    ]);
});

it('only emails when the email channel is chosen', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'extreme'))]);
    subscribe($this->region, ['channels' => ['in_app']]);

    app(RiskEvaluator::class)->evaluate();

    Mail::assertNothingSent();
});

it('emails in Azerbaijani for az users', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'very_high'))]);
    $sub = subscribe($this->region, [], ['locale' => 'az', 'email' => 'az@example.com']);

    app(RiskEvaluator::class)->evaluate();

    Mail::assertSent(RiskAlertMail::class, function (RiskAlertMail $mail) {
        return $mail->hasTo('az@example.com')
            && $mail->locale === 'az'
            && $mail->hasSubject('ODLAR yanğın riski xəbərdarlığı: Sabirabad rayonu — çox yüksək risk');
    });
});

it('emails in English for en users', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'very_high'))]);
    subscribe($this->region, [], ['locale' => 'en', 'email' => 'en@example.com']);

    app(RiskEvaluator::class)->evaluate();

    Mail::assertSent(RiskAlertMail::class, fn (RiskAlertMail $mail) => $mail->hasTo('en@example.com')
        && $mail->hasSubject('ODLAR fire risk alert: very high risk in Sabirabad'));
});

it('renders localized html and text bodies', function () {
    $sub = subscribe($this->region, [], ['locale' => 'en', 'name' => 'Leyla']);
    $alert = Alert::factory()->create(['subscription_id' => $sub->id, 'level' => 'extreme', 'probability' => 0.81, 'as_of' => '2026-10-20']);

    $mail = new RiskAlertMail($alert->load('user', 'region'));

    $mail->assertSeeInHtml('Hello Leyla,')
        ->assertSeeInHtml('is now extreme (as of 2026-10-20)')
        ->assertSeeInHtml('81%')
        ->assertSeeInText('Open the region in ODLAR: http://localhost:3000/regions/az-sabirabad');

    $sub->user->update(['locale' => 'az']);
    (new RiskAlertMail($alert->fresh()->load('user', 'region')))->assertSeeInText('Salam, Leyla!');
});

it('marks email as failed when sending throws', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'extreme'))]);
    subscribe($this->region, ['channels' => ['in_app', 'email']]);
    Mail::shouldReceive('to')->andThrow(new RuntimeException('SMTP down'));

    $alert = app(RiskEvaluator::class)->evaluate()['created']->sole();

    $email = $alert->notificationLogs->firstWhere('channel', 'email');
    expect($email->status)->toBe('failed')->and($email->error)->toBe('SMTP down')
        ->and($alert->notificationLogs->firstWhere('channel', 'in_app')->status)->toBe('delivered');
});

it('skips inactive subscriptions', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'extreme'))]);
    subscribe($this->region, ['active' => false]);

    $result = app(RiskEvaluator::class)->evaluate();

    expect($result['checked'])->toBe(0)->and(Alert::count())->toBe(0);
    Http::assertNothingSent();
});

it('fetches each region risk once per run', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'extreme'))]);
    subscribe($this->region);
    subscribe($this->region);

    $result = app(RiskEvaluator::class)->evaluate();

    expect($result['created'])->toHaveCount(2);
    Http::assertSentCount(1);
    Http::assertSent(fn ($r) => $r->url() === ml('/risk/az-sabirabad'));
});

it('skips regions whose risk cannot be fetched and carries on', function () {
    $other = Region::factory()->create(['slug' => 'az-qabala']);
    Http::fake([
        ml('/risk/az-sabirabad') => Http::response(['detail' => 'no risk for region'], 404),
        ml('/risk/az-qabala') => Http::response(riskPayload('az-qabala', 'extreme')),
    ]);
    subscribe($this->region);
    subscribe($other);

    $result = app(RiskEvaluator::class)->evaluate();

    expect($result['checked'])->toBe(1)->and($result['failed'])->toBe(1)
        ->and(Alert::sole()->region_id)->toBe($other->id);
});

it('survives the ML service being down', function () {
    Http::fake([ml('/*') => Http::failedConnection()]);
    subscribe($this->region);

    $result = app(RiskEvaluator::class)->evaluate();

    expect($result['checked'])->toBe(0)->and($result['failed'])->toBe(1)->and(Alert::count())->toBe(0);
});

it('ignores unknown risk levels', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'catastrophic'))]);
    subscribe($this->region, ['threshold' => 'moderate']);

    expect(app(RiskEvaluator::class)->evaluate()['created'])->toHaveCount(0);
});

it('runs for all users via the artisan command', function () {
    Http::fake([ml('/risk/*') => Http::response(riskPayload('az-sabirabad', 'extreme'))]);
    subscribe($this->region);
    subscribe($this->region);

    $this->artisan('odlar:evaluate-risk')
        ->expectsOutput('Checked 2 subscription(s), created 2 alert(s), 0 without risk data.')
        ->assertSuccessful();

    expect(Alert::count())->toBe(2);
});

it('is scheduled hourly', function () {
    $event = collect(app(Schedule::class)->events())
        ->first(fn ($e) => str_contains($e->command, 'odlar:evaluate-risk'));

    expect($event)->not->toBeNull()->and($event->expression)->toBe('0 * * * *');
});
