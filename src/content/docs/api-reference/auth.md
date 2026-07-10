---
title: Autenticación
description: Endpoints de login, refresh, logout, recuperación de password y perfil self-service.
---

> Para el formato de errores y envoltura de respuestas ver [Convenciones de la API](/api-reference/convenciones/).

## POST /api/auth/login

Autentica con **email o nombre de usuario** + password. Devuelve access + refresh token.

**Request:**

```http
POST /api/auth/login
Content-Type: application/json

{
  "identificador": "juan@hagemsa.com",
  "password": "Segura123"
}
```

> `identificador` acepta el **email** o el **nombre de usuario** de la cuenta. Si contiene `@` se interpreta como email; si no, como nombre de usuario. (Por eso el nombre de usuario nunca puede contener `@`.)

**Response 200:**

```json
{
  "datos": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "refreshToken": "rt_a1b2c3d4...",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "refreshExpiresIn": 2592000
  }
}
```

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 401 | `AUTH_CREDENCIALES_INVALIDAS` | Identificador o password incorrectos, o cuenta inexistente. (Mensaje genérico — no enumeramos.) |
| 409 | `AUTH_CUENTA_SUSPENDIDA` / `AUTH_CUENTA_INACTIVA` | Credenciales correctas pero la cuenta no está habilitada (se revela solo tras validar la password). |
| 423 | `AUTH_CUENTA_BLOQUEADA` | Bloqueo por múltiples intentos fallidos. |
| 422 | `COMUN_VALIDACION_FALLIDA` | DTO inválido (identificador o password vacío). |
| 429 | `COMUN_LIMITE_PETICIONES` | Más de 60 intentos por minuto desde la misma IP (límite global). |

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
    "refreshExpiresIn": 2592000
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
| 422 | `AUTH_PASSWORD_NO_CUMPLE_POLITICA` | Password no cumple la política (mínimo 8 chars, al menos 1 mayúscula y 1 número). |
| 429 | `COMUN_LIMITE_PETICIONES` | Más de 5 intentos por minuto desde la misma IP. |

## POST /api/auth/token

Grant **OAuth2 client credentials** (máquina a máquina). Un backend canjea su
`clientId` + `clientSecret` por un **token de servicio** de vida corta (10 min)
con el claim `tokenUse: "service"`. No hay refresh token: al vencer se vuelve a
pedir con el secret. Público y rate-limited.

Para el flujo completo (crear el cliente, `ServiceTokenProvider`) ver
[Comunicación backend-a-backend (M2M)](/integracion/m2m/).

**Request:**

```http
POST /api/auth/token
Content-Type: application/json

{
  "grantType": "client_credentials",
  "clientId": "svc-flota",
  "clientSecret": "cs_a1b2c3d4..."
}
```

**Response 200:**

```json
{
  "datos": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "tokenType": "Bearer",
    "expiresIn": 600
  }
}
```

> El JWT lleva `tokenUse: "service"`, `clientId`, y los permisos de los roles del
> cliente embebidos — igual que un token de usuario, así los guards de los
> backends lo autorizan sin round-trip. No lleva `email`/`name`/`type`.

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 401 | `AUTH_SERVICE_CLIENT_CREDENCIALES_INVALIDAS` | `clientId` o `clientSecret` inválidos, o cliente inexistente. (Mensaje genérico — no enumeramos.) |
| 409 | `AUTH_SERVICE_CLIENT_SUSPENDIDO` | El cliente de servicio está suspendido. |
| 422 | `COMUN_VALIDACION_FALLIDA` | Falta `grantType` (debe ser `"client_credentials"`), `clientId` o `clientSecret`. |
| 429 | `COMUN_LIMITE_PETICIONES` | Más de 10 solicitudes por minuto desde la misma IP. |

## Perfil (self-service)

Endpoints para que la **cuenta autenticada** gestione su propio perfil. Todos
**requieren `Authorization: Bearer <accessToken>`** y operan siempre sobre la
cuenta del token — nunca sobre un id de la URL. Un usuario solo puede ver y
editar **su** perfil.

### GET /api/auth/perfil

Devuelve los datos de la cuenta autenticada, incluidos sus códigos internos y —
si tiene— el socio de negocio (BC01) vinculado.

**Request:**

```http
GET /api/auth/perfil
Authorization: Bearer <accessToken>
```

**Response 200:**

```json
{
  "datos": {
    "id": "8c1d...e9",
    "email": "juan@hagemsa.com",
    "nombreUsuario": "juanperez",
    "nombreCompleto": "Juan Pérez",
    "tipoCuenta": "interno",
    "estado": "activo",
    "documentoIdentidad": "12345678",
    "codigoSocio": "BA",
    "codigoCuenta": "C1",
    "createdAt": "2026-05-26T16:45:12.123Z",
    "updatedAt": "2026-07-09T16:15:25.888Z",
    "socio": {
      "socioExternoId": 145,
      "tipo": "empleado",
      "nombre": "Juan Pérez",
      "documento": "12345678",
      "snapshot": { "…": "objeto completo de BC01" }
    }
  }
}
```

> `codigoSocio` / `codigoCuenta` son `null` si la cuenta no tiene códigos. `socio`
> aparece solo si la cuenta está vinculada a un socio de BC01.

### PATCH /api/auth/perfil/codigos

Setea, edita o limpia los **códigos internos** de la cuenta (para generación de
códigos en PDFs). Son "todo o nada": ambos presentes (setear/editar) o ambos
`null` (limpiar). Alfanuméricos de **1 a 20** caracteres, distintos entre sí, y
únicos en todo el sistema (un código no puede repetirse en ninguna cuenta).

**Request (setear/editar):**

```http
PATCH /api/auth/perfil/codigos
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "codigoSocio": "BA", "codigoCuenta": "C1" }
```

**Request (limpiar):** `{ "codigoSocio": null, "codigoCuenta": null }`

**Response 204** (sin body).

> **Importante — refresco del token:** los códigos viajan dentro del JWT. El
> access token vigente **no** cambia al guardar; el cambio se refleja recién al
> refrescar. El frontend (BFF) fuerza un `POST /api/auth/refresh` tras un cambio
> exitoso para que los backends que leen los códigos del JWT (ej. generación de
> PDFs) los vean al instante, sin re-login.

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 400 | `AUTH_CODIGO_INVALIDO` | Formato inválido, o se envió solo uno de los dos códigos. |
| 409 | `AUTH_SOCIO_CODIGO_YA_USADO` | Uno de los códigos ya lo usa otra cuenta. |
| 422 | `AUTH_SOCIO_DATOS_INVALIDOS` | Los dos códigos son iguales entre sí. |
| 401 | `COMUN_NO_AUTENTICADO` | Falta o es inválido el Bearer. |

### PATCH /api/auth/perfil/password

Cambia la contraseña de la cuenta autenticada **probando la contraseña actual**
(distinto del reset por email). No rota el token.

**Request:**

```http
PATCH /api/auth/perfil/password
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "passwordActual": "Segura123", "passwordNueva": "NuevaSegura456" }
```

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 401 | `AUTH_CREDENCIALES_INVALIDAS` | La contraseña actual es incorrecta (mensaje genérico). |
| 422 | `AUTH_PASSWORD_NO_CUMPLE_POLITICA` | La nueva contraseña no cumple la política (mínimo 8 chars). |
| 401 | `COMUN_NO_AUTENTICADO` | Falta o es inválido el Bearer. |
