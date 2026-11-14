<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class AoiSummaryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        // Shape check only; the ML service validates the geometry itself (area cap, validity).
        return [
            'geometry' => ['required', 'array'],
            'geometry.type' => ['required', 'string', 'in:Polygon,MultiPolygon'],
            'geometry.coordinates' => ['required', 'array', 'min:1'],
        ];
    }
}
