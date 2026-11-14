<?php

namespace App\Http\Resources;

use App\Models\Alert;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Alert */
class AlertResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'region' => [
                'slug' => $this->region->slug,
                'name_en' => $this->region->name_en,
                'name_az' => $this->region->name_az,
            ],
            'level' => $this->level->value,
            'probability' => $this->probability,
            'threshold' => $this->threshold->value,
            'as_of' => $this->as_of->toDateString(),
            'drivers' => $this->drivers ?? [],
            'read_at' => $this->read_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'channels' => $this->notificationLogs
                ->map(fn ($log) => ['channel' => $log->channel, 'status' => $log->status])
                ->values(),
        ];
    }
}
