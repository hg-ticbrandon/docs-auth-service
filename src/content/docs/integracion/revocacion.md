---
title: Revocación y logout
description: Cómo propagar la revocación de sesiones a tu backend.
---

## El problema

Un JWT firmado es válido hasta su `exp` (1h por default). Si un usuario hace logout o un admin le revoca la sesión, ¿cómo se entera tu backend de que el JWT que le presentan ya no debe aceptarse?

## La solución: blacklist + fail-closed

Cuando un JWT se revoca (logout, admin revoca, reuso detectado), el Auth Service guarda el `jti` en una tabla `sessions.revoked_jtis` hasta que el JWT expire.

Tu backend consulta esa blacklist en cada request:

```
GET /api/internal/jti/:jti/revoked
Headers: X-Internal-Secret: <secret>

Response: { "jti": "...", "revoked": false }  → token válido
          { "jti": "...", "revoked": true }   → 401 Sesión revocada
```

La lib `@hagemsa/auth-guard` hace esto por vos cuando seteás `enableBlacklistCheck: true`.

## Cache de 30 segundos

Para evitar golpear al Auth Service en cada request, la lib cachea el resultado por `jti` durante 30 segundos (configurable).

**Esto significa:** desde el logout hasta que tu backend rechaza el token, hay una ventana de **hasta 30 segundos**. Aceptable para la mayoría de casos. Si necesitás revocación instantánea, podés:

- Bajar `blacklistCacheTtlSeconds` a `0` (sin cache, +1 fetch por request).
- Usar Server-Sent Events o WebSockets para invalidación push (no implementado aún).

## Fail-closed

Si el endpoint `/api/internal/jti/:jti/revoked` no responde (Auth Service caído, timeout, 401 por secret mal configurado), la lib **asume revocado** y devuelve **401** al cliente.

> **Por qué fail-closed:** preferimos rechazar accesos válidos por unos segundos que dejar pasar sesiones comprometidas durante un outage.

## Logout coordinado

Cuando un usuario hace logout en tu backend:

1. Llamás al Auth Service:
   ```http
   POST /api/auth/logout
   Authorization: Bearer <jwt>
   ```
2. El Auth Service:
   - Marca el `jti` actual en la blacklist hasta su `exp`.
   - Revoca el refresh token (y toda su familia) asociado a esa sesión.
   - Audita un evento `logout`.
3. En **≤30 segundos**, tu backend (y todos los otros del ecosistema) rechaza el JWT con 401.

## Logout de "todas las sesiones"

Para forzar que un usuario tenga que volver a loguear en **todos sus dispositivos**, un admin con `auth:sesion:revocar` puede:

```http
GET /api/admin/cuentas/:cuentaId/sesiones        # listar
POST /api/admin/sesiones/:id/revocar              # revocar una específica
```

Para revocar todas, repetir el POST por cada sesión activa.

## Cuándo NO usar blacklist

Si tu backend tiene SLA estricto de latencia (< 5ms p99) y el access token TTL es corto (≤ 15 min), podés saltarte la blacklist:

```typescript
enableBlacklistCheck: false
```

Ventana de revocación = TTL del access token. El refresh con rotación bloquea futuras emisiones.

## Próximo paso

[Errores comunes →](/integracion/errores-comunes/)
