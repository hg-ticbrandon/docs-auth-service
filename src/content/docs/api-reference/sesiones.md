---
title: Sesiones (admin)
description: Listar y revocar sesiones activas de cuentas.
---

> Para el formato de errores, paginación y envoltura de respuestas ver [Convenciones de la API](/api-reference/convenciones/).

## GET /api/admin/cuentas/:cuentaId/sesiones

Lista las sesiones activas de una cuenta. Requiere `auth:account:read`.

**Response 200:**

```json
{
  "datos": [
    {
      "id": "5b8aa5a2-d2c8-72e8-321c-f3713faf9b9e",
      "jti": "9a8b7c6d-5e4f-3a2b-1c0d-8f7e6d5c4b3a",
      "userAgent": "Mozilla/5.0...",
      "ipAddress": "10.0.1.42",
      "emitidaEn": "2026-05-25T14:00:00.000Z",
      "expiraEn": "2026-05-25T15:00:00.000Z"
    }
  ],
  "paginacion": {
    "pagina": 1,
    "limite": 3,
    "total": 3,
    "totalPaginas": 1,
    "tieneSiguiente": false,
    "tieneAnterior": false
  }
}
```

Las sesiones activas por cuenta son pocas (~3-5) → respuesta single-page.

> Solo se listan sesiones cuyo `expiraEn` aún no pasó. Las expiradas se limpian con el cron job de cleanup.

## POST /api/admin/sesiones/:id/revocar

Revoca una sesión específica. Requiere `auth:account:write`.

**Request:**

```json
{ "razon": "Sospecha de compromiso" }
```

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 404 | `AUTH_SESION_NO_ENCONTRADA` | El id no corresponde a una sesión. |

**Efectos:**

1. La sesión queda con `revocadaEn` + razón.
2. El `jti` se agrega a `sessions.revoked_jtis` hasta su `expiraEn`.
3. El refresh token asociado se revoca (y toda su familia).
4. Se emite evento de auditoría `sesion_revocada_admin`.
5. Los backends del ecosistema reciben el efecto en **≤30 segundos** (TTL del BlacklistChecker cache).

## Revocar todas las sesiones de una cuenta

No hay un endpoint "revocar todas" — hay que iterar:

```bash
# 1. Listar
GET /api/admin/cuentas/<cuentaId>/sesiones

# 2. Por cada item del array `datos`, revocar
POST /api/admin/sesiones/<id>/revocar
```

Si esto es frecuente, considerar agregarlo como endpoint compuesto en el futuro.

## Casos de uso típicos

- **Empleado deja la empresa:** suspender la cuenta + revocar todas sus sesiones activas.
- **Cuenta comprometida:** revocar todas las sesiones + resetear password.
- **Cambio de scope sensible:** revocar sesiones para forzar re-login con los nuevos permisos en el JWT.
