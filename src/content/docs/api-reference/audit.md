---
title: Auditoría (admin)
description: Consultar eventos del log append-only.
---

> Para el formato de errores, paginación y envoltura de respuestas ver [Convenciones de la API](/api-reference/convenciones/).

## GET /api/admin/audit/events

Lista eventos de auditoría paginados. Requiere `auth:account:read`.

**Query params:**

| Param | Default | Rango | Descripción |
|---|---|---|---|
| `pagina` | `1` | ≥ 1 | Página 1-based. |
| `limite` | `20` | 1–100 | Items por página. |
| `cuentaId` | — | UUID | Filtra eventos de una cuenta. |
| `tipo` | — | string | Filtra por tipo de evento (ej. `login_fallido`). |
| `desde` | — | ISO timestamp | Desde esta fecha (inclusive). |
| `hasta` | — | ISO timestamp | Hasta esta fecha (exclusive). |

**Response 200:**

```json
{
  "datos": [
    {
      "id": "1f2e3d4c-5b6a-7d8c-9e0f-1a2b3c4d5e6f",
      "cuentaId": "8c1d8a4f-3b2e-4a5d-9c7e-1b3d5f7a9c2e",
      "tipo": "login_exitoso",
      "metadata": {
        "jti": "5b8aa5a2d2c872e8321cf3713faf9b9e",
        "ipAddress": "10.0.1.42",
        "userAgent": "Mozilla/5.0..."
      },
      "ipAddress": "10.0.1.42",
      "userAgent": "Mozilla/5.0...",
      "ocurridoEn": "2026-05-25T14:00:00.000Z"
    }
  ],
  "paginacion": {
    "pagina": 1,
    "limite": 20,
    "total": 1247,
    "totalPaginas": 63,
    "tieneSiguiente": true,
    "tieneAnterior": false
  }
}
```

## Tipos de evento

15 tipos canónicos. Ver lista completa en [Glosario](/getting-started/glosario/#tipos-de-evento-de-auditoría).

Los más consultados en investigaciones:

| Tipo | Cuándo se emite |
|---|---|
| `login_exitoso` | Login con credenciales correctas |
| `login_fallido` | Credenciales inválidas (incluye password mala + cuenta inexistente) |
| `logout` | El usuario hace logout explícito |
| `refresh_reuso_detectado` | Se detectó reuso de refresh token → familia revocada |
| `cuenta_suspendida` | Un admin suspendió una cuenta |
| `password_cambiado` | Password reseteado o cambiado |
| `rol_asignado` | Se asignó un rol a una cuenta |
| `sesion_revocada` | Admin revocó una sesión específica |

## Regla inquebrantable: append-only

La tabla `audit.auth_events` **solo recibe INSERTs**. Nunca UPDATE ni DELETE. Esto está enforced por:

- Convención del equipo (ver `CLAUDE.md §5.3`).
- El repositorio del aggregate `EventoAuth` **no expone método `actualizar` ni `eliminar`**.
- Eventualmente, se podría reforzar con permisos PG (revocar UPDATE/DELETE al usuario runtime).

## Retención

Los eventos se mantienen **indefinidamente** por defecto. Para compliance puede definirse una política de archivado (export a BigQuery + delete en PG), pero no está implementada aún.

## Búsqueda eficiente

Los índices más usados:

- `(account_id)` — eventos de una cuenta
- `(event_type)` — eventos por tipo
- `(occurred_at DESC)` — eventos recientes (default sort)
