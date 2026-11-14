<?php

namespace App\Http\Requests;

class GridRequest extends ProxyQueryRequest
{
    public function rules(): array
    {
        return [
            'year' => ['nullable', 'integer', 'between:2000,2100'],
            'sensor' => ['nullable', 'in:MODIS,VIIRS'],
        ];
    }
}
