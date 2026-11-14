<?php

namespace App\Http\Requests;

/** Region list filters: country code, parent slug, level, search query, size. */
class RegionsRequest extends ProxyQueryRequest
{
    public function rules(): array
    {
        return [
            'country' => ['nullable', 'string', 'regex:/^[a-z]{2,3}$/'],
            'parent' => ['nullable', 'string', 'max:100', self::SLUG],
            'q' => ['nullable', 'string', 'max:80'],
            'level' => ['nullable', 'in:country,province,district'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50000'],
            'lite' => ['nullable', 'in:true,false,1,0'],
        ];
    }
}
