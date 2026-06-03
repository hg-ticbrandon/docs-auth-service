---
title: Roles (admin)
description: CRUD de roles y gestión de sus permisos.
---

> Para el formato de errores, paginación y envoltura de respuestas ver [Convenciones de la API](/api-reference/convenciones/).

Todos estos endpoints requieren JWT con el permiso `auth:role:manage`.

## Política de roles de sistema (`esSistema: true`)

Algunos roles vienen del seed marcados como **canónicos** (`esSistema: true`). Para ellos:

- ❌ **No se pueden renombrar** ni **cambiar la descripción** (PATCH).
- ❌ **No se pueden eliminar** (DELETE).
- ✅ **Sí se pueden** agregar o quitar permisos. El admin puede ajustar qué permisos tiene `GERENTE` o `ALMACENERO` sin perder la identidad canónica del rol.

## POST /api/admin/roles

Crea un nuevo rol. Toda la administración de roles se hace desde el frontend (no se tocan seeds ni la base de datos a mano), así que la API también permite crear roles de sistema.

**Request:**

```json
{
  "nombre": "ALMACENERO_LIMA",
  "descripcion": "Almacenero con scope geográfico a Lima.",
  "esSistema": false
}
```

> `esSistema` es **opcional** (default `false`). Si se envía `true`, el rol nace como **canónico**: su nombre y descripción quedan inmutables y no se puede eliminar (igual que los roles del seed), pero sus permisos sí se pueden ajustar. `nombre` y `descripcion` son obligatorios.

**Response 201:**

```json
{
  "datos": {
    "id": "f3a8c1d2-9b4e-4d6a-8c5f-2e1b3a7d9c4f"
  }
}
```

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 422 | `COMUN_VALIDACION_FALLIDA` | DTO inválido. |
| 400 | `AUTH_ROL_NOMBRE_INVALIDO` | Nombre no cumple UPPER_SNAKE_CASE o supera 50 chars. |
| 409 | `AUTH_ROL_YA_EXISTE` | Ya existe un rol con ese nombre. |

## GET /api/admin/roles

Lista los roles con **paginación estándar** (§7.5.3). Query params opcionales: `pagina` (default `1`) y `limite` (default `20`, máximo `100`). Ordenados por nombre ascendente.

**Response 200:**

```json
{
  "datos": [
    {
      "id": "f3a8c1d2-9b4e-4d6a-8c5f-2e1b3a7d9c4f",
      "nombre": "ALMACENERO",
      "descripcion": "Operador de almacén.",
      "esSistema": true,
      "permisos": ["wms:inventario:read", "wms:inventario:write"],
      "createdAt": "2026-05-26T10:00:00.000Z",
      "updatedAt": "2026-05-26T10:00:00.000Z"
    }
  ],
  "paginacion": {
    "pagina": 1,
    "limite": 20,
    "total": 11,
    "totalPaginas": 1,
    "tieneSiguiente": false,
    "tieneAnterior": false
  }
}
```

## GET /api/admin/roles/:id

Detalle de un rol con todos sus permisos.

**Response 200:**

```json
{
  "datos": {
    "id": "f3a8c1d2-9b4e-4d6a-8c5f-2e1b3a7d9c4f",
    "nombre": "ALMACENERO",
    "descripcion": "Operador de almacén.",
    "esSistema": true,
    "permisos": ["wms:inventario:read", "wms:inventario:write"],
    "createdAt": "2026-05-26T10:00:00.000Z",
    "updatedAt": "2026-05-26T10:00:00.000Z"
  }
}
```

**Errores:** `404` con `codigo: "AUTH_ROL_NO_ENCONTRADO"`.

## PATCH /api/admin/roles/:id

Actualiza nombre y/o descripcion del rol. Ambos opcionales — solo se aplican los campos provistos. Idempotente.

**Request (cualquiera de los dos campos basta):**

