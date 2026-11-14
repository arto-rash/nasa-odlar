<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // the chat the bot writes to once the user has linked it
            $table->bigInteger('telegram_chat_id')->nullable()->unique();
            // one-time code for t.me/<bot>?start=<code>
            $table->string('telegram_link_token', 64)->nullable()->unique();
            $table->timestamp('telegram_link_expires_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['telegram_chat_id', 'telegram_link_token', 'telegram_link_expires_at']);
        });
    }
};
