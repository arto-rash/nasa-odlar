<?php

namespace App\Http\Requests;

/** Fires now: optionally the view, one region, only active ones, and how many. */
class EventsRequest extends ProxyQueryRequest
{
    public function rules(): array
    {
        return [
            'bbox' => ['nullable', 'string', 'max:80', 'regex:/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/'],
            'region' => ['nullable', 'string', 'max:100', 'regex:/^[a-z0-9-]+$/'],
            'active' => ['nullable', 'in:true,false,1,0'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:2000'],
        ];
    }
}
