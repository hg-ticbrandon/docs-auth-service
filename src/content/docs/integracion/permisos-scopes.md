---
title: Permisos y scopes
description: Cómo modelar autorización fina con roles, permisos y scopes.
---

## Diferencia entre rol, permiso y scope

- **Rol** — agrupa permisos. Ej: `ALMACENERO` incluye `wms:inventario:read` + `wms:inventario:write`.
- **Permiso** — acción atómica sobre un recurso. Ej: `wms:inventario:write`.
- **Scope** — restringe la asignación de un rol a un sub-dominio. Ej: scope `{ almacenId: 'lima-1' }` limita el rol al almacén de Lima 1.

## Convención de códigos de permiso

Formato obligatorio: `<modulo>:<recurso>:<accion>`.

- **modulo:** corto, en minúsculas. Ej. `wms`, `despachos`, `facturacion`, `auth`.
- **recurso:** el sustantivo. Ej. `inventario`, `factura`, `guia`, `cuenta`.
- **accion:** el verbo. Ej. `read`, `write`, `create`, `delete`, `firmar`.

Ejemplos válidos:

```
wms:inventario:read
wms:inventario:write
wms:despacho:write
facturacion:emitir
auth:account:write
auth:role:assign
```

## Catálogo de permisos

Cada permiso vive en la tabla `authorization.permissions` del Auth Service. Solo el equipo del Auth Service (vía el seed o `/api/admin/permisos`) puede agregar nuevos códigos.

**Antes de usar un permiso nuevo en tu backend, coordiná con el equipo de plataforma para crearlo.**

## Cómo asignar permisos a un rol

Quien tenga el permiso `auth:role:manage` puede modificar permisos vía:

```http
POST /api/admin/roles/:id/permisos
Authorization: Bearer <jwt-admin>
Content-Type: application/json

{ "codigoPermiso": "wms:inventario:read" }
```

## Cómo asignar un rol con scope a una cuenta

```http
POST /api/admin/cuentas/:cuentaId/roles
Authorization: Bearer <jwt-admin>
Content-Type: application/json

{
  "rolId": "<uuid-del-rol>",
  "scope": { "almacenId": "lima-1" }
}
```

Si una cuenta tiene **múltiples asignaciones del mismo rol** con scopes distintos, todas aparecen en el JWT (`roles[]`).

## Cómo evalúa la lib

Cuando un endpoint requiere `wms:inventario:write` con scope `almacenId`:

1. La lib lee `roles[]` del JWT. Cada item trae `{ role, scope, permisos }`.
2. Encuentra los roles cuyo `permisos[]` incluye el permiso requerido.
3. De esos, busca uno con scope compatible (vacío = global, o con el `almacenId` del path).
4. Si encuentra → pasa. Si no → 403.

> El JWT trae los permisos del rol embebidos al momento de su emisión, así que la lib autoriza **sin ningún round-trip** al Auth Service. **Trade-off:** cambios al catálogo de permisos no se reflejan hasta que el access token expira y se refresca (~TTL del access). Si necesitás ver los permisos actuales de un rol (admin/auditoría), consultá `GET /api/admin/roles/:id`, que los devuelve en `datos.permisos`.

## Patrones comunes

### Permiso global (sin scope)

Un rol `RRHH` con permiso `auth:account:write` puede gestionar cualquier cuenta.

### Permiso scopeado a un solo recurso

Un rol `ALMACENERO` con scope `{ almacenId: 'lima-1' }` solo opera ese almacén.

### Permiso scopeado a varios recursos (plural)

Convención: la **clave en plural termina en `s`** y el valor es un array.

```json
{ "almacenIds": ["lima-1", "arequipa-1"] }
```

Y en el endpoint:

```typescript
@RequireScope({ paramKey: 'almacenId', scopeKey: 'almacenId' })
```

(scopeKey en singular; la lib intenta primero `scopeKey` como string, después `scopeKey + 's'` como array).

## Próximo paso

[Revocación y logout →](/integracion/revocacion/)
