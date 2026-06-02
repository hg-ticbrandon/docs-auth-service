---
title: Cuentas (admin)
description: CRUD y gestión de estado de cuentas. Requiere permisos auth:account:*.
---

> Para el formato de errores, paginación y envoltura de respuestas ver [Convenciones de la API](/api-reference/convenciones/).

Todos estos endpoints requieren JWT con permisos `auth:account:*`.

## POST /api/admin/cuentas

Crea una cuenta nueva. Requiere `auth:account:write`.

**Request:**

```http
POST /api/admin/cuentas
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "email": "nueva@hagemsa.com",
  "nombreUsuario": "nueva.cuenta",
  "nombreCompleto": "Nueva Cuenta",
  "tipoCuenta": "interno",
  "documentoIdentidad": "12345678"
}
```

> `nombreUsuario` es **obligatorio y único**: 3-30 caracteres, empieza con letra, solo letras, dígitos, punto, guion o guion bajo (sin `@`). Se normaliza a minúsculas y es **inmutable**. Sirve como identificador alternativo al email en el login.
>
> `documentoIdentidad` es **opcional** (string, máximo 50 caracteres). Los demás campos (`email`, `nombreUsuario`, `nombreCompleto`, `tipoCuenta`) son obligatorios.

**Response 201:**

```json
{
  "datos": {
    "id": "f98fd200-5db0-40d5-a942-e4a484579b82"
  }
}
```

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 422 | `COMUN_VALIDACION_FALLIDA` | DTO inválido (con array `errores` por campo; incluye formato de `nombreUsuario`). |
| 409 | `AUTH_EMAIL_YA_REGISTRADO` | Ya existe una cuenta con ese email. |
| 409 | `AUTH_NOMBRE_USUARIO_YA_REGISTRADO` | Ya existe una cuenta con ese nombre de usuario. |
| 403 | `COMUN_PROHIBIDO` | JWT sin permiso `auth:account:write`. |

## GET /api/admin/cuentas

Lista cuentas paginadas. Requiere `auth:account:read`.

**Request:**

```http
GET /api/admin/cuentas?pagina=1&limite=20&estado=activo&tipoCuenta=interno
Authorization: Bearer <jwt>
```

**Query params:**

| Param | Default | Rango | Descripción |
|---|---|---|---|
| `pagina` | `1` | ≥ 1 | Página 1-based. |
| `limite` | `20` | 1–100 | Items por página. |
| `estado` | — | `activo` / `suspendido` / `inactivo` | Filtro opcional. |
| `tipoCuenta` | — | `interno` / `cliente` / `proveedor` | Filtro opcional. |
| `busqueda` | — | string | Texto para buscar por email, nombre de usuario o nombre completo. |

**Response 200:**

```json
{
  "datos": [
    {
      "id": "8c1d8a4f-3b2e-4a5d-9c7e-1b3d5f7a9c2e",
      "email": "juan@hagemsa.com",
      "nombreUsuario": "juan.perez",
      "nombreCompleto": "Juan Pérez",
      "tipoCuenta": "interno",
      "estado": "activo",
      "documentoIdentidad": "12345678",
      "createdAt": "2026-05-25T14:00:00.000Z",
      "updatedAt": "2026-05-25T14:00:00.000Z"
    }
  ],
  "paginacion": {
    "pagina": 1,
    "limite": 20,
    "total": 42,
    "totalPaginas": 3,
    "tieneSiguiente": true,
    "tieneAnterior": false
  }
}
```

Lista vacía: `datos: []`, `total: 0`, status `200`.

## GET /api/admin/cuentas/:id

Detalle de una cuenta. Requiere `auth:account:read`.

**Response 200:**

```json
{
  "datos": {
    "id": "8c1d8a4f-3b2e-4a5d-9c7e-1b3d5f7a9c2e",
    "email": "juan@hagemsa.com",
    "nombreUsuario": "juan.perez",
    "nombreCompleto": "Juan Pérez",
    "tipoCuenta": "interno",
    "estado": "activo",
    "documentoIdentidad": "12345678",
    "createdAt": "2026-05-25T14:00:00.000Z",
    "updatedAt": "2026-05-25T14:00:00.000Z"
  }
}
```

**Errores:** `404` con `codigo: "AUTH_CUENTA_NO_ENCONTRADA"`.

## PATCH /api/admin/cuentas/:id

Actualiza nombre o documento de identidad. Requiere `auth:account:write`.

**Request:**

```json
{
  "nombreCompleto": "Nuevo Nombre",
  "documentoIdentidad": "12345678"
}
```

**Response 204** (sin body).

**Errores:** `404` `AUTH_CUENTA_NO_ENCONTRADA`, `409` `AUTH_CUENTA_INACTIVA`.

## DELETE /api/admin/cuentas/:id

Desactiva la cuenta (soft delete: marca `estado=inactivo`). Requiere `auth:account:write`.

**Request:**

```json
{ "razon": "Solicitud del usuario" }
```

**Response 204** (sin body).

**Errores:** `404` `AUTH_CUENTA_NO_ENCONTRADA`, `409` `AUTH_CUENTA_INACTIVA` (ya inactiva).

## POST /api/admin/cuentas/:id/suspender

Suspende una cuenta activa. Requiere `auth:account:write`.

**Request:**

```json
{ "razon": "Solicitud del usuario" }
```

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 404 | `AUTH_CUENTA_NO_ENCONTRADA` | El id no corresponde a una cuenta. |
| 409 | `AUTH_CUENTA_INACTIVA` | La cuenta está inactiva, no puede suspenderse. |
| 409 | `AUTH_CUENTA_SUSPENDIDA` | La cuenta ya está suspendida. |

## POST /api/admin/cuentas/:id/reactivar

Reactiva una cuenta suspendida. Requiere `auth:account:write`.

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 404 | `AUTH_CUENTA_NO_ENCONTRADA` | El id no corresponde a una cuenta. |
| 409 | `AUTH_CUENTA_INACTIVA` | La cuenta está inactiva, no puede reactivarse. |
| 409 | `AUTH_CUENTA_NO_SUSPENDIDA` | La cuenta nunca fue suspendida. |
