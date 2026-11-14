<?php

namespace App\Http\Requests;

use Carbon\CarbonImmutable;
use Illuminate\Validation\Validator;

class HotspotsRequest extends ProxyQueryRequest
{
    public const MAX_DAYS = 92;

    public function rules(): array
    {
        return [
            'start' => ['required', 'date_format:Y-m-d'],
            'end' => ['required', 'date_format:Y-m-d', 'after_or_equal:start'],
            'sensor' => ['nullable', 'in:MODIS,VIIRS,modis,viirs'],
            'region' => ['nullable', 'string', 'max:100', self::SLUG],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50000'],
            // west,south,east,north in degrees, for map-viewport queries
            'bbox' => ['nullable', 'string', 'max:80', 'regex:/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }
            $days = CarbonImmutable::parse($this->input('start'))->diffInDays(CarbonImmutable::parse($this->input('end')));
            if ($days > self::MAX_DAYS) {
                $validator->errors()->add('end', 'The date range may not exceed '.self::MAX_DAYS.' days.');
            }
        }];
    }
}
