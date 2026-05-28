---
title: Autenticación
description: Endpoints públicos para login, refresh, logout y recuperación de password.
---

> Para el formato de errores y envoltura de respuestas ver [Convenciones de la API](/api-reference/convenciones/).

## POST /api/auth/login

Autentica con email y password. Devuelve access + refresh token.

**Request:**

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "juan@hagemsa.com",
  "password": "Segura123"
}
```

**Response 200:**

```json
{
  "datos": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "refreshToken": "rt_a1b2c3d4...",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "refreshExpiresIn": 86400
  }
}
```

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 401 | `AUTH_CREDENCIALES_INVALIDAS` | Email o password incorrectos. Cuenta inactiva/suspendida. Cuenta inexistente. (Mensaje genérico — no enumeramos.) |
| 423 | `AUTH_CUENTA_BLOQUEADA` | Bloqueo por múltiples intentos fallidos. |
| 422 | `COMUN_VALIDACION_FALLIDA` | DTO inválido (email mal formado, password vacío). |
| 429 | `COMUN_LIMITE_PETICIONES` | Más de 5 intentos por minuto desde la misma IP. |

## POST /api/auth/refresh

Rota el refresh token y devuelve un nuevo par.

**Request:**

```http
POST /api/auth/refresh
Content-Type: application/json

{ "refreshToken": "rt_a1b2c3d4..." }
```

**Response 200:**

```json
{
  "datos": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "refreshToken": "rt_nuevo...",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "refreshExpiresIn": 86400
  }
}
```

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 401 | `AUTH_TOKEN_INVALIDO` | Refresh token inválido, expirado, o cuenta no activa. |
| 401 | `AUTH_TOKEN_REUSADO` | Se detectó reuso de un token ya rotado. **Toda la familia queda revocada.** El usuario debe volver a loguearse. |

> **Reuso detectado:** si mandás un refresh token ya usado, se revoca **toda la familia** de tokens derivados. El usuario tiene que volver a hacer login desde cero.

## POST /api/auth/logout

Revoca el access token actual + el refresh asociado.

**Request:**

```http
POST /api/auth/logout
Authorization: Bearer <accessToken>
```

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 401 | `COMUN_NO_AUTENTICADO` | Falta header `Authorization`. |
| 401 | `AUTH_TOKEN_INVALIDO` | Access token inválido o expirado. |

## POST /api/auth/forgot-password

Inicia el flujo de recuperación. Si el email existe, se envía un correo con un link al `PASSWORD_RESET_LINK` configurado.

**Request:**

```http
POST /api/auth/forgot-password
Content-Type: application/json

{ "email": "juan@hagemsa.com" }
```

**Response 202 Accepted** (sin body, exista o no la cuenta — no enumeramos).

El frontend muestra siempre el mismo mensaje genérico al usuario ("Si el email está registrado, recibirás un link").

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 422 | `COMUN_VALIDACION_FALLIDA` | Email mal formado. |
| 429 | `COMUN_LIMITE_PETICIONES` | Más de 3 intentos por minuto desde la misma IP. |

## POST /api/auth/reset-password

Completa el flujo usando el token del email.

**Request:**

```http
POST /api/auth/reset-password
Content-Type: application/json

{
  "token": "<token-del-email>",
  "password": "NuevaSegura456"
}
```

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 400 | `AUTH_RESET_TOKEN_INVALIDO` | Token de reset inválido, expirado o ya consumido. |
| 422 | `AUTH_PASSWORD_NO_CUMPLE_POLITICA` | Password no cumple la política (mínimo 8 chars, mezcla mayúsculas/minúsculas/números). |
| 429 | `COMUN_LIMITE_PETICIONES` | Más de 5 intentos por minuto desde la misma IP. |
