<?php

return [
    'levels' => [
        'low' => 'aşağı',
        'moderate' => 'orta',
        'high' => 'yüksək',
        'very_high' => 'çox yüksək',
        'extreme' => 'ekstremal',
    ],
    'mail' => [
        'subject' => 'ODLAR yanğın riski xəbərdarlığı: :region — :level risk',
        'greeting' => 'Salam, :name!',
        'body' => ':region üçün 7 günlük yanğın riski proqnozu artıq :level səviyyəsindədir (:date tarixinə).',
        'probability' => 'Normadan yüksək yanğın aktivliyi ehtimalı: :value%',
        'threshold' => 'Siz ":threshold" və daha yüksək səviyyədə bildiriş almaq istəmisiniz.',
        'cta' => 'Regionu ODLAR-da açın',
        'footer' => 'Bu məktubu ODLAR-da yanğın riski xəbərdarlıqlarına abunə olduğunuz üçün alırsınız. Abunəlikləri hesabınızda idarə edə bilərsiniz.',
    ],
    'telegram' => [
        'alert' => '🔥 :region üçün yanğın riski: növbəti 7 gün :level (normadan yüksək yanğın aktivliyi ehtimalı :probability%, :date tarixinə).',
        'linked' => 'Hazırdır, :name. ODLAR yanğın riski bildirişləri bura gələcək. Söndürmək üçün /stop göndərin.',
        'stopped' => 'Telegram bildirişləri söndürüldü. ODLAR-ın bildirişlər səhifəsində yenidən qoşa bilərsiniz.',
        'expired' => 'Bu keçidin vaxtı bitib və ya artıq istifadə olunub. :url saytında bildirişlər səhifəsini açın və «Telegram-ı qoş» düyməsini yenidən basın.',
        'help' => 'Bu bot ODLAR yanğın riski bildirişlərini göndərir. :url saytında bildirişlər səhifəsindən qoşun. /stop bildirişləri söndürür.',
    ],
];
