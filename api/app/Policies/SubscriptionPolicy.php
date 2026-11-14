<?php

namespace App\Policies;

use App\Models\Subscription;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/** Owners only; others get a 404 so subscription ids are not enumerable. */
class SubscriptionPolicy
{
    public function view(User $user, Subscription $subscription): Response
    {
        return $this->owns($user, $subscription);
    }

    public function update(User $user, Subscription $subscription): Response
    {
        return $this->owns($user, $subscription);
    }

    public function delete(User $user, Subscription $subscription): Response
    {
        return $this->owns($user, $subscription);
    }

    private function owns(User $user, Subscription $subscription): Response
    {
        return $user->id === $subscription->user_id ? Response::allow() : Response::denyAsNotFound();
    }
}
