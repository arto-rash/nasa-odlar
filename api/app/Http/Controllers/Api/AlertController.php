<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\AlertResource;
use App\Models\Alert;
use App\Services\RiskEvaluator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class AlertController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $request->validate(['unread' => ['nullable', 'boolean']]);

        $alerts = $request->user()->alerts()
            ->with(['region', 'notificationLogs'])
            ->when($request->boolean('unread'), fn ($q) => $q->whereNull('read_at'))
            ->latest('created_at')
            ->latest('id')
            ->paginate(15)
            ->withQueryString();

        return AlertResource::collection($alerts);
    }

    public function unreadCount(Request $request): JsonResponse
    {
        return response()->json(['count' => $request->user()->alerts()->whereNull('read_at')->count()]);
    }

    public function read(Alert $alert): AlertResource
    {
        Gate::authorize('update', $alert);

        if (! $alert->read_at) {
            $alert->update(['read_at' => now()]);
        }

        return new AlertResource($alert->load(['region', 'notificationLogs']));
    }

    public function readAll(Request $request): JsonResponse
    {
        $updated = $request->user()->alerts()->whereNull('read_at')->update(['read_at' => now()]);

        return response()->json(['updated' => $updated]);
    }

    /** Demo button: evaluate the current user's subscriptions right now. */
    public function evaluate(Request $request, RiskEvaluator $evaluator): JsonResponse
    {
        $result = $evaluator->evaluate($request->user()->subscriptions()->getQuery());

        return response()->json([
            'created' => AlertResource::collection($result['created']),
            'checked' => $result['checked'],
        ]);
    }
}
