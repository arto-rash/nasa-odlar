<?php

namespace App\Policies;

use App\Models\Alert;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class AlertPolicy
{
    public function update(User $user, Alert $alert): Response
    {
        return $user->id === $alert->user_id ? Response::allow() : Response::denyAsNotFound();
    }
}
