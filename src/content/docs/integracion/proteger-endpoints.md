---
title: Proteger endpoints
description: Decoradores de @hagemsa/auth-guard para controlar acceso por endpoint.
---

Con `JwtAuthGuard` registrado globalmente, **todos los endpoints exigen un JWT válido por default**. Solo los que marques con `@Public()` quedan abiertos.

## Principio: protegé por PERMISO, nunca por ROL

Este es el concepto central de RBAC y la regla más importante de esta página:

> Un endpoint declara la **capacidad** que requiere (ej. `wms:inventario:read`),
> **nunca un nombre de rol**. El guard verifica que alguno de los roles del JWT
> conceda ese permiso, sin importar cuál.

Los **roles son solo "bolsas de permisos"** que viven en la **base de datos del
Auth Service** y se administran **en runtime**: crear/editar/eliminar roles,
agregar o quitar permisos, y asignar roles con scope a las cuentas, todo vía los
endpoints `/api/admin/roles`, `/api/admin/permisos` y `/api/admin/cuentas/:id/roles`
— el frontend ya tiene una UI de administración completa para esto (roles,
usuarios, permisos, scopes). El `prisma/seed.ts` solo siembra un **template
inicial por default**; **no** es "el catálogo". Tu backend consumidor no los
conoce ni debe conocerlos.

**Por qué nunca hardcodear un rol en el endpoint:**

- **Desacople:** si mañana se crea un rol nuevo (`SUPERVISOR_WMS`) y se le da
  `wms:inventario:read`, entra al endpoint **sin tocar ni redeployar tu backend**.
  Si protegieras por rol, cada rol nuevo sería un cambio de código.
- **Muchos roles → un permiso:** `wms:inventario:read` puede concederlo
  SUPER_ADMIN, GERENTE, JEFE_ALMACEN y ALMACENERO a la vez. Enumerar roles en el
  endpoint sería frágil y redundante.
- **Fuente de verdad única:** el mapeo rol→permiso lo administra el Auth Service,
  no se reparte por cada backend.

> **"¿Qué roles pueden entrar a este endpoint?"** No se responde desde el código
> del consumidor (a propósito): se consulta el Auth Service —
> `GET /api/admin/roles/:id` o la UI de administración del frontend. Como roles,
> permisos y asignaciones se crean y editan en runtime, hardcodear esa lista en
> tu backend quedaría desactualizado apenas un admin ajuste algo.

```typescript
// ✓ Correcto: declara la capacidad
@RequirePermission('wms:inventario:read')

// ✗ Incorrecto: la lib no tiene un @RequireRole, y no debería —
//   acoplaría el backend a nombres de rol que cambian en runtime.
```

## @Public

Endpoint accesible sin JWT (health, webhooks externos verificados por otro mecanismo, login del propio servicio, etc.).

```typescript
import { Controller, Get } from '@nestjs/common';
import { Public } from '@hagemsa/auth-guard';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health() {
    return { ok: true };
  }
}
```

## @CurrentUser

Extrae el contexto del usuario autenticado (decodificado del JWT verificado).

```typescript
import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type AuthContext } from '@hagemsa/auth-guard';

@Controller('perfil')
export class PerfilController {
  @Get()
  miPerfil(@CurrentUser() user: AuthContext) {
    return {
      cuentaId: user.accountId,
      email: user.email,
      tipo: user.type,
      roles: user.roles,
    };
  }
}
```

`AuthContext` también expone `name`, `jti`, `expiresAt` y estos campos opcionales:

- `codigoSocio` y `codigoCuenta` — códigos internos de la **cuenta** (para generación de códigos en PDFs), alfanuméricos de 1 a 20. Presentes solo si la cuenta los tiene seteados. **Son independientes del socio**: una cuenta puede tener códigos sin estar vinculada a BC01.
- `socioExternoId`, `socioNombre` y `socioDocumento` — presentes **solo si la cuenta está vinculada a un socio de negocio (BC01)**; los dos últimos vienen del snapshot capturado al vincular.

En cuentas sin códigos / sin socio, los campos respectivos llegan como `undefined`.

## @RequirePermission

Exige que el JWT incluya un rol cuyo set de permisos contiene el código indicado.

```typescript
import { Controller, Get, Put, Param } from '@nestjs/common';
import { RequirePermission } from '@hagemsa/auth-guard';

@Controller('inventario')
export class InventarioController {
  @Get()
  @RequirePermission('wms:inventario:read')
  listar() {
    return [];
  }

  @Put(':id')
  @RequirePermission('wms:inventario:write')
  actualizar(@Param('id') id: string) {
    return { id, ok: true };
  }
}
```

Si el usuario no tiene un rol que conceda ese permiso → **403 Forbidden**.

## @RequireScope

Combina con `@RequirePermission` para limitar el rol a un sub-dominio (ej. un almacén específico).

```typescript
@Get(':almacenId/items')
@RequirePermission('wms:inventario:read')
@RequireScope({ paramKey: 'almacenId', scopeKey: 'almacenId' })
listarPorAlmacen(@Param('almacenId') almacenId: string) {
  return [];
}
```

Comportamiento:

- Si el rol tiene `scope: {}` (global) → pasa siempre.
- Si el rol tiene `scope: { almacenId: 'lima-1' }` y el path es `/inventario/lima-1/items` → pasa.
- Si el rol tiene `scope: { almacenId: 'lima-1' }` y el path es `/inventario/lima-2/items` → **403**.
- Si el rol tiene `scope: { almacenIds: ['lima-1', 'arequipa-1'] }` (plural = array) → pasa con cualquiera de esos almacenes.

## @ServiceOnly / @UserOnly (opt-in, ≥ 0.3.1)

Por default un endpoint acepta **tokens de usuario y de servicio** (M2M) — decide
por permisos, así el mismo endpoint sirve a personas y a backends. Si querés
restringir por **tipo de token**, usá estos decoradores opcionales:

```typescript
import { ServiceOnly, UserOnly } from '@hagemsa/auth-guard';

@ServiceOnly() // solo tokens de servicio; un token de usuario recibe 403
@Post('sincronizar')
sincronizar() { /* ... */ }

@UserOnly() // solo tokens de usuario; un token de servicio recibe 403
@Get('perfil')
verPerfil() { /* ... */ }
```

En un handler con token de servicio, `@CurrentUser()` trae `tokenUse: 'service'` y
`clientId`; `email`/`name`/`type` vienen vacíos. Ver
[Comunicación backend-a-backend (M2M)](/integracion/m2m/).

## Combinaciones comunes

| Caso | Decoradores |
|---|---|
| Endpoint público | `@Public()` |
| Endpoint que solo requiere JWT válido | (ninguno extra) |
| Endpoint con permiso global | `@RequirePermission('mod:rec:accion')` |
| Endpoint con permiso + scope por almacén | `@RequirePermission(...)` + `@RequireScope({ ... })` |
| Endpoint solo para backends (M2M) | `@RequirePermission(...)` + `@ServiceOnly()` |
| Endpoint solo para usuarios finales | `@RequirePermission(...)` + `@UserOnly()` |
| Endpoint solo accesible vía secret interno | (otro patrón, ver `interno`) |

## Próximo paso

[Permisos y scopes en detalle →](/integracion/permisos-scopes/)
