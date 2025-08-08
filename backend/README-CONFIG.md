## /api/config Kullanım Dokümanı

Endpoint: `GET /api/config`

Yanıt Şeması (örnek):
```
{
  "success": true,
  "data": {
    "features": {
      "dcbFirst": true,
      "showTarot": true
    },
    "payments": {
      "carriers": ["Turkcell", "Vodafone"]
    },
    "limits": {
      "aiDaily": 20
    },
    "rewards": {
      "inviteBonusAmount": 10
    }
  }
}
```

Alanlar:
- `features.dcbFirst` (boolean, default: false) – Android’de DCB önceliği
- `features.showTarot` (boolean, default: true) – Tarot’un görünürlüğü
- `payments.carriers` (string[]) – Desteklenen operatörler
- `limits.aiDaily` (number, default: 20) – Günlük AI hak limiti
- `rewards.inviteBonusAmount` (number, default: 10) – Davet bonusu

Cache Davranışı:
- `Cache-Control: public, max-age=300`
- `ETag` header’ı ile 304 Not Modified desteği

Entegrasyon Önerisi (FE):
- Uygulama açılışında `/api/config` çekilir ve feature flag’ler UI’ı şekillendirir.
- `If-None-Match` ile ETag kullanıp değişmediğinde 304 beklenir, ağ tüketimi azalır.
