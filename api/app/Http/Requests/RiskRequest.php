<?php

namespace App\Http\Requests;

/** Current risk list: optionally one country, optionally only the top `limit`. */
class RiskRequest extends ProxyQueryRequest
{
    public function rules(): array
    {
        return [
            'country' => ['nullable', 'string', 'regex:/^[a-z]{2,3}$/'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50000'],
        ];
    }
}
