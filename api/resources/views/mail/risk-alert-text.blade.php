{{ __('odlar.mail.greeting', ['name' => $alert->user->name]) }}

{{ __('odlar.mail.body', ['region' => $region, 'level' => $level, 'date' => $asOf]) }}
@if ($probability !== null)
{{ __('odlar.mail.probability', ['value' => $probability]) }}
@endif
{{ __('odlar.mail.threshold', ['threshold' => __('odlar.levels.'.$alert->threshold->value)]) }}

{{ __('odlar.mail.cta') }}: {{ $url }}

--
{{ __('odlar.mail.footer') }}
