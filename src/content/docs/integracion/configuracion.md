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
import { AUTH_DEFAULTS } from './shared/auth.defaults';

@Module({
  imports: [
    AuthGuardModule.forRoot({
      jwksUrl: process.env.AUTH_JWKS_URL ?? AUTH_DEFAULTS.jwksUrl,
      issuer: process.env.AUTH_JWT_ISSUER ?? AUTH_DEFAULTS.issuer,
      audience: process.env.AUTH_JWT_AUDIENCE ?? AUTH_DEFAULTS.audience,
      // Los dos de abajo NO se usan mientras el Auth emita tokens "gordos",
      // pero van igual: ver el aviso.
      authServiceUrl:
        process.env.AUTH_SERVICE_URL ?? AUTH_DEFAULTS.authServiceUrl,
      internalSecret: process.env.AUTH_INTERNAL_SECRET,
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

`AUTH_DEFAULTS` es una constante del propio backend; su contenido está en la
[regla 7 del estándar](/integracion/estandar-backend/).

:::danger[Los cinco campos van siempre, aunque hoy sobren dos]
Hasta el 2026-09-25 esta página presentaba una «configuración mínima» de tres
campos y decía que `authServiceUrl` e `internalSecret` no hacían falta. Es
cierto **hoy**: con tokens «gordos» los permisos viajan embebidos y el guard
autoriza sin consultar nada.

Deja de ser cierto en cuanto el Auth Service emita tokens «flacos»
(`JWT_EMBED_PERMISOS=false`). Ahí el guard tiene que resolver `rol → permisos`
contra `GET /api/internal/roles-permisos`, y sin esos dos campos **devuelve 500
en todos los endpoints con permiso**.

Lo insidioso es el diagnóstico: las variables de entorno suelen estar puestas en
Cloud Run, así que uno mira el servicio desplegado, las ve, y concluye que está
bien. El problema es que el código no las lee.

Tres backends del ERP —`bc01-socio-negocio`, `bc14-cs-configuracion-general` y
uno más— quedaron así por seguir esta página. Se corrigieron en septiembre de
2026.
:::

:::caution[`env!` no es lo mismo que `env ?? DEFAULT`]
`process.env.AUTH_JWKS_URL!` le promete a TypeScript que la variable existe. Si
falta, el compilador calla y en runtime llega `undefined`: el error aparece lejos
del origen y sin decir qué variable era.

Con `?? AUTH_DEFAULTS.jwksUrl` el backend arranca en cualquier entorno sin
declarar cada variable, y el entorno pisa solo lo que necesita.

`AUTH_INTERNAL_SECRET` es el único sin default, porque es un secreto y un default
lo volvería inútil.
:::

> Importante: carga el `.env` **antes** de importar `AppModule` (ej.
> `import 'dotenv/config'` como primera línea de `main.ts`), porque
> `AuthGuardModule.forRoot({...})` lee las env al construir el módulo.

## Con blacklist (logout instantáneo, opcional)

Solo si quieres que un `logout` invalide el JWT **antes** de su `exp`. Esto agrega
un fetch al Auth Service por request (cacheado 30s por jti) y requiere
`authServiceUrl` + `internalSecret`:

```typescript
AuthGuardModule.forRoot({
  jwksUrl: process.env.AUTH_JWKS_URL ?? AUTH_DEFAULTS.jwksUrl,
  issuer: process.env.AUTH_JWT_ISSUER ?? AUTH_DEFAULTS.issuer,
  audience: process.env.AUTH_JWT_AUDIENCE ?? AUTH_DEFAULTS.audience,

  // Cierra la ventana entre logout y exp del JWT (tradeoff: +1 fetch/req, cacheado 30s).
  enableBlacklistCheck: true,
  authServiceUrl: process.env.AUTH_SERVICE_URL ?? AUTH_DEFAULTS.authServiceUrl,

  // El Auth Service exige X-Internal-Secret para /api/internal/*. Sin esto,
  // /api/internal/* devuelve 401 y la blacklist falla cerrada → 401 a tu cliente.
  internalSecret: process.env.AUTH_INTERNAL_SECRET,
}),
```

## Con tokens flacos

Por default el Auth Service emite tokens **"gordos"**: cada `roles[]` trae sus
`permisos` embebidos y la lib autoriza sin ningún round-trip. El problema es que
un usuario con muchos roles genera un JWT de varios KB, que a la larga no entra en
una cookie ni en el header `Authorization`.

Desde **0.4.0** la lib también acepta tokens **"flacos"**: el JWT lleva solo
`{ role, scope }` y la lib resuelve `rol → permisos` desde el catálogo del Auth
Service (`GET /api/internal/roles-permisos`), cacheado en memoria. El guard acepta
**ambos formatos** de forma transparente, así que puedes actualizar la lib sin
coordinar y hacer el cambio de formato después.

Para que la resolución funcione cuando llegue un token flaco, el config necesita
`authServiceUrl` y (si el Auth Service lo exige) `internalSecret` — los **mismos**
campos que la blacklist:

```typescript
AuthGuardModule.forRoot({
  jwksUrl: process.env.AUTH_JWKS_URL ?? AUTH_DEFAULTS.jwksUrl,
  issuer: process.env.AUTH_JWT_ISSUER ?? AUTH_DEFAULTS.issuer,
  audience: process.env.AUTH_JWT_AUDIENCE ?? AUTH_DEFAULTS.audience,

  // Necesarios para resolver permisos de un token flaco:
  authServiceUrl: process.env.AUTH_SERVICE_URL ?? AUTH_DEFAULTS.authServiceUrl,
  internalSecret: process.env.AUTH_INTERNAL_SECRET,

  // Opcional: cuánto cachear el catálogo rol→permisos (default 300s).
  permissionCacheTtlSeconds: 300,
}),
```

:::danger[`forServiceClient` NO configura el guard — revisa que esté en `forRoot`]
`forServiceClient` también recibe un `authServiceUrl`, pero es para **otra cosa**:
que tu backend **emita** tokens de servicio y llame a otros backends (M2M). El
guard **no lo lee**. Si tienes los dos módulos registrados, es fácil mirar el
archivo, ver un `authServiceUrl` y darlo por configurado cuando en realidad le
falta al `forRoot`.

```typescript
// ✗ MAL: el guard se queda sin authServiceUrl
AuthGuardModule.forRoot({
  jwksUrl, issuer, audience,          // ← le falta authServiceUrl/internalSecret
}),
AuthGuardModule.forServiceClient({
  authServiceUrl: process.env.AUTH_SERVICE_URL ?? AUTH_DEFAULTS.authServiceUrl,   // ← este NO cuenta para el guard
  clientId, clientSecret,
}),

// ✓ BIEN: cada módulo con su propia config
AuthGuardModule.forRoot({
  jwksUrl, issuer, audience,
  authServiceUrl: process.env.AUTH_SERVICE_URL ?? AUTH_DEFAULTS.authServiceUrl,
  internalSecret: process.env.AUTH_INTERNAL_SECRET,
}),
AuthGuardModule.forServiceClient({
  authServiceUrl: process.env.AUTH_SERVICE_URL ?? AUTH_DEFAULTS.authServiceUrl,
  clientId, clientSecret,
}),
```

Con tokens gordos el error queda **latente**: el guard nunca necesita el catálogo
y todo parece andar. Aparece recién cuando llega el primer token flaco.
:::

:::caution[Ordena el despliegue antes del flip]
El Auth Service pasa a emitir tokens flacos cuando se setea `JWT_EMBED_PERMISOS=false`.
**Antes** de ese flip, TODOS los backends deben estar en `≥ 0.4.0` con `authServiceUrl`
+ `internalSecret` configurados. Como el guard nuevo acepta ambos formatos, se puede
actualizar la lib con tranquilidad y hacer el flip como último paso coordinado.

Qué pasa si llega un token flaco y algo falta:

| Situación | Respuesta |
|---|---|
| Backend en una versión **anterior** a 0.4.0 | **403** — lee `permisos` vacío y no concede nada |
| Falta `authServiceUrl` en el `forRoot` | **500** — `authServiceUrl no configurada: no se puede resolver el catálogo de permisos` |
| `internalSecret` ausente o distinto | **500** — el catálogo responde 401 y, sin caché previa, el guard falla cerrado |
| Auth Service caído, **con** catálogo ya cacheado | **funciona** — sirve el catálogo stale mientras se recupera |
| Todo OK pero el rol no tiene el permiso | **403** — el caso normal de autorización |
:::

## Opciones de configuración

| Opción | Tipo | Default | Descripción |
|---|---|---|---|
| `jwksUrl` | string | (requerido) | URL del JWKS público |
| `issuer` | string | (requerido) | Issuer esperado en el JWT (`iss`) |
| `audience` | string | (requerido) | Audience esperada en el JWT (`aud`) |
| `authServiceUrl` | string | (opcional) | URL base para `/api/internal/*`. Se usa con `enableBlacklistCheck` **y** para resolver el catálogo `rol → permisos` cuando llega un token "flaco" (≥ 0.4.0). Con tokens "gordos" (permisos embebidos) no hace falta. |
| `enableBlacklistCheck` | boolean | `false` | Si `true`, consulta blacklist en cada request (con cache 30s). Requiere `authServiceUrl`. |
| `jwksCacheTtlSeconds` | number | `86400` (24h) | TTL del cache de claves públicas |
| `permissionCacheTtlSeconds` | number | `300` (5min) | TTL del catálogo `rol → permisos` que la lib cachea para resolver tokens "flacos" (≥ 0.4.0). Con tokens "gordos" no tiene efecto (los permisos ya vienen en el JWT). |
| `blacklistCacheTtlSeconds` | number | `30` | TTL del cache de revocación por jti |
| `internalSecret` | string | (opcional) | Secret que se manda como header `X-Internal-Secret` al consultar `/api/internal/*`. Obligatorio **si** activas `enableBlacklistCheck` o si el Auth Service exige el secreto para el catálogo de permisos. |

## Configuración recomendada por entorno

### Desarrollo local

```typescript
AuthGuardModule.forRoot({
  jwksUrl: 'http://localhost:8080/.well-known/jwks.json',
  issuer: 'https://auth.hagemsa.com',
  audience: 'hagemsa-backends',
  // Sin blacklist en local: no necesitas authServiceUrl ni internalSecret.
}),
```

### Producción

```typescript
AuthGuardModule.forRoot({
  jwksUrl: process.env.AUTH_JWKS_URL ?? AUTH_DEFAULTS.jwksUrl,
  issuer: process.env.AUTH_JWT_ISSUER ?? AUTH_DEFAULTS.issuer,
  audience: process.env.AUTH_JWT_AUDIENCE ?? AUTH_DEFAULTS.audience,
  // Las 3 de arriba alcanzan. Agrega lo de abajo solo si quieres logout instantáneo:
  enableBlacklistCheck: true,
  authServiceUrl: process.env.AUTH_SERVICE_URL ?? AUTH_DEFAULTS.authServiceUrl,
  internalSecret: process.env.AUTH_INTERNAL_SECRET,
}),
```

## M2M — emitir tokens salientes (`forServiceClient`)

`forRoot` valida los tokens que **entran** a tu backend. Si además tu backend
necesita **llamar** a otro backend protegido por su cuenta (sin un usuario en el
medio), registra también `forServiceClient` (≥ 0.3.1). Son independientes: puedes
usar uno, el otro, o los dos.

Se registra **condicionado** a que existan las credenciales, para que el backend
arranque igual donde no hace falta M2M:

```typescript
// app.module.ts
const modulosClienteServicio =
  process.env.SVC_CLIENT_ID && process.env.SVC_CLIENT_SECRET
    ? [
        AuthGuardModule.forServiceClient({
          authServiceUrl:
            process.env.AUTH_SERVICE_URL ?? AUTH_DEFAULTS.authServiceUrl,
          clientId: process.env.SVC_CLIENT_ID,
          clientSecret: process.env.SVC_CLIENT_SECRET, // desde Secret Manager
        }),
      ]
    : [];

// @Module({ imports: [..., ...modulosClienteServicio] })
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
