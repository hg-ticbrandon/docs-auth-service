---
title: Permisos (admin)
description: CRUD del catálogo de permisos.
---

> Para el formato de errores, paginación y envoltura de respuestas ver [Convenciones de la API](/api-reference/convenciones/).

Todos estos endpoints requieren JWT con el permiso `auth:role:manage`.

## GET /api/admin/permisos

Lista todos los permisos del catálogo.

**Query params:**

| Param | Default | Descripción |
|---|---|---|
| `modulo` | — | Filtra por módulo (`wms`, `flota`, `auth`, etc.). |

**Response 200:**

```json
{
  "datos": [
    {
      "id": "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "codigo": "wms:inventario:read",
      "modulo": "wms",
      "descripcion": "Ver inventario"
    },
    {
      "id": "b2c3d4e5-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
      "codigo": "wms:inventario:write",
      "modulo": "wms",
      "descripcion": "Modificar inventario"
    }
  ],
  "paginacion": {
    "pagina": 1,
    "limite": 32,
    "total": 32,
    "totalPaginas": 1,
    "tieneSiguiente": false,
    "tieneAnterior": false
  }
}
```

El catálogo completo (~30-50 permisos) se devuelve en una sola página.

## POST /api/admin/permisos

Crea un nuevo permiso en el catálogo.

**Request:**

```json
{
  "codigo": "wms:devolucion:write",
  "descripcion": "Registrar devoluciones en almacén",
  "modulo": "wms"
}
```

- `codigo` debe seguir el formato `modulo:accion` o `modulo:recurso:accion`. Solo minúsculas, dígitos y guion. Cada segmento empieza con letra. Máximo 3 segmentos.
- `modulo` es opcional. Si se omite, se infiere del primer segmento del código.

**Response 201:**

```json
{
  "datos": {
    "id": "c3d4e5f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f"
  }
}
```

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 422 | `COMUN_VALIDACION_FALLIDA` | DTO inválido (faltan campos, longitud, formato del codigo). |
| 400 | `AUTH_CODIGO_PERMISO_INVALIDO` | Código no cumple el formato del dominio. |
| 409 | `AUTH_PERMISO_YA_EXISTE` | Ya existe un permiso con ese código. Para editar la descripción usar `PATCH /api/admin/permisos/:id`. |

## PATCH /api/admin/permisos/:id

Actualiza la descripción de un permiso existente. El **código** y el **módulo** son inmutables — para cambiarlos hay que crear un permiso nuevo y eliminar el viejo.

**Request:**

```json
{
  "descripcion": "Registrar devoluciones de mercadería (compras y ventas)."
}
```

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 404 | `AUTH_PERMISO_NO_ENCONTRADO` | El id no corresponde a un permiso. |
| 422 | `COMUN_VALIDACION_FALLIDA` | DTO inválido. |

## DELETE /api/admin/permisos/:id

Elimina un permiso del catálogo. Bloqueado si algún rol lo tiene asignado.

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 404 | `AUTH_PERMISO_NO_ENCONTRADO` | El id no corresponde a un permiso. |
| 409 | `AUTH_PERMISO_EN_USO` | El permiso está asignado a uno o más roles. `detalle` indica cuántos. El admin debe quitarlo de los roles primero. |

## Convención de códigos

`modulo:accion` o `modulo:recurso:accion` en minúsculas, dígitos y guion. Cada segmento empieza con letra. Ejemplos: `wms:inventario:read`, `facturacion:emitir`, `auth:role:assign`.

Ver [Permisos y scopes](/integracion/permisos-scopes/#convención-de-códigos-de-permiso) en la guía de integración para el detalle de qué módulos existen y cómo se nombran.

## Relación con el seed

El `prisma/seed.ts` del Auth Service también puede crear permisos (vía `prisma.permission.upsert`). Eso sigue funcionando — el seed inserta el catálogo base la primera vez y se puede re-ejecutar sin error.

Para agregar permisos en runtime, ahora se puede usar `POST /api/admin/permisos` directamente desde la UI admin sin tocar el seed. Si querés que el nuevo permiso aparezca también en futuros despliegues limpios, agregalo además al `seed.ts`.
