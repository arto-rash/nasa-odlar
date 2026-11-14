<?php

namespace App\Http\Requests;

use App\Enums\Channel;
use App\Enums\RiskLevel;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class UpdateSubscriptionRequest extends FormRequest
{
    public function authorize(): Response
    {
        // Ownership first, so another user's subscription is a 404 even with an invalid body.
        return Gate::inspect('update', $this->route('subscription'));
    }

    public function rules(): array
    {
        return [
            'threshold' => ['sometimes', 'required', Rule::in(RiskLevel::thresholds())],
            'channels' => ['sometimes', 'required', 'array', 'min:1'],
            'channels.*' => ['string', 'distinct', Rule::in(Channel::values())],
            'active' => ['sometimes', 'required', 'boolean'],
        ];
    }
}
