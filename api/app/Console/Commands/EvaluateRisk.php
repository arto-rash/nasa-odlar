<?php

namespace App\Console\Commands;

use App\Models\Subscription;
use App\Services\RiskEvaluator;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('odlar:evaluate-risk {--user= : Only this user id}')]
#[Description('Raise alerts for subscriptions whose region risk reached their threshold')]
class EvaluateRisk extends Command
{
    public function handle(RiskEvaluator $evaluator): int
    {
        $query = Subscription::query()->when($this->option('user'), fn ($q, $id) => $q->where('user_id', $id));
        $result = $evaluator->evaluate($query);

        $this->info(sprintf(
            'Checked %d subscription(s), created %d alert(s), %d without risk data.',
            $result['checked'], $result['created']->count(), $result['failed'],
        ));

        return self::SUCCESS;
    }
}
