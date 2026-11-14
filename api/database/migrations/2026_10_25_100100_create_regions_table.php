<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Mirror of the ML service's regions; `id` is the ML region id (not auto-incremented).
        Schema::create('regions', function (Blueprint $table) {
            $table->unsignedBigInteger('id')->primary();
            $table->string('slug')->unique();
            $table->string('name_en');
            $table->string('name_az');
            $table->string('country', 8)->nullable();
            $table->string('level', 32)->index();
            $table->unsignedBigInteger('parent_id')->nullable()->index();
            $table->double('area_km2')->nullable();
            $table->double('lat')->nullable();
            $table->double('lon')->nullable();
            $table->timestamps();
        });

        DB::statement('ALTER TABLE regions ADD COLUMN geom geometry(MultiPolygon, 4326)');
        DB::statement('CREATE INDEX regions_geom_gist ON regions USING GIST (geom)');
    }

    public function down(): void
    {
        Schema::dropIfExists('regions');
    }
};
