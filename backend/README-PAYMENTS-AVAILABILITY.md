Endpoint: `GET /api/payments/availability`

Response schema:
```
{ "success": true, "data": { "dcb": true, "carriers": ["Turkcell","Vodafone"] } }
```

Errors:
- 503 Service Unavailable (ör. altyapı bağımlılığı hazır değil)
- 429 Too Many Requests (rate-limit ihlali)

Caching:
- `Cache-Control: public, max-age=300` (5 dk)

Env toggles:
- `PAYMENTS_DCB_ENABLED=true|false`
- `PAYMENTS_CARRIERS=Turkcell,Vodafone,Turk Telekom`

Kullanım (öneri):
- Android’de DCB destekleniyorsa “Operatörle Öde”’yi ilk sıraya yerleştir.
- DCB yoksa kart → cüzdan fallback sırası.
