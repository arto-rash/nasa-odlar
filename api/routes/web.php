<?php

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json([
    'name' => 'ODLAR API',
    'docs' => url('/api/v1/status'),
]));
