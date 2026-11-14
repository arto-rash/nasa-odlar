<?php

namespace App\Http\Requests;

use App\Enums\Channel;
use App\Enums\RiskLevel;
use App\Models\Region;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreSubscriptionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'region_slug' => ['required', 'string', 'exists:regions,slug'],
            'threshold' => ['nullable', Rule::in(RiskLevel::thresholds())],
            'channels' => ['nullable', 'array', 'min:1'],
            'channels.*' => ['string', 'distinct', Rule::in(Channel::values())],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            if ($validator->errors()->has('region_slug')) {
                return;
            }
            $taken = $this->user()->subscriptions()
                ->whereHas('region', fn ($q) => $q->where('slug', $this->input('region_slug')))
                ->exists();
            if ($taken) {
                $validator->errors()->add('region_slug', 'You are already subscribed to this region.');
            }
        }];
    }

    public function region(): Region
    {
        return Region::where('slug', $this->validated('region_slug'))->firstOrFail();
    }
}
