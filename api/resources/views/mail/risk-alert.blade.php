<!doctype html>
<html lang="{{ app()->getLocale() }}">
<head><meta charset="utf-8"><title>{{ __('odlar.mail.subject', ['level' => $level, 'region' => $region]) }}</title></head>
<body style="margin:0;padding:24px;background:#f6f4f1;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;">
    <tr><td style="padding:20px 24px;background:#b3261e;color:#ffffff;border-radius:8px 8px 0 0;font-size:18px;font-weight:bold;">ODLAR</td></tr>
    <tr><td style="padding:24px;font-size:15px;line-height:1.5;">
        <p>{{ __('odlar.mail.greeting', ['name' => $alert->user->name]) }}</p>
        <p><strong>{{ __('odlar.mail.body', ['region' => $region, 'level' => $level, 'date' => $asOf]) }}</strong></p>
        @if ($probability !== null)
            <p>{{ __('odlar.mail.probability', ['value' => $probability]) }}</p>
        @endif
        <p>{{ __('odlar.mail.threshold', ['threshold' => __('odlar.levels.'.$alert->threshold->value)]) }}</p>
        <p><a href="{{ $url }}" style="display:inline-block;padding:10px 16px;background:#b3261e;color:#ffffff;text-decoration:none;border-radius:6px;">{{ __('odlar.mail.cta') }}</a></p>
    </td></tr>
    <tr><td style="padding:16px 24px;font-size:12px;color:#6b6b6b;">{{ __('odlar.mail.footer') }}</td></tr>
</table>
</body>
</html>