```json
{
  "nombre": "ALMACENERO_REGIONAL",
  "descripcion": "Operador con responsabilidad regional."
}
```

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 404 | `AUTH_ROL_NO_ENCONTRADO` | El id no corresponde a un rol. |
| 403 | `AUTH_ROL_DE_SISTEMA_PROTEGIDO` | Es un rol de sistema — su nombre y descripción son inmutables. |
| 409 | `AUTH_ROL_YA_EXISTE` | El nuevo nombre coincide con otro rol existente. |
| 400 | `AUTH_ROL_NOMBRE_INVALIDO` | Nuevo nombre no cumple UPPER_SNAKE_CASE. |

## DELETE /api/admin/roles/:id

Elimina un rol custom. Dos guardas:

1. **Roles de sistema** no se pueden eliminar — `403 AUTH_ROL_DE_SISTEMA_PROTEGIDO`.
2. **Roles con historial de asignaciones** (activas, expiradas o revocadas) no se pueden eliminar para preservar la auditoría — `409 AUTH_ROL_EN_USO`. El admin debe asegurarse de no tener asignaciones referenciando el rol antes de borrarlo.

Cuando un rol se elimina exitosamente, sus filas en `role_permissions` cascadean (se borran por FK).

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 404 | `AUTH_ROL_NO_ENCONTRADO` | El id no corresponde a un rol. |
| 403 | `AUTH_ROL_DE_SISTEMA_PROTEGIDO` | Es un rol canónico. |
| 409 | `AUTH_ROL_EN_USO` | El rol tiene asignaciones en el historial. `detalle` indica cuántas. |

## POST /api/admin/roles/:id/permisos

Agrega un permiso al rol. **Funciona también en roles de sistema** — la política canónica protege nombre y descripción, no la composición de permisos.

**Request:**

```json
{ "codigoPermiso": "wms:inventario:read" }
```

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 404 | `AUTH_ROL_NO_ENCONTRADO` | El id no corresponde a un rol. |
| 404 | `AUTH_PERMISO_NO_ENCONTRADO` | El código de permiso no existe en el catálogo. |
| 400 | `AUTH_CODIGO_PERMISO_INVALIDO` | Código mal formado (debe ser `modulo:accion` o `modulo:recurso:accion`). |

> Si el rol ya tiene ese permiso, el endpoint es idempotente y responde 204 igual.

## DELETE /api/admin/roles/:id/permisos/:codigo

Quita un permiso del rol. También funciona en roles de sistema.

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 404 | `AUTH_ROL_NO_ENCONTRADO` | El id no corresponde a un rol. |
| 400 | `AUTH_CODIGO_PERMISO_INVALIDO` | Código mal formado en la URL. |

> Si el rol no tenía ese permiso, el endpoint es idempotente y responde 204.

## Roles del sistema (seed inicial)

Todos los roles del seed son `esSistema: true`. Su nombre y descripción son inmutables, pero podés ajustar sus permisos desde la UI o el endpoint correspondiente.

| Rol | Permisos principales |
|---|---|
| `SUPER_ADMIN` | **Todos** los permisos del catálogo (el seed le asigna cada permiso existente) |
| `GERENTE` | **Todos** los permisos terminados en `:read` (lectura general de toda la org) |
| `JEFE_ALMACEN` | `wms:*`, `flota:vehiculo:read`, `mantenimiento:reportes:read` |
| `ALMACENERO` | `wms:inventario:read/write`, `wms:recepcion:write`, `wms:despacho:write` |
| `OPERADOR_FLOTA` | `flota:vehiculo:read/write`, `flota:asignacion:write`, `flota:gps:read`, `mantenimiento:reportes:read` |
| `CONTADOR` | `contabilidad:*`, `facturacion:read`, `rrhh:planilla:read` |
| `FACTURADOR` | `facturacion:emitir/read/notas-credito`, `crm:cliente:read` |
| `VENDEDOR` | `crm:*`, `facturacion:emitir`, `tracking:carga:read` |
| `RRHH` | `rrhh:*` |
| `CHOFER`, `CLIENTE`, `PROVEEDOR` | sin permisos por ahora (portales futuros) |

(El catálogo exacto vive en `prisma/seed.ts` del Auth Service.)
