---
title: Asignaciones de rol (admin)
description: Asignar roles a cuentas, con scopes opcionales, editar el scope y revocar asignaciones.
---

> Para el formato de errores, paginación y envoltura de respuestas ver [Convenciones de la API](/api-reference/convenciones/).

Todos estos endpoints requieren JWT con el permiso `auth:role:assign`.

## GET /api/admin/cuentas/:cuentaId/roles

Lista las asignaciones de rol de una cuenta. Por defecto solo asignaciones **activas** (no revocadas, no expiradas); pasá `?historico=true` para incluir las históricas.

**Query params:**

| Param | Default | Descripción |
|---|---|---|
| `historico` | `false` | Si `true`, incluye asignaciones revocadas y expiradas. |

**Response 200:**

```json
{
  "datos": [
    {
      "id": "9a8b7c6d-5e4f-3a2b-1c0d-8f7e6d5c4b3a",
      "rolId": "f3a8c1d2-9b4e-4d6a-8c5f-2e1b3a7d9c4f",
      "scope": { "almacenId": "lima-1" },
      "asignadoEn": "2026-05-25T14:00:00.000Z",
      "expiraEn": null,
      "revocadaEn": null,
      "activa": true
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

Las asignaciones por cuenta son pocas (~5-10) → respuesta single-page.

## POST /api/admin/cuentas/:cuentaId/roles

Asigna un rol a una cuenta con un scope opcional.

**Request:**

```json
{
  "rolId": "f3a8c1d2-9b4e-4d6a-8c5f-2e1b3a7d9c4f",
  "scope": { "almacenId": "lima-1" },
  "expiraEn": "2026-12-31T23:59:59Z"
}
```

**Response 201:**

```json
{
  "datos": {
    "id": "9a8b7c6d-5e4f-3a2b-1c0d-8f7e6d5c4b3a"
  }
}
```

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 422 | `COMUN_VALIDACION_FALLIDA` | DTO inválido. |
| 404 | `AUTH_CUENTA_NO_ENCONTRADA` | La cuenta no existe. |
| 404 | `AUTH_ROL_NO_ENCONTRADO` | El rol no existe. |

**Notas:**

- `scope` es **JSONB libre**. Convenciones: `{ almacenId: 'lima-1' }`, `{ almacenIds: ['lima-1', 'lima-2'] }` (plural = array), `{}` = sin restricción (global).
- `expiraEn` es opcional. Si lo pasás, la asignación deja de surtir efecto después de esa fecha (pero permanece en DB para auditoría).
- Una cuenta puede tener **múltiples asignaciones del mismo rol** con scopes distintos.

## PATCH /api/admin/cuentas/:cuentaId/roles/:asignacionId/scope

Reemplaza el scope de una asignación **existente**, conservando su `id` y su fecha de asignación original. Útil para corregir el alcance de un rol sin tener que revocar y volver a asignar.

**Request:**

```json
{ "scope": { "almacenId": "lima-2" } }
```

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 422 | `COMUN_VALIDACION_FALLIDA` | `scope` no es un objeto JSON. |
| 404 | `AUTH_ASIGNACION_NO_ENCONTRADA` | La asignación no existe. |
| 409 | `AUTH_ASIGNACION_YA_REVOCADA` | La asignación está revocada — su scope ya no se puede editar. |

**Notas:**

- `scope` sigue las mismas convenciones que en POST: `{}` = sin restricción (rol global), `{ almacenId: 'lima-1' }`, `{ almacenIds: ['lima-1', 'lima-2'] }`.
- El cambio se registra en el audit log como `asignacion_scope_modificado`.
- Solo afecta a **nuevos** JWT: los tokens ya emitidos conservan el scope viejo hasta que expiran o se refrescan.

## POST /api/admin/cuentas/:cuentaId/roles/:asignacionId/revocar

Revoca una asignación específica.

**Request:**

```json
{ "razon": "Cambio de área del empleado" }
```

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 404 | `AUTH_ASIGNACION_NO_ENCONTRADA` | La asignación no existe. |
| 409 | `AUTH_ASIGNACION_YA_REVOCADA` | La asignación ya fue revocada anteriormente. |

> La asignación **NO se elimina**, solo se marca como `revocadaEn` con razón. Esto preserva el audit trail.

## Cómo aparece en el JWT

Tras un login, el JWT del usuario incluye en `roles[]` **todas las asignaciones activas** (no revocadas, no expiradas), serializadas como:

```json
"roles": [
  {
    "role": "ALMACENERO",
    "scope": { "almacenId": "lima-1" },
    "permisos": ["wms:inventario:read", "wms:inventario:write", "wms:recepcion:write", "wms:despacho:write"]
  },
  {
    "role": "ALMACENERO",
    "scope": { "almacenId": "lima-2" },
    "permisos": ["wms:inventario:read", "wms:inventario:write", "wms:recepcion:write", "wms:despacho:write"]
  },
  {
    "role": "FACTURADOR",
    "scope": {},
    "permisos": ["facturacion:emitir", "facturacion:read", "facturacion:notas-credito", "crm:cliente:read"]
  }
]
```

Cada item incluye los **permisos del rol resueltos al emitir el JWT**. La lib `@hagemsa/auth-guard` itera por estas asignaciones para autorizar el request.
