<?php

namespace App\Enums;

enum Channel: string
{
    case InApp = 'in_app';
    case Email = 'email';
    case Sms = 'sms';
    case Push = 'push';
    case Telegram = 'telegram';

    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
