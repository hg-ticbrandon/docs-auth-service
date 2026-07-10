---
title: Clientes de servicio (admin)
description: CRUD de clientes de servicio M2M — crear, listar, rotar y revocar secretos, suspender y asignar roles.
---

> Para el formato de errores y envoltura de respuestas ver [Convenciones de la API](/api-reference/convenciones/).

Gestión de los **clientes de servicio** (identidades M2M). Todos los endpoints
requieren `Authorization: Bearer <accessToken>` de un usuario con el permiso
correspondiente:

- `auth:service-client:read` — ver/listar.
- `auth:service-client:write` — crear, rotar/revocar secretos, suspender, roles.

Para el flujo de uso desde un backend consumidor ver
[Comunicación backend-a-backend (M2M)](/integracion/m2m/).

## POST /api/admin/service-clients

Crea un cliente de servicio y genera su **primer secreto**. El `secret` en claro
se devuelve **una única vez** en esta respuesta: no se puede recuperar después
(solo se guarda su hash Argon2id). Si se pierde, hay que rotar.

**Request:**

```http
POST /api/admin/service-clients
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "clientId": "svc-flota",
  "nombre": "Servicio de Flota",
  "descripcion": "Backend de gestión de vehículos",
  "roles": [
    { "rolId": "9b1c...", "scope": { "almacenId": "lima-1" } }
  ]
}
```

- `clientId`: `^[a-z][a-z0-9-]{2,49}$` (ej. `svc-flota`). Único en el sistema.
- `roles`: opcional. `scope` por rol opcional (`{}` = rol global).

**Response 201:**

```json
{
  "datos": {
    "id": "8c1d...e9",
    "clientId": "svc-flota",
    "secret": "cs_a1b2c3d4e5f6..."
  }
}
```

> **Guardá el `secret` ahora.** Va al Secret Manager del backend consumidor. No
> vuelve a mostrarse.

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 400 | `AUTH_SERVICE_CLIENT_ID_INVALIDO` | `clientId` con formato inválido. |
| 409 | `AUTH_SERVICE_CLIENT_YA_EXISTE` | Ya existe un cliente con ese `clientId`. |
| 403 | `COMUN_PROHIBIDO` | Falta el permiso `auth:service-client:write`. |

## GET /api/admin/service-clients

Lista paginada de clientes de servicio. Nunca devuelve hashes ni secretos en
claro — solo metadata de cada secreto (id, etiqueta, activo, fechas).

**Query params:** `pagina`, `limite`, `estado` (`activo` | `suspendido`),
`busqueda` (por `clientId`/`nombre`).

**Response 200:** `{ datos: [...], paginacion: {...} }` — ver el shape del
recurso en `GET /:id`.

## GET /api/admin/service-clients/:id

Devuelve un cliente con sus roles y la metadata de sus secretos.

**Response 200:**

```json
{
  "datos": {
    "id": "8c1d...e9",
    "clientId": "svc-flota",
    "nombre": "Servicio de Flota",
    "descripcion": "Backend de gestión de vehículos",
    "estado": "activo",
    "roles": [{ "rolId": "9b1c...", "scope": { "almacenId": "lima-1" } }],
    "secretos": [
      {
        "id": "f2a1...",
        "etiqueta": null,
        "activo": true,
        "createdAt": "2026-07-10T12:00:00.000Z",
        "expiraEn": null,
        "revocadoEn": null
      }
    ],
    "createdAt": "2026-07-10T12:00:00.000Z",
    "updatedAt": "2026-07-10T12:00:00.000Z"
  }
}
```

**Errores:** `404 AUTH_SERVICE_CLIENT_NO_ENCONTRADO` si no existe.

## POST /api/admin/service-clients/:id/rotar-secreto

Genera un **secreto nuevo** sin invalidar el anterior de inmediato: permite
rotación con solapamiento (cero downtime). Un cliente admite **máximo 2 secretos
activos**. Opcionalmente, `graciaSegundos` programa la expiración del secreto
viejo (si no, queda activo hasta revocarlo a mano).

**Request:**

```http
POST /api/admin/service-clients/8c1d...e9/rotar-secreto
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "graciaSegundos": 3600 }
```

**Response 200:**

```json
{ "datos": { "secret": "cs_nuevo_valor..." } }
```

> Mismo trato que en la creación: el `secret` se muestra **una sola vez**.

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 409 | `AUTH_SERVICE_CLIENT_MAX_SECRETOS` | Ya hay 2 secretos activos. Revocá uno antes de rotar. |
| 404 | `AUTH_SERVICE_CLIENT_NO_ENCONTRADO` | El cliente no existe. |

## POST /api/admin/service-clients/:id/revocar-secreto/:secretoId

Revoca un secreto puntual (deja de servir para pedir tokens). **Response 204.**

## POST /api/admin/service-clients/:id/suspender

Suspende el cliente: futuros `POST /api/auth/token` fallan con `409`. Los tokens
ya emitidos siguen vivos hasta su `exp` (TTL corto, 10 min) — para matarlos al
instante, usar la blacklist de `jti`. **Response 204.**

## POST /api/admin/service-clients/:id/reactivar

Revierte la suspensión. **Response 204.**

## PUT /api/admin/service-clients/:id/roles

Reemplaza el conjunto de roles del cliente (con su `scope` por rol). Los tokens
nuevos reflejarán los permisos actualizados; los vigentes recién al vencer.
**Response 204.**

```http
PUT /api/admin/service-clients/8c1d...e9/roles
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "roles": [
    { "rolId": "9b1c...", "scope": {} },
    { "rolId": "3d4e...", "scope": { "almacenId": "lima-1" } }
  ]
}
```
