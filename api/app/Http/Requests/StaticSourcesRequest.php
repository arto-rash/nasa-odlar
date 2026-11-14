<?php

namespace App\Http\Requests;

/** Steady heat sources: optionally only the view, and how many. */
class StaticSourcesRequest extends ProxyQueryRequest
{
    public function rules(): array
    {
        return [
            'bbox' => ['nullable', 'string', 'max:80', 'regex:/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:20000'],
        ];
    }
}
