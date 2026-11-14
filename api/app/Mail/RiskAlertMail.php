<?php

namespace App\Mail;

use App\Models\Alert;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class RiskAlertMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public Alert $alert)
    {
        $this->locale($alert->user->preferredLocale());
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: __('odlar.mail.subject', [
            'level' => __('odlar.levels.'.$this->alert->level->value, [], $this->locale),
            'region' => $this->regionName(),
        ], $this->locale));
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.risk-alert',
            text: 'mail.risk-alert-text',
            with: [
                'region' => $this->regionName(),
                'level' => __('odlar.levels.'.$this->alert->level->value, [], $this->locale),
                'probability' => $this->alert->probability !== null ? round($this->alert->probability * 100) : null,
                'asOf' => $this->alert->as_of->toDateString(),
                'url' => config('odlar.frontend_url').'/regions/'.$this->alert->region->slug,
            ],
        );
    }

    private function regionName(): string
    {
        return $this->locale === 'en' ? $this->alert->region->name_en : $this->alert->region->name_az;
    }
}
