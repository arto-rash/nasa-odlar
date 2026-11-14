<?php

namespace App\Http\Resources;

use App\Models\User;
use App\Services\TelegramClient;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin User */
class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'locale' => $this->locale,
            'telegram_linked' => $this->telegram_chat_id !== null,
            'telegram_available' => app(TelegramClient::class)->enabled(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
