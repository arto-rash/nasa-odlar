<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('odlar:evaluate-risk')->hourly()->withoutOverlapping();

// Picks up region changes and recovers if the boot-time sync ran before ML was ready.
Schedule::command('odlar:sync-regions')->dailyAt('03:15')->withoutOverlapping();
