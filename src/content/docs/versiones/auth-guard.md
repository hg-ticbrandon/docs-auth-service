---
title: Versiones de @hagemsa/auth-guard
description: Historial completo de la librería auth-guard, qué cambió en cada versión y qué implica para los backends que la consumen.
---

Historial de todas las versiones de la librería, de la más reciente a la más
antigua. Para cada una: qué cambió, si hay que tocar código al actualizar, y las
trampas conocidas.

La fuente canónica es `libs/auth-guard/CHANGELOG.md` en el repo del Auth
Service. Esta página existe para poder consultarlo sin abrir el repo.

## Resumen

La columna **Publicada** es la fecha real de subida al Artifact Registry, que es
la que importa para saber desde cuándo se puede instalar. No siempre coincide con
la del `CHANGELOG.md`: la 0.2.0, por ejemplo, está fechada ahí como 2026-07-09
pero se publicó el 2026-07-02.

| Versión | Publicada | Qué trae | ¿Rompe algo? |
| --- | --- | --- | --- |
| [0.5.0](#050) | 2026-07-30 | Endurecimiento: amplificación de JWKS, 500→401, cache acotado | No |
| [0.4.0](#040) | 2026-07-24 | Tokens "flacos": resuelve `rol → permisos` del catálogo | No, pero ordena el despliegue |
| [0.3.1](#031) | 2026-07-10 | Corrige tipos de `AuthContext` que rompieron en 0.3.0 | No, arregla |
| [0.3.0](#030) | 2026-07-10 | M2M: `client_credentials`, `@ServiceOnly`, `ServiceTokenProvider` | Sí, tipos de `AuthContext` |
| [0.2.0](#020) | 2026-07-02 | Vínculo con el socio de negocio de BC01 en el contexto | No |
| [0.1.0](#010) | 2026-05-29 | Primera versión: guard JWT, decoradores, JWKS, blacklist | — |

:::tip[La 0.5.0 es la versión `latest`]
Está publicada y es la que instala un `pnpm add @hagemsa/auth-guard` sin versión.
Los backends que ya tienen `^0.4.0` **no la reciben solos**: en SemVer `0.x` el
caret no cruza minors, así que `^0.4.0` significa `>=0.4.0 <0.5.0`. Para pasar a
la 0.5.0 hay que pedirla explícitamente.
:::

Para ver qué hay publicado realmente:

```bash
gcloud artifacts versions list --package=@hagemsa%2fauth-guard \
  --repository=hagemsa-npm --location=us-central1
```

## 0.5.0

**2026-07-27** · Endurecimiento salido de una auditoría de seguridad.

**¿Hay que hacer algo?** No. Ninguna firma pública cambió, ni el shape de
`AuthContext`, ni las opciones de `AuthGuardConfig`. Se actualiza la dependencia
y se redespliega. Tampoco hay orden obligatorio: consumidores en 0.4.0 y 0.5.0
conviven, así que cada equipo actualiza cuando le convenga.

### Corregido

**Amplificación de peticiones contra el Auth Service.** El `kid` se lee del
token *sin verificar la firma* —hay que leerlo antes de tener la clave con la
que verificar—, así que cualquier anónimo lo elige. Un cache miss forzaba un
refresco del JWKS, de modo que N peticiones con kids inventados producían N
fetches al Auth Service, sin límite ni backoff. Ahora hay negative-cache de kids
desconocidos (60 s) y un cooldown de 60 s entre refrescos forzados.

**Un fallo del JWKS devolvía 500.** Un error de red o un 5xx del Auth Service
subía como `Error` crudo sin mapear, así que el backend consumidor respondía
500. Ahora se traduce a 401: es un token que no se pudo verificar, no un fallo
del backend.

**El cache de blacklist crecía sin límite.** Cada `jti` visto dejaba una entrada
permanente; un cliente refrescando en bucle genera un `jti` nuevo cada vez, así
que en un proceso de vida larga el crecimiento era monótono. Queda acotado a
10 000 entradas.

### Qué vas a notar

| Antes | Ahora |
| --- | --- |
| Un JWKS inalcanzable producía **500** en tu backend | Produce **401** |
| Cada token con `kid` desconocido disparaba un fetch al Auth Service | Como máximo un refresco por minuto |
| La memoria del proceso crecía con cada `jti` distinto | Acotada |

Si tenés alertas sobre tasa de 5xx, es esperable que bajen; si las tenés sobre
401, que suban un poco. Es el mismo evento reclasificado.

### La contrapartida

El cooldown de 60 s significa que **una rotación de claves puede tardar hasta un
minuto en detectarse**. Durante esa ventana los tokens firmados con la clave
nueva se rechazan con 401.

Se aceptó a conciencia: la rotación es un evento raro y planificado, mientras
que la amplificación era explotable por cualquiera en cualquier momento. Para
evitar la ventana por completo, publicá la clave nueva en el JWKS **antes** de
empezar a firmar con ella.

### Lo que no es configurable

Los tres números —60 s de negative-cache, 60 s de cooldown, 10 000 entradas— son
constantes, no opciones de `AuthGuardConfig`. Son topes de seguridad, no
política de negocio: un consumidor que pudiera subirlos se estaría reabriendo el
agujero. Si algún backend necesita otros valores, hay que discutirlo y cambiarlos
para todos.

## 0.4.0

**2026-07-24** · Soporte de tokens "flacos".

### Agregado

El guard resuelve `rol → permisos` desde el catálogo del Auth Service
(`GET /api/internal/roles-permisos`, cacheado) cuando el JWT no trae los permisos
embebidos. Esto permite emitir tokens que solo llevan `{ role, scope }`, sin que
crezcan con la cantidad de permisos: antes, un usuario con muchos roles generaba
un JWT de varios KB que no entraba en una cookie ni, a la larga, en el header
`Authorization`.

`CatalogoPermisosService` cachea el catálogo en memoria durante
`permissionCacheTtlSeconds` (default 300 s), con single-flight y
stale-while-revalidate: si el Auth Service falla pero hay catálogo previo se
sigue sirviendo, y solo falla cerrado en arranque en frío con el Auth caído.

### Cambiado

`RolEnJwt.permisos` pasa a ser **opcional**. En un token "gordo" viene el array
embebido; en uno "flaco" viene `undefined` y el guard lo hidrata desde el
catálogo antes de exponerlo en `@CurrentUser()`. Un array vacío `[]` sigue
significando "rol sin permisos", que es distinto de `undefined`.

`permissionCacheTtlSeconds` deja de estar deprecado y vuelve a tener efecto,
ahora como TTL del catálogo.

### Notas para el consumidor

No hay cambios de código requeridos: los decoradores y el shape de `AuthContext`
no cambian, y el guard sigue funcionando igual con los tokens "gordos".

Para resolver tokens flacos hace falta `authServiceUrl` —ya requerido si usás
`enableBlacklistCheck`— y, si el Auth Service exige `INTERNAL_SHARED_SECRET`, el
`internalSecret`.

:::danger[Orden de despliegue]
Actualizá esta versión en **todos** los backends **antes** de que el Auth Service
pase a emitir tokens flacos (`JWT_EMBED_PERMISOS=false`). El guard nuevo acepta
ambos formatos, así que se puede actualizar sin coordinar y hacer el flip
después. Al revés, los backends en 0.3.x no sabrían resolver los permisos.
:::

## 0.3.1

**2026-07-10** · Corrige tipos que rompieron en 0.3.0. Mismo día que la anterior.

`AuthContext.tokenUse` pasa a ser **opcional**. En 0.3.0 era requerido y eso
rompía a los consumidores que construyen un `AuthContext` a mano (mocks de test,
usuarios por defecto). El guard siempre lo puebla, así que al leerlo desde
`@CurrentUser()` está presente; ausente equivale a `'user'`.

`email`, `type` y `name` vuelven a ser **requeridos**, por compatibilidad con
0.2.0: había consumidores leyéndolos como `string`. En un token de servicio no
vienen en el JWT y el guard los normaliza a `''`.

:::tip
Si estás en 0.3.0, actualizá a esta. Es el mismo día y solo corrige tipos.
:::

## 0.3.0

**2026-07-10** · Autenticación backend-a-backend.

### Agregado

Soporte de **M2M** con el grant `client_credentials`.

`@ServiceOnly()` y `@UserOnly()` restringen un endpoint a tokens de servicio o de
usuario. Son opt-in: sin ninguno de los dos, el endpoint acepta ambos y la
autorización fina la sigue resolviendo `@RequirePermission`.

`ServiceTokenProvider` obtiene y cachea en memoria el JWT de servicio para llamar
a otros backends. Renueva unos 60 s antes del `exp` y usa single-flight, así que
varias llamadas concurrentes disparan un solo pedido.

`AuthGuardModule.forServiceClient()` para registrarlo, con
`SERVICE_TOKEN_PROVIDER_CONFIG` y el tipo `ServiceTokenProviderConfig`.

`AuthContext` suma `tokenUse` (`'user' | 'service'`) y `clientId`.

### Trampas conocidas

El caché del token vive en la **memoria del proceso**: cada instancia de Cloud
Run pide el suyo, y cada reinicio en desarrollo lo descarta.

`ServiceTokenProvider` **no reintenta** ante un fallo del Auth Service.

:::caution
Esta versión introdujo el problema de tipos que corrige la 0.3.1. No instales
0.3.0 directamente.
:::

## 0.2.0

**2026-07-09** · Vínculo con el socio de negocio.

`AuthContext` y el payload del JWT exponen el vínculo con el socio de negocio de
BC01, presente solo si la cuenta lo tiene: `codigoSocio`, `codigoCuenta`,
`socioExternoId`, `socioNombre` y `socioDocumento`.

Se agregan las guías de despliegue para los backends consumidores.

## 0.1.0

**2026-05-29** · Primera versión publicada.

`JwtAuthGuard` valida el JWT contra el JWKS del Auth Service (RS256). Se agregan
los decoradores `@Public()`, `@RequirePermission()`, `@RequireScope()` y
`@CurrentUser()`, más `JwksCacheService` y `BlacklistChecker`.

`authServiceUrl` deja de ser necesaria para `@RequirePermission` y
`@RequireScope`: los permisos y scopes viajan embebidos en el JWT y el guard los
resuelve sin round-trip. Solo se usa cuando `enableBlacklistCheck` está activo.

## Trampa conocida en todas las versiones

**Falta `@nestjs/core` en `peerDependencies`.** El guard importa `Reflector` de
`@nestjs/core` (`src/guards/jwt-auth.guard.ts`), pero el `package.json` solo
declara `@nestjs/common`, `reflect-metadata` y `rxjs`.

En la práctica no rompe nada: ningún backend NestJS funciona sin `@nestjs/core`,
así que siempre está presente. Solo se nota al instalar la librería en un
proyecto vacío, donde `require('@hagemsa/auth-guard')` falla con
`Cannot find module '@nestjs/core'`.

Está así desde la 0.1.0. Se corrige en la próxima versión que se publique; no
amerita una release solo para esto.

## Cómo actualizar

```bash
pnpm add @hagemsa/auth-guard@<version>
```

Ver [Instalación](/integracion/instalacion/) para la configuración del registry,
y [Publicar auth-guard](/operaciones/publicar-libreria/) si sos quien publica.
