---
title: Proteger endpoints
description: Decoradores de @hagemsa/auth-guard para controlar acceso por endpoint.
---

Con `JwtAuthGuard` registrado globalmente, **todos los endpoints exigen un JWT válido por default**. Solo los que marques con `@Public()` quedan abiertos.

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

## Combinaciones comunes

| Caso | Decoradores |
|---|---|
| Endpoint público | `@Public()` |
| Endpoint que solo requiere JWT válido | (ninguno extra) |
| Endpoint con permiso global | `@RequirePermission('mod:rec:accion')` |
| Endpoint con permiso + scope por almacén | `@RequirePermission(...)` + `@RequireScope({ ... })` |
| Endpoint solo accesible vía secret interno | (otro patrón, ver `interno`) |

## Próximo paso

[Permisos y scopes en detalle →](/integracion/permisos-scopes/)
