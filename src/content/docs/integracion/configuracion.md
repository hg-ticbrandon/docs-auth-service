---
title: Configuración
description: Cómo cablear AuthGuardModule en tu app NestJS.
---

## Módulo raíz (configuración mínima)

Esto es **todo lo que necesitás** para validar JWT + permisos + scopes. Los
permisos y scopes vienen embebidos en el JWT, así que **no** hace falta
`authServiceUrl` ni `internalSecret` para autorizar.

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuardModule, JwtAuthGuard } from '@hagemsa/auth-guard';

@Module({
  imports: [
    AuthGuardModule.forRoot({
      jwksUrl: process.env.AUTH_JWKS_URL!,
      issuer: process.env.AUTH_JWT_ISSUER!,
      audience: process.env.AUTH_JWT_AUDIENCE!,
      // No activamos blacklist: el access token vale hasta su exp (~1h).
    }),
  ],
  providers: [
    // Aplicar el guard globalmente (todos los endpoints exigen JWT por default,
    // salvo los marcados con @Public).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
```

> Importante: cargá el `.env` **antes** de importar `AppModule` (ej.
> `import 'dotenv/config'` como primera línea de `main.ts`), porque
> `AuthGuardModule.forRoot({...})` lee las env al construir el módulo.

## Con blacklist (logout instantáneo, opcional)

Solo si querés que un `logout` invalide el JWT **antes** de su `exp`. Esto agrega
un fetch al Auth Service por request (cacheado 30s por jti) y requiere
`authServiceUrl` + `internalSecret`:

```typescript
AuthGuardModule.forRoot({
  jwksUrl: process.env.AUTH_JWKS_URL!,
  issuer: process.env.AUTH_JWT_ISSUER!,
  audience: process.env.AUTH_JWT_AUDIENCE!,

  // Cierra la ventana entre logout y exp del JWT (tradeoff: +1 fetch/req, cacheado 30s).
  enableBlacklistCheck: true,
  authServiceUrl: process.env.AUTH_SERVICE_URL!,

  // El Auth Service exige X-Internal-Secret para /api/internal/*. Sin esto,
  // /api/internal/* devuelve 401 y la blacklist falla cerrada → 401 a tu cliente.
  internalSecret: process.env.AUTH_INTERNAL_SECRET,
}),
```

## Opciones de configuración

| Opción | Tipo | Default | Descripción |
|---|---|---|---|
| `jwksUrl` | string | (requerido) | URL del JWKS público |
| `issuer` | string | (requerido) | Issuer esperado en el JWT (`iss`) |
| `audience` | string | (requerido) | Audience esperada en el JWT (`aud`) |
| `authServiceUrl` | string | (opcional) | URL base para `/api/internal/*`. **Solo se usa con `enableBlacklistCheck`.** NO es necesario para `@RequirePermission` ni `@RequireScope` (los permisos vienen en el JWT). |
| `enableBlacklistCheck` | boolean | `false` | Si `true`, consulta blacklist en cada request (con cache 30s). Requiere `authServiceUrl`. |
| `jwksCacheTtlSeconds` | number | `86400` (24h) | TTL del cache de claves públicas |
| `permissionCacheTtlSeconds` | number | `300` (5min) | **Legacy / sin efecto.** Quedó del modelo anterior; hoy los permisos vienen embebidos en el JWT y no se cachean. |
| `blacklistCacheTtlSeconds` | number | `30` | TTL del cache de revocación por jti |
| `internalSecret` | string | (opcional) | Secret que se manda como header `X-Internal-Secret` al consultar `/api/internal/*`. Obligatorio **si** activás `enableBlacklistCheck`. |

## Configuración recomendada por entorno

### Desarrollo local

```typescript
AuthGuardModule.forRoot({
  jwksUrl: 'http://localhost:8080/.well-known/jwks.json',
  issuer: 'https://auth.hagemsa.com',
  audience: 'hagemsa-backends',
  // Sin blacklist en local: no necesitás authServiceUrl ni internalSecret.
}),
```

### Producción

```typescript
AuthGuardModule.forRoot({
  jwksUrl: process.env.AUTH_JWKS_URL!,
  issuer: process.env.AUTH_JWT_ISSUER!,
  audience: process.env.AUTH_JWT_AUDIENCE!,
  // Las 3 de arriba alcanzan. Agregá lo de abajo solo si querés logout instantáneo:
  enableBlacklistCheck: true,
  authServiceUrl: process.env.AUTH_SERVICE_URL!,
  internalSecret: process.env.AUTH_INTERNAL_SECRET,
}),
```

## M2M — emitir tokens salientes (`forServiceClient`)

`forRoot` valida los tokens que **entran** a tu backend. Si además tu backend
necesita **llamar** a otro backend protegido por su cuenta (sin un usuario en el
medio), registrá también `forServiceClient` (≥ 0.3.1). Son independientes: podés
usar uno, el otro, o los dos.

```typescript
// app.module.ts
AuthGuardModule.forServiceClient({
  authServiceUrl: process.env.AUTH_SERVICE_URL!,
  clientId: process.env.SVC_CLIENT_ID!,
  clientSecret: process.env.SVC_CLIENT_SECRET!, // desde Secret Manager, nunca hardcodeado
}),
```

Esto expone un `ServiceTokenProvider` inyectable que obtiene y cachea el token de
servicio (renovación proactiva + single-flight). El flujo completo —crear el
cliente de servicio, inyectar el provider, restringir por tipo de token— está en
[Comunicación backend-a-backend (M2M)](/integracion/m2m/).

| Opción | Tipo | Default | Descripción |
|---|---|---|---|
| `authServiceUrl` | string | (requerido) | URL base del Auth Service (ej. `https://auth.hagemsa.com`). |
| `clientId` | string | (requerido) | clientId del cliente de servicio (ej. `svc-flota`). |
| `clientSecret` | string | (requerido) | Secret del cliente, desde Secret Manager / env. |
| `renovarAntesDeSegundos` | number | `60` | Segundos antes de `exp` en que se renueva el token proactivamente. |

## Próximo paso

[Proteger endpoints →](/integracion/proteger-endpoints/)
