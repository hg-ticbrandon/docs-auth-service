---
title: Visión general
description: Cómo conectar un backend NestJS al Auth Service de HAGEMSA.
---

Esta sección es para devs que están construyendo o manteniendo un backend dentro del ecosistema HAGEMSA y necesitan **validar los JWT** que emite el Auth Service.

## Pre-requisitos

- Backend con **NestJS 11+** y **TypeScript 5+** (la lib declara `@nestjs/common@^11` como peer dependency).
- Acceso de lectura al Artifact Registry interno de HAGEMSA (para instalar `@hagemsa/auth-guard`). [Ver instalación →](/integracion/instalacion/)
- Variables de entorno para apuntar al Auth Service:
  - **Mínimo (validar JWT + permisos + scopes):** `AUTH_JWKS_URL`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`.
  - **Para blacklist (logout instantáneo) o tokens "flacos" (≥ 0.4.0, `JWT_EMBED_PERMISOS=false`):** sumá `AUTH_SERVICE_URL` y `AUTH_INTERNAL_SECRET`. Con tokens "gordos" y sin blacklist no hacen falta.

## Lo que vas a hacer

1. **Instalar** la librería `@hagemsa/auth-guard`. [Ver →](/integracion/instalacion/)
2. **Configurar** el módulo con la URL del Auth Service y el secret interno. [Ver →](/integracion/configuracion/)
3. **Proteger** tus endpoints con decoradores. [Ver →](/integracion/proteger-endpoints/)
4. **Declarar permisos y scopes** que cada ruta requiere. [Ver →](/integracion/permisos-scopes/)
5. **Manejar revocación y logout** vía blacklist propagada. [Ver →](/integracion/revocacion/)

## Cómo funciona por dentro

Cuando un cliente hace una request a tu backend:

```
1. Cliente → Tu backend:    GET /tu-endpoint  Bearer <JWT>
2. Tu backend → JWKS cache: ¿clave para kid=X?  (cacheado 24h)
3. Tu backend valida firma + iss + aud + exp localmente
4. Tu backend → Auth Service: ¿jti revocado?  (SOLO si enableBlacklistCheck; cacheado 30s, fail-closed)
5. Tu backend verifica permisos + scope leyendo los claims del JWT
   (roles[].permisos / roles[].scope) — SIN fetch al Auth Service
   (token "flaco" ≥ 0.4.0: resuelve permisos del catálogo cacheado)
6. Tu backend procesa la request si todo OK, devuelve 401/403 si no
```

La lib `@hagemsa/auth-guard` hace 1-6 por vos. Solo tenés que decirle qué permiso y scope requiere cada endpoint.

> **Importante:** por default los permisos y scopes vienen **embebidos en el JWT** (`roles[].permisos`, `roles[].scope`), así que la lib NO hace round-trip al Auth Service para autorizar. El único fetch en runtime es el chequeo de blacklist del paso 4, y **solo** si activás `enableBlacklistCheck`. Sin esa opción, validar un request es 100% local (una operación criptográfica). Trade-off: un cambio de permisos en un rol recién se refleja cuando el access token expira y se refresca (~TTL del access, hoy 1 hora).
>
> Desde **0.4.0**, si el Auth Service emite tokens "flacos" (`JWT_EMBED_PERMISOS=false`), la lib resuelve `rol → permisos` desde el catálogo del Auth Service **cacheado en memoria** (`permissionCacheTtlSeconds`, default 300s). Ahí sí hay un fetch, pero amortizado por el TTL del catálogo y compartido entre todas las requests (single-flight).

## Caché y latencia

| Cache | TTL default | Configurable |
|---|---|---|
| JWKS (claves públicas) | 24 horas | sí (`jwksCacheTtlSeconds`) |
| Revocación por JTI | 30 segundos | sí (`blacklistCacheTtlSeconds`) — solo si `enableBlacklistCheck` |
| Catálogo `rol → permisos` | 5 minutos | sí (`permissionCacheTtlSeconds`) — solo con tokens "flacos" (≥ 0.4.0) |

> Con tokens "gordos" (default) los **permisos NO se consultan**: vienen embebidos en el JWT, así que `permissionCacheTtlSeconds` no tiene efecto. Solo entra en juego con tokens "flacos" (`JWT_EMBED_PERMISOS=false`), donde la lib cachea el catálogo `rol → permisos` durante ese TTL.

En condiciones normales (cache caliente), validar un JWT cuesta **una operación criptográfica local**. Si activás blacklist, se suma un fetch al Auth Service por jti cada 30s. Latencia esperada: < 5ms.

## Modelo de fallo

- **Auth Service caído + cache fría:** todos los requests devuelven 401. El sistema falla cerrado (preferimos rechazar accesos válidos que dejar pasar sesiones comprometidas).
- **Auth Service caído + cache caliente:** el cache de JWKS sigue sirviendo hasta su TTL y, con tokens "gordos", los permisos/scopes se leen del JWT (no dependen del Auth Service). Con tokens "flacos" (≥ 0.4.0), la lib sirve el catálogo `rol → permisos` cacheado (stale-while-revalidate) mientras el Auth Service se recupera; solo falla cerrado si nunca pudo cargarlo. Si `enableBlacklistCheck` está activo y la blacklist no responde → fail-closed → 401 para JWTs no cacheados como válidos. Sin blacklist y con tokens gordos, la validación sigue funcionando 100% local.
- **JWKS rota claves:** el cache detecta cache miss para el nuevo kid y refresca automáticamente.

## Vínculos útiles

- **OpenAPI:** la API completa del Auth Service vive en `https://auth.hagemsa.com/docs` (UI) y `/docs-json` (spec OpenAPI 3.x).
- **Plan maestro:** `plans/HAGEMSA_AUTH_SERVICE_PLAN.md` en el repo del Auth Service.
- **Doc original:** `docs/agregar-backend.md` en el repo.
