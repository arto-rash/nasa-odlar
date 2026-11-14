<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** Base for public query-string requests: only validated, non-empty params reach the ML service. */
abstract class ProxyQueryRequest extends FormRequest
{
    public const SLUG = 'regex:/^[a-z0-9][a-z0-9-]*$/';

    public function authorize(): bool
    {
        return true;
    }

    public function forwarded(): array
    {
        return array_filter($this->validated(), fn ($v) => $v !== null && $v !== '');
    }
}
