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
  "username": "jperez",
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
  "codigoSocio": "BA",
  "codigoCuenta": "C1",
  "socioExternoId": 145,
  "socioNombre": "Juan Pérez",
  "socioDocumento": "12345678",
  "iss": "https://auth.hagemsa.com",
  "aud": "hagemsa-backends",
  "exp": 1779722400,
  "iat": 1779718800
}
```

> Cada item de `roles[]` embebe los **permisos efectivos del rol al emitir el JWT**. Los backends consumidores autorizan sin round-trip al Auth Service. Trade-off: cambios al catálogo de permisos no se reflejan hasta que el access token expira y se refresca — con el TTL actual (1 hora, `JWT_ACCESS_TTL_SECONDS`) esa ventana es de máximo 1 hora.

### Campos del payload

| Campo | Presencia | Descripción |
|---|---|---|
| `sub` | siempre | ID de la cuenta (uuid). |
| `email` | siempre | Correo de la cuenta. |
| `username` | siempre* | Nombre de usuario (login alterno). *Puede faltar en tokens emitidos antes de habilitar login por usuario. |
| `type` | siempre | `TipoCuenta`: `interno` \| `cliente` \| `proveedor`. |
| `name` | siempre | Nombre completo. |
| `jti` | siempre | ID de la sesión (para blacklist/revocación). |
| `roles` | siempre | Array de `{ role, scope, permisos[] }` con los permisos embebidos. |
| `codigoSocio` | solo si la cuenta tiene códigos | Código interno de la cuenta, 1-20 alfanuméricos. Para generación de códigos en PDFs. **Independiente del socio.** |
| `codigoCuenta` | solo si la cuenta tiene códigos | Segundo código interno de la cuenta, 1-20 alfanuméricos. **Independiente del socio.** |
| `socioExternoId` | solo si hay socio | `personalId` del socio en BC01-socio-negocio. |
| `socioNombre` | solo si hay socio | Nombre del socio (del snapshot BC01) — para display sin llamar a BC01. |
| `socioDocumento` | solo si hay socio | Documento del socio (del snapshot BC01). |
| `iss` / `aud` / `exp` / `iat` | siempre | Estándar JWT (emisor, audiencia, expiración, emitido-en). |

> **Códigos vs. socio son independientes.** `codigoSocio` y `codigoCuenta` son atributos de la **cuenta** (los edita el propio usuario desde su perfil) y aparecen si la cuenta los tiene seteados — **sin importar si hay un socio vinculado**. Son "todo o nada" (ambos o ninguno) y alfanuméricos de 1 a 20 caracteres.
>
> Los campos `socioExternoId`, `socioNombre` y `socioDocumento` aparecen **solo cuando la cuenta está vinculada a un socio de negocio (BC01)** (vínculo que gestiona un admin). El nombre/documento provienen de un **snapshot** capturado al vincular (puede quedar desactualizado si BC01 cambia; se refresca al re-vincular). BC01 sigue siendo la fuente de verdad para el maestro completo.

## JWKS (JSON Web Key Set)

Endpoint público (`/.well-known/jwks.json`) que expone las claves públicas con las que el Auth Service firma los JWTs. Cualquier backend cachea este endpoint (24h por default) y verifica firmas localmente sin volver a llamar al Auth Service.

## RBAC y scopes

**RBAC (Role-Based Access Control):** cada cuenta tiene uno o más roles (`ALMACENERO`, `FACTURADOR`, `RRHH`, etc.). Cada rol tiene una lista de permisos (`wms:inventario:read`, `wms:inventario:write`, etc.).

**Scopes:** restringen un rol a un sub-dominio. Ej. un `ALMACENERO` con `scope: { almacenId: 'lima-1' }` solo puede operar el almacén de Lima 1; el de Lima 2 le da 403.

**Códigos de permiso:** convención `modulo:accion` o `modulo:recurso:accion`. Ejemplos reales del catálogo:

- `wms:inventario:read`
- `wms:inventario:write`
- `wms:despacho:write`
- `facturacion:emitir`
- `auth:account:write`

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
