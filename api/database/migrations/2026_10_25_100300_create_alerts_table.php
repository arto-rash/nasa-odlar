<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('alerts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('subscription_id')->constrained()->cascadeOnDelete();
            $table->foreignId('region_id')->constrained('regions')->cascadeOnDelete();
            $table->string('level', 16);
            $table->double('probability')->nullable();
            $table->string('threshold', 16);
            $table->date('as_of');
            $table->json('drivers')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->timestamps();

            // One alert per subscription per forecast date: makes evaluation idempotent.
            $table->unique(['subscription_id', 'as_of']);
            $table->index(['user_id', 'read_at']);
        });

        Schema::create('notification_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('alert_id')->constrained()->cascadeOnDelete();
            $table->string('channel', 16);
            $table->string('status', 16);
            $table->text('error')->nullable();
            $table->timestamps();

            $table->unique(['alert_id', 'channel']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notification_logs');
        Schema::dropIfExists('alerts');
    }
};
