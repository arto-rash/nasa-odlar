<?php

namespace Database\Factories;

use App\Models\Region;
use App\Models\Subscription;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Subscription> */
class SubscriptionFactory extends Factory
{
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'region_id' => Region::factory(),
            'threshold' => 'high',
            'channels' => ['in_app', 'email'],
            'active' => true,
        ];
    }
}
