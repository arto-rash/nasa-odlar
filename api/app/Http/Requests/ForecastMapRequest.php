<?php

namespace App\Http\Requests;

/** One week ahead for the map: the week (a Monday) and optionally the view. */
class ForecastMapRequest extends ProxyQueryRequest
{
    public function rules(): array
    {
        return [
            'week' => ['required', 'date_format:Y-m-d'],
            'bbox' => ['nullable', 'string', 'max:80', 'regex:/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/'],
        ];
    }
}
