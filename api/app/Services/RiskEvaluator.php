<?php

namespace App\Services;

use App\Enums\Channel;
use App\Enums\RiskLevel;
use App\Exceptions\MlRequestException;
use App\Exceptions\MlUnavailableException;
use App\Mail\RiskAlertMail;
use App\Models\Alert;
use App\Models\NotificationLog;
use App\Models\Subscription;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Compares each active subscription's region risk (ML GET /risk/{slug} -> short.level) with its
 * threshold and raises at most one alert per subscription per forecast date (as_of).
 */
class RiskEvaluator
{
    /** @var array<string, array|null> per-run memo of ML risk by region slug */
    private array $risk = [];

    public function __construct(private readonly MlClient $ml, private readonly TelegramClient $telegram) {}

    /**
     * @param  Builder<Subscription>|null  $subscriptions  defaults to every subscription
     * @return array{created: Collection<int, Alert>, checked: int, failed: int}
     */
    public function evaluate(?Builder $subscriptions = null): array
    {
        $this->risk = [];
        $created = new Collection;
        $checked = 0;
        $failed = 0;

        ($subscriptions ?? Subscription::query())
            ->active()
            ->with(['region', 'user'])
            ->orderBy('id')
            ->each(function (Subscription $subscription) use ($created, &$checked, &$failed) {
                $risk = $this->riskFor($subscription->region->slug);
                if ($risk === null) {
                    $failed++;

                    return;
                }
                $checked++;
                if ($alert = $this->evaluateOne($subscription, $risk)) {
                    $created->push($alert);
                }
            });

        return ['created' => $created, 'checked' => $checked, 'failed' => $failed];
    }

    private function evaluateOne(Subscription $subscription, array $risk): ?Alert
    {
        $level = RiskLevel::tryFrom((string) data_get($risk, 'short.level'));
        $asOf = data_get($risk, 'as_of');

        if (! $level || ! $asOf || ! $level->atLeast($subscription->threshold)) {
            return null;
        }
        if ($subscription->alerts()->whereDate('as_of', $asOf)->exists()) {
            return null; // already alerted for this forecast
        }

        try {
            // Savepoint so a concurrent duplicate (unique subscription_id+as_of) cannot poison an outer transaction.
            $alert = DB::transaction(fn () => Alert::create([
                'user_id' => $subscription->user_id,
                'subscription_id' => $subscription->id,
                'region_id' => $subscription->region_id,
                'level' => $level,
                'probability' => data_get($risk, 'short.probability'),
                'threshold' => $subscription->threshold,
                'as_of' => $asOf,
                'drivers' => array_values((array) data_get($risk, 'short.drivers', [])),
            ]));
        } catch (UniqueConstraintViolationException) {
            return null;
        }
        $alert->setRelation('region', $subscription->region);
        $alert->setRelation('user', $subscription->user);

        foreach ($subscription->channels ?? [] as $channel) {
            [$status, $error] = $this->deliver($alert, Channel::from($channel));
            $alert->notificationLogs()->create(['channel' => $channel, 'status' => $status, 'error' => $error]);
        }

        return $alert->load('notificationLogs');
    }

    /** @return array{0: string, 1: ?string} [status, error] */
    private function deliver(Alert $alert, Channel $channel): array
    {
        return match ($channel) {
            Channel::InApp => [NotificationLog::DELIVERED, null],
            Channel::Email => $this->email($alert),
            Channel::Telegram => $this->telegram($alert),
            // SMS and push are designed but not wired up in the prototype.
            Channel::Sms, Channel::Push => [NotificationLog::NOT_AVAILABLE, null],
        };
    }

    private function email(Alert $alert): array
    {
        try {
            Mail::to($alert->user)->send(new RiskAlertMail($alert));

            return [NotificationLog::SENT, null];
        } catch (Throwable $e) {
            Log::warning('Risk alert email failed', ['alert_id' => $alert->id, 'error' => $e->getMessage()]);

            return [NotificationLog::FAILED, mb_substr($e->getMessage(), 0, 500)];
        }
    }

    private function telegram(Alert $alert): array
    {
        $chat = $alert->user->telegram_chat_id;
        if ($chat === null || ! $this->telegram->enabled()) {
            return [NotificationLog::NOT_AVAILABLE, null];
        }
        $locale = $alert->user->preferredLocale();
        $region = $locale === 'en' ? $alert->region->name_en : $alert->region->name_az;
        $text = __('odlar.telegram.alert', [
            'region' => $region,
            'level' => __('odlar.levels.'.$alert->level->value, [], $locale),
            'probability' => $alert->probability !== null ? round($alert->probability * 100) : '—',
            'date' => $alert->as_of->toDateString(),
        ], $locale);
        try {
            $this->telegram->send($chat, $text, ['text' => __('odlar.mail.cta', [], $locale), 'url' => $alert->regionUrl()]);

            return [NotificationLog::SENT, null];
        } catch (Throwable $e) {
            Log::warning('Risk alert Telegram message failed', ['alert_id' => $alert->id, 'error' => $e->getMessage()]);

            return [NotificationLog::FAILED, mb_substr($e->getMessage(), 0, 500)];
        }
    }

    private function riskFor(string $slug): ?array
    {
        if (! array_key_exists($slug, $this->risk)) {
            try {
                $this->risk[$slug] = $this->ml->json("/risk/{$slug}");
            } catch (MlRequestException|MlUnavailableException $e) {
                Log::warning('Risk lookup failed', ['region' => $slug, 'error' => $e->getMessage()]);
                $this->risk[$slug] = null;
            }
        }

        return $this->risk[$slug];
    }
}
