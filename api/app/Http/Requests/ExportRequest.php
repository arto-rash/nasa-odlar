<?php

namespace App\Http\Requests;

class ExportRequest extends ProxyQueryRequest
{
    public function rules(): array
    {
        return [
            'kind' => ['nullable', 'in:weekly,annual,hotspots'],
            'format' => ['nullable', 'in:csv,json,geojson'],
            'start' => ['nullable', 'date_format:Y-m-d'],
            'end' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:start'],
        ];
    }
}
