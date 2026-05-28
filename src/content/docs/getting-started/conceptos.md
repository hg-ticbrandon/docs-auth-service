---
title: Conceptos clave
description: Vocabulario técnico que vas a ver repetidamente en estas docs.
---

## JWT (JSON Web Token)

Token firmado que prueba quién es el usuario. Se compone de 3 partes (header, payload, firma) separadas por puntos. El Auth Service emite JWTs con algoritmo **RS256** (RSA firma asimétrica). La clave privada nunca sale del servicio; la pública se expone vía `/.well-known/jwks.json` para que cualquier backend pueda validar firmas.

**Payload típico:**

```json
{
  "sub": "f98fd200-5db0-40d5-a942-e4a484579b82",
  "email": "juan@hagemsa.com",
  "type": "interno",
  "name": "Juan Pérez",
  "jti": "2f6fabe3-2eee-415b-9a95-962f1f448de1",
  "roles": [
    {
      "role": "ALMACENERO",
      "scope": { "almacenId": "lima-1" },
      "permisos": [
        "wms:inventario:read",
        "wms:inventario:write",
        "wms:recepcion:write",
        "wms:despacho:write"
      ]
    }
  ],
  "iss": "https://auth.hagemsa.com",
  "aud": "hagemsa-backends",
  "exp": 1779722400,
  "iat": 1779718800
}
```

> Cada item de `roles[]` embebe los **permisos efectivos del rol al emitir el JWT**. Los backends consumidores autorizan sin round-trip al Auth Service. Trade-off: cambios al catálogo de permisos no se reflejan hasta que el access token expira y se refresca — mantené el TTL del access token bajo (~15 min) para acotar esa ventana.

## JWKS (JSON Web Key Set)

Endpoint público (`/.well-known/jwks.json`) que expone las claves públicas con las que el Auth Service firma los JWTs. Cualquier backend cachea este endpoint (24h por default) y verifica firmas localmente sin volver a llamar al Auth Service.

## RBAC y scopes

**RBAC (Role-Based Access Control):** cada cuenta tiene uno o más roles (`ALMACENERO`, `FACTURADOR`, `RRHH`, etc.). Cada rol tiene una lista de permisos (`wms:inventario:read`, `wms:inventario:write`, etc.).

**Scopes:** restringen un rol a un sub-dominio. Ej. un `ALMACENERO` con `scope: { almacenId: 'lima-1' }` solo puede operar el almacén de Lima 1; el de Lima 2 le da 403.

**Códigos de permiso:** convención `<modulo>:<recurso>:<accion>`. Ejemplos:

- `wms:inventario:read`
- `wms:inventario:write`
- `despachos:guia:firmar`
- `facturacion:factura:emitir`
- `auth:cuenta:suspender`

## Access token vs refresh token

- **Access token:** JWT de corta vida (1 hora). Va en el header `Authorization: Bearer ...` en cada request.
- **Refresh token:** opaco (no es JWT), larga vida (30 días). Se usa solo para pedir un nuevo access token cuando el actual expira. Vive en una cookie httpOnly o en almacenamiento seguro del cliente.

## Rotación y detección de reuso

Cada vez que pides refrescar el access token, el refresh token también se rota: el viejo queda **usado** y se emite uno nuevo. Esto permite detectar robo:

- Si alguien intenta usar un refresh token ya marcado como usado → **se revoca toda la familia** de tokens (todos los refresh derivados del original). El usuario tiene que volver a loguear desde cero.

## Blacklist y fail-closed

Cuando un usuario hace logout, su `jti` (JWT ID) se guarda en una blacklist hasta que el JWT expire naturalmente. Los backends consumen `GET /api/internal/jti/:jti/revoked` para verificar.

**Fail-closed:** si el endpoint no responde, los backends asumen que el JWT está revocado (rechazan la request). Esto es lo seguro — preferimos rechazar accesos válidos por unos segundos que dejar pasar sesiones comprometidas.

## Argon2id

Algoritmo de hash de passwords actualmente recomendado (RFC 9106, OWASP 2024+). Resistente a ataques por GPU y ASIC. El Auth Service usa los parámetros del preset `argon2id` con costos calibrados para CPUs server (≥3 iteraciones, 64MB memoria, 4 lanes).

## Append-only audit

La tabla `audit.auth_events` es **append-only**: solo se hacen INSERTs. Nunca UPDATE ni DELETE. Esto es regla inquebrantable del proyecto (ver `CLAUDE.md §5.3`).
