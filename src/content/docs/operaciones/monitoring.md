---
title: Monitoring
description: Logs, métricas, alertas y dashboards.
---

## Logs

El Auth Service emite **logs JSON estructurados** a stdout. Cloud Run los ingesta automáticamente en Cloud Logging.

**Formato típico:**

```json
{
  "severity": "INFO",
  "time": "2026-05-25T14:00:00.000Z",
  "context": "LoginUseCase",
  "message": "User logged in",
  "accountId": "...",
  "email": "juan@hagemsa.com",
  "x-request-id": "..."
}
```

**Scrubbing automático:** los logs nunca contienen passwords, tokens, ni secrets. El `JsonLogger` redacta recursivamente cualquier key sensible (ver [Seguridad](/arquitectura/seguridad/#logging--scrubbing)).

## Queries útiles en Cloud Logging

**Logins fallidos en la última hora:**

```
resource.type="cloud_run_revision"
resource.labels.service_name="auth-service"
jsonPayload.message="Failed login attempt"
timestamp > "2026-05-25T13:00:00Z"
```

**Reuso de refresh tokens detectado:**

```
resource.labels.service_name="auth-service"
jsonPayload.message="Refresh token reuse detected"
```

**Errores 5xx:**

```
resource.labels.service_name="auth-service"
severity="ERROR"
```

## Métricas (Cloud Monitoring)

Automáticas por Cloud Run:

- `run.googleapis.com/request_count` — RPS
- `run.googleapis.com/request_latencies` — p50, p95, p99
- `run.googleapis.com/instance_count` — escalado horizontal
- `run.googleapis.com/container/memory/utilizations` — uso de memoria

## Alertas recomendadas

| Condición | Severidad | Acción |
|---|---|---|
| p99 latencia > 2s por 5 min | warning | revisar Cloud SQL y JWKS cache |
| Tasa de 5xx > 1% por 5 min | critical | rollback, investigar logs |
| Tasa de `login_fallido` > 50/min sostenido | warning | posible ataque de fuerza bruta |
| `refresh_reuso_detectado` > 5/hora | critical | posible compromiso de tokens |
| Cloud SQL connections > 80% del max | warning | escalar pool o instancia |
| Health probe failures > 3 consecutivas | critical | redeploy o investigar |

## Dashboards

Crear un dashboard en Cloud Monitoring con paneles:

1. **RPS** (request rate) por endpoint
2. **Latencia p95/p99** por endpoint
3. **Distribución de status codes** (200/400/401/403/404/5xx)
4. **Instances activas** (Cloud Run auto-scaling)
5. **Memory utilization** por instance
6. **Cloud SQL** queries/sec y connections
7. **Eventos de auditoría** por tipo (cuántos `login_exitoso`, `login_fallido`, etc.)

## Correlation ID

Cada request tiene un `X-Request-Id`. Si el cliente lo manda, se respeta y se devuelve en la response. Si no, se genera uno.

Todos los logs de esa request incluyen ese ID, lo que permite **tracing end-to-end** en Cloud Logging:

```
jsonPayload."x-request-id"="abc-123"
```

## Audit log para forensics

Más allá de los logs operacionales, la tabla `audit.auth_events` contiene el historial autoritativo de eventos sensibles. Para investigaciones:

```sql
SELECT occurred_at, event_type, metadata, ip_address
FROM audit.auth_events
WHERE account_id = '<cuenta-sospechosa>'
ORDER BY occurred_at DESC
LIMIT 100;
```

O via API: `GET /api/admin/audit/events?cuentaId=...`.
