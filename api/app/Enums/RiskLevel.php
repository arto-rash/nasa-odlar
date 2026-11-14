<?php

namespace App\Enums;

enum RiskLevel: string
{
    case Low = 'low';
    case Moderate = 'moderate';
    case High = 'high';
    case VeryHigh = 'very_high';
    case Extreme = 'extreme';

    public function rank(): int
    {
        return match ($this) {
            self::Low => 0,
            self::Moderate => 1,
            self::High => 2,
            self::VeryHigh => 3,
            self::Extreme => 4,
        };
    }

    public function atLeast(self $other): bool
    {
        return $this->rank() >= $other->rank();
    }

    /** Levels a subscription may use as its alert threshold ("low" would alert every day). */
    public static function thresholds(): array
    {
        return [self::Moderate->value, self::High->value, self::VeryHigh->value, self::Extreme->value];
    }
}
