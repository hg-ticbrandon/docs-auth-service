---
title: Endpoints internos
description: Endpoints consumidos solo por la lib @hagemsa/auth-guard. Protegidos por X-Internal-Secret.
---

Estos endpoints **no se invocan desde clientes finales**. Los consume `@hagemsa/auth-guard` desde otros backends del ecosistema.

## Autenticación

En lugar de JWT, exigen el header:

```http
X-Internal-Secret: <shared-secret>
```

El secret se compara con la env `INTERNAL_SHARED_SECRET` del Auth Service en modo **timing-safe**. En producción esta env viene de Secret Manager.

Sin secret o con secret incorrecto → `401 Unauthorized`.

> **Dos endpoints internos**, ambos protegidos por `X-Internal-Secret`:
>
> - `GET /api/internal/jti/:jti/revoked` — estado de revocación de un `jti`
>   (blacklist), consumido por la lib con `enableBlacklistCheck`.
> - `GET /api/internal/roles-permisos` — catálogo `rol → permisos`, consumido por
>   la lib (≥ 0.4.0) para resolver permisos cuando el JWT viaja "flaco".
>
> Por **default** los permisos viajan **embebidos en el JWT** (`roles[].permisos`)
> y la lib autoriza `@RequirePermission` / `@RequireScope` **sin** llamar al Auth
> Service. El endpoint de catálogo entra en juego **solo** cuando el Auth Service
> emite tokens sin permisos embebidos (`JWT_EMBED_PERMISOS=false`). (Una versión
> vieja exponía `GET /api/internal/roles/:nombre/permisos` por rol; se reemplazó
> por el catálogo completo cacheable de abajo.)

## GET /api/internal/jti/:jti/revoked

Indica si un JWT (por su `jti`) fue revocado.

**Request:**

```http
GET /api/internal/jti/2f6fabe3-2eee-415b-9a95-962f1f448de1/revoked
X-Internal-Secret: <secret>
```

**Response 200:**

```json
{ "jti": "2f6fabe3-...", "revoked": false }
```

o

```json
{ "jti": "2f6fabe3-...", "revoked": true }
```

**Uso:** la lib lo consulta cuando `enableBlacklistCheck: true`. Resultado cacheado **30 segundos** por `jti`.

> **Fail-closed:** si este endpoint falla (401, 5xx, timeout), la lib asume `revoked: true` y rechaza el JWT con 401.

## GET /api/internal/roles-permisos

Devuelve el catálogo completo `rol → permisos` que la lib usa para **hidratar** los
permisos cuando el JWT viaja "flaco" (sin `roles[].permisos` embebidos). Disponible
en `@hagemsa/auth-guard` **≥ 0.4.0**.

**Request:**

```http
GET /api/internal/roles-permisos
X-Internal-Secret: <secret>
```

**Response 200:**

```json
{
  "version": "9f2c1a4b7e0d3f56",
  "roles": {
    "SUPER_ADMIN": ["auth:account:write", "auth:role:manage", "..."],
    "ALMACENERO": ["wms:inventario:read", "wms:inventario:write"],
    "GERENTE": ["wms:inventario:read", "facturacion:read", "..."]
  }
}
```

- `roles` — mapa de nombre de rol → array de códigos de permiso.
- `version` — hash estable del contenido del catálogo. Solo cambia cuando cambia
  algún rol o sus permisos; sirve para detectar cambios sin comparar el mapa entero.

**Uso:** la lib (`CatalogoPermisosService`) lo consulta cuando llega un token sin
permisos embebidos, y **cachea el resultado en memoria** durante
`permissionCacheTtlSeconds` (default 300s), con single-flight (varias requests con
caché vencida comparten un solo fetch) y stale-while-revalidate.

> **Fail-closed en frío, fail-soft con caché:** si el fetch falla y la lib **nunca**
> pudo cargar el catálogo (arranque en frío + Auth caído), la autorización falla
> cerrada — no puede resolver permisos. Si ya había un catálogo previo (aunque
> vencido), lo **sigue sirviendo** mientras el Auth Service se recupera, así una
> caída breve no tumba la autorización.

## ¿Por qué shared secret y no mTLS?

mTLS es la opción ideal, pero requiere infraestructura adicional (PKI interna, certificados rotables, configuración por backend). Para v1, un shared secret comparado de forma timing-safe da suficiente protección: el endpoint es de solo lectura (consulta de estado de un `jti`) y no expone datos sensibles.

Roadmap: cuando los backends corran en una red privada (VPC interna), evaluar Workload Identity + IAM en lugar del secret.
