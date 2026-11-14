<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class NotificationLog extends Model
{
    public const DELIVERED = 'delivered';

    public const SENT = 'sent';

    public const FAILED = 'failed';

    public const NOT_AVAILABLE = 'not_available';

    protected $fillable = ['alert_id', 'channel', 'status', 'error'];

    public function alert(): BelongsTo
    {
        return $this->belongsTo(Alert::class);
    }
}
