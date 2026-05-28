---
title: Configuración
description: Cómo cablear AuthGuardModule en tu app NestJS.
---

## Módulo raíz

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuardModule, JwtAuthGuard } from '@hagemsa/auth-guard';

@Module({
  imports: [
    AuthGuardModule.forRoot({
      jwksUrl: process.env.AUTH_JWKS_URL!,
      issuer: process.env.AUTH_ISSUER!,
      audience: process.env.AUTH_AUDIENCE ?? 'hagemsa-backends',
      authServiceUrl: process.env.AUTH_BASE_URL!,

      // Recomendado: cierra la ventana entre logout y exp del JWT.
      // Tradeoff: +1 fetch por request (cacheado 30s por jti).
      enableBlacklistCheck: true,

      // Producción: el Auth Service exige X-Internal-Secret para /api/internal/*.
      // Sin esto, /api/internal/* devuelve 401 y la blacklist falla cerrada → 401 a tu cliente.
      internalSecret: process.env.AUTH_INTERNAL_SECRET,
    }),
  ],
  providers: [
    // Aplicar el guard globalmente (todos los endpoints exigen JWT por default)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
```

## Opciones de configuración

| Opción | Tipo | Default | Descripción |
|---|---|---|---|
| `jwksUrl` | string | (requerido) | URL del JWKS público |
| `issuer` | string | (requerido) | Issuer esperado en el JWT (`iss`) |
| `audience` | string | (requerido) | Audience esperada en el JWT (`aud`) |
| `authServiceUrl` | string | (opcional) | URL base para `/api/internal/*`. Requerido si usás `@RequirePermission` o blacklist |
| `enableBlacklistCheck` | boolean | `false` | Si `true`, consulta blacklist en cada request (con cache 30s) |
| `jwksCacheTtlSeconds` | number | `86400` (24h) | TTL del cache de claves públicas |
| `permissionCacheTtlSeconds` | number | `300` (5min) | TTL del cache de permisos por rol |
| `blacklistCacheTtlSeconds` | number | `30` | TTL del cache de revocación por jti |
| `internalSecret` | string | (opcional) | Secret que se manda como header `X-Internal-Secret` al consultar `/api/internal/*`. En producción es **obligatorio**. |

## Configuración recomendada por entorno

### Desarrollo local

```typescript
AuthGuardModule.forRoot({
  jwksUrl: 'http://localhost:8080/.well-known/jwks.json',
  issuer: 'https://auth.hagemsa.com',
  audience: 'hagemsa-backends',
  authServiceUrl: 'http://localhost:8080',
  enableBlacklistCheck: false,  // simplifica iteración local
}),
```

### Producción

```typescript
AuthGuardModule.forRoot({
  jwksUrl: process.env.AUTH_JWKS_URL!,
  issuer: process.env.AUTH_ISSUER!,
  audience: process.env.AUTH_AUDIENCE!,
  authServiceUrl: process.env.AUTH_BASE_URL!,
  enableBlacklistCheck: true,
  internalSecret: process.env.AUTH_INTERNAL_SECRET,
}),
```

## Próximo paso

[Proteger endpoints →](/integracion/proteger-endpoints/)
