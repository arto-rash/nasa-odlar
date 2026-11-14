<?php

namespace Database\Factories;

use App\Models\Alert;
use App\Models\Subscription;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Alert> */
class AlertFactory extends Factory
{
    public function definition(): array
    {
        return [
            'subscription_id' => Subscription::factory(),
            'user_id' => fn (array $a) => Subscription::find($a['subscription_id'])->user_id,
            'region_id' => fn (array $a) => Subscription::find($a['subscription_id'])->region_id,
            'level' => 'high',
            'probability' => 0.42,
            'threshold' => 'high',
            'as_of' => fake()->unique()->dateTimeBetween('-1 year')->format('Y-m-d'),
            'drivers' => [['code' => 'dry', 'value' => 1.2]],
            'read_at' => null,
        ];
    }

    public function read(): static
    {
        return $this->state(fn () => ['read_at' => now()]);
    }
}
