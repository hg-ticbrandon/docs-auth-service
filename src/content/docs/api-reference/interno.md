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

> **Nota:** existe **un solo** endpoint interno: el de blacklist de `jti` (abajo).
> No hay un endpoint para resolver permisos de un rol — los permisos viajan
> **embebidos en el JWT** (`roles[].permisos`), así que la lib autoriza
> `@RequirePermission` / `@RequireScope` sin llamar al Auth Service. (Versiones
> viejas exponían `GET /api/internal/roles/:nombre/permisos`; ese endpoint fue
> eliminado.)

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

## ¿Por qué shared secret y no mTLS?

mTLS es la opción ideal, pero requiere infraestructura adicional (PKI interna, certificados rotables, configuración por backend). Para v1, un shared secret comparado de forma timing-safe da suficiente protección: el endpoint es de solo lectura (consulta de estado de un `jti`) y no expone datos sensibles.

Roadmap: cuando los backends corran en una red privada (VPC interna), evaluar Workload Identity + IAM en lugar del secret.
