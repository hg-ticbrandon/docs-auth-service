---
title: Visión general
description: Cómo conectar un backend NestJS al Auth Service de HAGEMSA.
---

Esta sección es para devs que están construyendo o manteniendo un backend dentro del ecosistema HAGEMSA y necesitan **validar los JWT** que emite el Auth Service.

## Pre-requisitos

- Backend con **NestJS 10+** y **TypeScript 5+**.
- Acceso al Artifact Registry interno de HAGEMSA (para instalar `@hagemsa/auth-guard`).
- Variables de entorno para apuntar al Auth Service (`AUTH_JWKS_URL`, `AUTH_BASE_URL`, `AUTH_INTERNAL_SECRET`).

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
3. Tu backend valida firma localmente
4. Tu backend → Auth Service: ¿jti revocado?  (cacheado 30s, fail-closed)
5. Tu backend → Auth Service: permisos del rol R? (cacheado 5min)
6. Tu backend verifica permisos + scope
7. Tu backend procesa la request si todo OK, devuelve 401/403 si no
```

La lib `@hagemsa/auth-guard` hace 1-6 por vos. Solo tenés que decirle qué permiso y scope requiere cada endpoint.

## Caché y latencia

| Cache | TTL default | Configurable |
|---|---|---|
| JWKS (claves públicas) | 24 horas | sí (`jwksCacheTtlSeconds`) |
| Permisos por rol | 5 minutos | sí (`permissionCacheTtlSeconds`) |
| Revocación por JTI | 30 segundos | sí (`blacklistCacheTtlSeconds`) |

En condiciones normales (cache caliente), validar un JWT cuesta **una operación criptográfica local** + un fetch al Auth Service por jti cada 30s. Latencia esperada: < 5ms.

## Modelo de fallo

- **Auth Service caído + cache fría:** todos los requests devuelven 401. El sistema falla cerrado (preferimos rechazar accesos válidos que dejar pasar sesiones comprometidas).
- **Auth Service caído + cache caliente:** el cache de JWKS y permisos sigue sirviendo hasta su TTL. La blacklist no responde → fail-closed → 401 para JWTs no cacheados como válidos.
- **JWKS rota claves:** el cache detecta cache miss para el nuevo kid y refresca automáticamente.

## Vínculos útiles

- **OpenAPI:** la API completa del Auth Service vive en `https://auth.hagemsa.com/docs` (UI) y `/docs-json` (spec OpenAPI 3.x).
- **Plan maestro:** `plans/HAGEMSA_AUTH_SERVICE_PLAN.md` en el repo del Auth Service.
- **Doc original:** `docs/agregar-backend.md` en el repo.
