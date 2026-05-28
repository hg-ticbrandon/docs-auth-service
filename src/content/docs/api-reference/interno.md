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

## GET /api/internal/roles/:nombre/permisos

Devuelve los permisos asociados a un rol por nombre.

**Request:**

```http
GET /api/internal/roles/ALMACENERO/permisos
X-Internal-Secret: <secret>
```

**Response 200:**

```json
{
  "rol": "ALMACENERO",
  "permisos": ["wms:inventario:read", "wms:inventario:write"]
}
```

**Errores:**

| Código | Causa |
|---|---|
| `401` | Sin secret o secret inválido |
| `404` | Rol no encontrado |

**Uso:** la lib lo consulta cuando un endpoint exige `@RequirePermission`. Resultado cacheado **5 minutos** en cada instancia de backend.

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

mTLS es la opción ideal, pero requiere infraestructura adicional (PKI interna, certificados rotables, configuración por backend). En Cloud Run + VPC Connector, un shared secret + red privada da suficiente protección para v1.

Roadmap: cuando los backends pasen a VPC interna, evaluar Workload Identity + IAM en lugar del secret.
