<?php

namespace App\Http\Requests;

class WeeklySeriesRequest extends ProxyQueryRequest
{
    public function rules(): array
    {
        return [
            'start' => ['nullable', 'date_format:Y-m-d'],
            'end' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:start'],
        ];
    }
}
