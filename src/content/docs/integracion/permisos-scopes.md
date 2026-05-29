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

Cada permiso vive en la tabla `authorization.permissions` del Auth Service y se
administra en runtime con `POST /api/admin/permisos` (o desde la UI admin del
frontend) por cuentas con el permiso `auth:role:manage`. El `prisma/seed.ts` solo
provee un catálogo base por default; no es la fuente de verdad.

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

## Ejemplo completo: del JWT al 200 / 403

Supongamos este endpoint protegido por permiso **y** scope de almacén:

```typescript
@Get('almacen/:almacenId')
@RequirePermission('wms:inventario:read')
@RequireScope({ paramKey: 'almacenId', scopeKey: 'almacenId' })
verInventario(@Param('almacenId') almacenId: string) { /* ... */ }
```

El guard mira **lo que viene embebido en el JWT** (no consulta nada). Veamos el
mismo endpoint contra distintos tokens.

### Caso A — scope acotado a un almacén

Payload del access token (decodificado) de un almacenero del almacén `001`:

```json
{
  "sub": "fda38e59-f9aa-4d1c-add4-16f2fbec02f9",
  "email": "almacenero001.prueba@hagemsa.com",
  "type": "interno",
  "name": "Almacenero Almacén 001",
  "roles": [
    {
      "role": "ALMACENERO",
      "scope": { "almacenId": "001" },
      "permisos": ["wms:inventario:read", "wms:inventario:write", "wms:recepcion:write", "wms:despacho:write"]
    }
  ],
  "iat": 1748000000,
  "exp": 1748003600
}
```

| Request | Evaluación del guard | Resultado |
|---|---|---|
| `GET /almacen/001` | El rol concede `wms:inventario:read` ✓ y su `scope.almacenId` (`"001"`) == param (`"001"`) ✓ | **200** |
| `GET /almacen/002` | Concede el permiso ✓ pero `"001"` != `"002"` ✗ → ningún rol más concede | **403** |

### Caso B — scope global (`{}`)

Payload de un gerente (rol con scope vacío):

```json
{
  "email": "gerente.prueba@hagemsa.com",
  "roles": [
    {
      "role": "GERENTE",
      "scope": {},
      "permisos": ["wms:inventario:read", "facturacion:read", "rrhh:planilla:read", "..."]
    }
  ]
}
```

| Request | Evaluación | Resultado |
|---|---|---|
| `GET /almacen/001` | scope `{}` = global → pasa cualquier almacén | **200** |
| `GET /almacen/999` | scope `{}` = global → pasa | **200** |

> Scope vacío `{}` significa "sin restricción de contexto": el permiso aplica a
> todos los almacenes.

### Caso C — scope plural (varios almacenes)

Convención: clave en **plural** (`almacenIds`) con un **array**. La lib, al no
encontrar `scope.almacenId` como string, prueba `scope.almacenIds` como array y
verifica inclusión:

```json
{
  "roles": [
    {
      "role": "ALMACENERO",
      "scope": { "almacenIds": ["001", "002"] },
      "permisos": ["wms:inventario:read", "wms:inventario:write"]
    }
  ]
}
```

| Request | Evaluación | Resultado |
|---|---|---|
| `GET /almacen/001` | `["001","002"]` incluye `"001"` ✓ | **200** |
| `GET /almacen/002` | incluye `"002"` ✓ | **200** |
| `GET /almacen/003` | no incluye `"003"` ✗ | **403** |

### Caso D — múltiples asignaciones del mismo rol

Una cuenta puede tener el mismo rol asignado varias veces con scopes distintos;
**todas** llegan en `roles[]` y el guard pasa si **alguna** matchea:

```json
{
  "roles": [
    { "role": "ALMACENERO", "scope": { "almacenId": "001" }, "permisos": ["wms:inventario:read"] },
    { "role": "ALMACENERO", "scope": { "almacenId": "002" }, "permisos": ["wms:inventario:read"] }
  ]
}
```

`GET /almacen/001` → matchea la primera asignación → **200**.
`GET /almacen/002` → matchea la segunda → **200**.
`GET /almacen/003` → ninguna matchea → **403**.

> Estos casos son exactamente los que valida el backend de prueba de referencia
> (`auth-test-consumer`): SUPER_ADMIN y GERENTE (scope `{}`) pasan cualquier
> almacén; el almacenero scopeado a `001` recibe 403 en `/almacen/002`.

## Próximo paso

[Revocación y logout →](/integracion/revocacion/)
