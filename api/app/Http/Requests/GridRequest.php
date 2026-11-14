<?php

namespace App\Http\Requests;

class GridRequest extends ProxyQueryRequest
{
    public function rules(): array
    {
        return [
            'year' => ['nullable', 'integer', 'between:2000,2100'],
            'sensor' => ['nullable', 'in:MODIS,VIIRS'],
            'bbox' => ['nullable', 'string', 'max:80', 'regex:/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/'],
            'step' => ['nullable', 'numeric', 'between:0.1,5'],
        ];
    }
}
