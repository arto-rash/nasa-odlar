<?php

namespace App\Http\Controllers\Api;

use App\Enums\Channel;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreSubscriptionRequest;
use App\Http\Requests\UpdateSubscriptionRequest;
use App\Http\Resources\SubscriptionResource;
use App\Models\Subscription;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class SubscriptionController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => SubscriptionResource::collection(
            $request->user()->subscriptions()->with('region')->latest('id')->get()
        )]);
    }

    public function store(StoreSubscriptionRequest $request): SubscriptionResource
    {
        $subscription = $request->user()->subscriptions()->create([
            'region_id' => $request->region()->id,
            'threshold' => $request->validated('threshold') ?? 'high',
            'channels' => $request->validated('channels') ?? [Channel::InApp->value, Channel::Email->value],
        ]);

        return new SubscriptionResource($subscription->load('region'));
    }

    public function show(Subscription $subscription): SubscriptionResource
    {
        Gate::authorize('view', $subscription);

        return new SubscriptionResource($subscription->load('region'));
    }

    public function update(UpdateSubscriptionRequest $request, Subscription $subscription): SubscriptionResource
    {
        $subscription->update($request->validated());

        return new SubscriptionResource($subscription->refresh()->load('region'));
    }

    public function destroy(Subscription $subscription): Response
    {
        Gate::authorize('delete', $subscription);
        $subscription->delete();

        return response()->noContent();
    }
}
