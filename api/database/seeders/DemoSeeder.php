<?php

namespace Database\Seeders;

use App\Models\Region;
use App\Models\User;
use Illuminate\Database\Seeder;

/** Demo account for judges: demo@odlar.az / odlar-demo-2026. Idempotent. */
class DemoSeeder extends Seeder
{
    public const EMAIL = 'demo@odlar.az';

    public const PASSWORD = 'odlar-demo-2026';

    private const SUBSCRIPTIONS = ['az-sabirabad' => 'high', 'az-qabala' => 'moderate'];

    public function run(): void
    {
        $user = User::firstOrCreate(
            ['email' => self::EMAIL],
            ['name' => 'ODLAR Demo', 'password' => self::PASSWORD, 'locale' => 'az'],
        );

        foreach (self::SUBSCRIPTIONS as $slug => $threshold) {
            $region = Region::where('slug', $slug)->first();
            if (! $region) {
                $this->command?->warn("Region {$slug} not synced yet; run odlar:sync-regions first.");

                continue;
            }
            $user->subscriptions()->firstOrCreate(
                ['region_id' => $region->id],
                ['threshold' => $threshold, 'channels' => ['in_app', 'email']],
            );
        }
    }
}
