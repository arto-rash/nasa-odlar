<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->isProduction() || config('odlar.seed_demo')) {
            $this->call(DemoSeeder::class);
        }
    }
}
