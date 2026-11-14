<?php

namespace Database\Factories;

use App\Models\Region;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Region> */
class RegionFactory extends Factory
{
    private static int $nextId = 9000;

    public function definition(): array
    {
        $name = fake()->unique()->city();

        return [
            'id' => self::$nextId++,
            'slug' => 'az-'.str($name)->slug().'-'.self::$nextId,
            'name_en' => $name,
            'name_az' => $name,
            'country' => 'AZ',
            'level' => 'district',
            'parent_id' => null,
            'area_km2' => 1000,
            'lat' => 40.4,
            'lon' => 48.0,
        ];
    }

    public function country(): static
    {
        return $this->state(fn () => ['level' => 'country']);
    }
}
