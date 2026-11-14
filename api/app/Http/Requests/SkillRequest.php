<?php

namespace App\Http\Requests;

class SkillRequest extends ProxyQueryRequest
{
    public function rules(): array
    {
        return ['region' => ['nullable', 'string', 'max:100', self::SLUG]];
    }
}
