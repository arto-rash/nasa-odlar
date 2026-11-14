<?php

use App\Http\Controllers\Api\AlertController;
use App\Http\Controllers\Api\AnalyticsController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ExportController;
use App\Http\Controllers\Api\RegionLocateController;
use App\Http\Controllers\Api\StatusController;
use App\Http\Controllers\Api\SubscriptionController;
use App\Http\Controllers\Api\TelegramController;
use Illuminate\Support\Facades\Route;

Route::pattern('slug', '[a-z0-9][a-z0-9-]*');
Route::pattern('subscription', '[0-9]+');
Route::pattern('alert', '[0-9]+');

Route::prefix('v1')->group(function () {
    // Public analytics (proxied to the ML service, cached).
    Route::get('status', StatusController::class)->name('status');

    Route::controller(AnalyticsController::class)->group(function () {
        Route::get('overview', 'overview')->name('overview');
        Route::get('regions', 'regions')->name('regions.index');
        Route::get('regions/geojson', 'regionsGeojson')->name('regions.geojson');
        Route::get('regions/locate', RegionLocateController::class)->name('regions.locate');
        Route::get('regions/{slug}', 'region')->name('regions.show');
        Route::get('regions/{slug}/series/weekly', 'weekly')->name('regions.weekly');
        Route::get('regions/{slug}/series/annual', 'annual')->name('regions.annual');
        Route::get('regions/{slug}/calendar', 'calendar')->name('regions.calendar');
        Route::get('regions/{slug}/risk', 'regionRisk')->name('regions.risk');
        Route::get('regions/{slug}/forecast', 'forecast')->name('regions.forecast');
        Route::get('risk', 'risk')->name('risk');
        Route::get('forecast/map', 'forecastMap')->name('forecast.map');
        Route::get('events', 'events')->name('events.index');
        Route::get('events/{id}', 'event')->where('id', '-?\d+\.\d+_-?\d+\.\d+_\d{8}')->name('events.show');
        Route::get('hotspots', 'hotspots')->name('hotspots');
        Route::get('timeline', 'timeline')->name('timeline');
        Route::get('week-pack/{year}', 'weekPack')->whereNumber('year')->name('week-pack');
        Route::get('week-pack/home/{year}', 'homeWeekPack')->whereNumber('year')->name('week-pack.home');
        Route::get('grid', 'grid')->name('grid');
        Route::post('aoi/summary', 'aoiSummary')->name('aoi.summary');
        Route::get('harmonization/skill', 'skill')->name('harmonization.skill');
        Route::get('model/report', 'modelReport')->name('model.report');
    });

    // Telegram calls this; the secret is in the path and in a header.
    Route::post('telegram/webhook/{secret}', [TelegramController::class, 'webhook'])->middleware('throttle:120,1')->name('telegram.webhook');

    Route::get('export/{slug}', ExportController::class)->middleware('throttle:export')->name('export');

    // Auth (Sanctum personal access tokens).
    Route::prefix('auth')->controller(AuthController::class)->group(function () {
        Route::post('register', 'register')->middleware('throttle:auth')->name('auth.register');
        Route::post('login', 'login')->middleware('throttle:auth')->name('auth.login');

        Route::middleware('auth:sanctum')->group(function () {
            Route::post('logout', 'logout')->name('auth.logout');
            Route::get('me', 'me')->name('auth.me');
            Route::patch('me', 'update')->name('auth.update');
        });
    });

    Route::middleware('auth:sanctum')->group(function () {
        Route::apiResource('subscriptions', SubscriptionController::class);

        Route::get('alerts', [AlertController::class, 'index'])->name('alerts.index');
        Route::get('alerts/unread-count', [AlertController::class, 'unreadCount'])->name('alerts.unread-count');
        Route::post('alerts/read-all', [AlertController::class, 'readAll'])->name('alerts.read-all');
        Route::post('alerts/evaluate', [AlertController::class, 'evaluate'])->middleware('throttle:evaluate')->name('alerts.evaluate');
        Route::post('alerts/{alert}/read', [AlertController::class, 'read'])->name('alerts.read');

        Route::post('telegram/link', [TelegramController::class, 'link'])->middleware('throttle:auth')->name('telegram.link');
        Route::delete('telegram/link', [TelegramController::class, 'unlink'])->name('telegram.unlink');
    });
});
