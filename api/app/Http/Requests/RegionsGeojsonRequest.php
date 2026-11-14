<?php

namespace App\Http\Requests;

/** Region shapes in view: without parameters the full set (used by odlar:sync-regions). */
class RegionsGeojsonRequest extends ProxyQueryRequest
{
    public function rules(): array
    {
        return [
            'bbox' => ['nullable', 'string', 'max:80', 'regex:/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/'],
            'zoom' => ['nullable', 'numeric', 'between:0,24'],
            'country' => ['nullable', 'string', 'regex:/^[a-z]{2,3}$/'],
        ];
    }
}
