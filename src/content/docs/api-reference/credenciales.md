---
title: Credenciales (admin)
description: Establecer y resetear passwords de cuentas existentes.
---

> Para el formato de errores y envoltura de respuestas ver [Convenciones de la API](/api-reference/convenciones/).

Todos estos endpoints requieren JWT con el permiso `auth:account:write`.

## POST /api/admin/cuentas/:id/set-password

Establece o reemplaza el password de una cuenta.

**Cuándo se usa:**
- Onboarding: setear el primer password de una cuenta recién creada.
- Casos excepcionales en que un admin debe resetear sin pasar por el flujo de email.

**Request:**

```http
POST /api/admin/cuentas/<cuentaId>/set-password
Authorization: Bearer <jwt-admin>
Content-Type: application/json

{ "password": "PasswordNueva123" }
```

**Response 204** (sin body).

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 422 | `AUTH_PASSWORD_NO_CUMPLE_POLITICA` | Password no cumple la política (mínimo, mayúscula, minúscula, número). El `detalle` describe qué falló. |
| 422 | `COMUN_VALIDACION_FALLIDA` | DTO inválido (password vacío). |
| 404 | `AUTH_CUENTA_NO_ENCONTRADA` | El id no corresponde a una cuenta. |

**Política de password (default):**

- Mínimo 8 caracteres
- Al menos 1 mayúscula
- Al menos 1 minúscula
- Al menos 1 número

## POST /api/admin/cuentas/:id/reset-password

Genera una **password temporal** y la devuelve UNA SOLA VEZ en la respuesta. El admin la comunica al usuario por canal seguro (verbal, mensaje cifrado). El usuario debe cambiarla en su próximo login.

Diferente del endpoint público `/api/auth/forgot-password` (que dispara email): este lo ejecuta un admin sobre cualquier cuenta y devuelve la password directamente.

**Request:**

```http
POST /api/admin/cuentas/<cuentaId>/reset-password
Authorization: Bearer <jwt-admin>
```

**Response 200:**

```json
{
  "datos": {
    "passwordTemporal": "Xk9!mP3qR7vN"
  }
}
```

**Errores:**

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 404 | `AUTH_CUENTA_NO_ENCONTRADA` | El id no corresponde a una cuenta. |

> ⚠️ La `passwordTemporal` se devuelve UNA SOLA VEZ. No queda almacenada en plaintext. Si el admin no la copia/transmite en el momento, hay que regenerarla con otro POST.

## Notas de seguridad

- El password se hashea con **Argon2id** antes de guardarse. No queda nada en plaintext, ni siquiera en logs.
- Al setear un password nuevo, todas las sesiones activas del usuario **NO se revocan automáticamente**. Si esa es la intención, un admin debe revocar manualmente vía `/api/admin/sesiones/:id/revocar`.
- Los intentos fallidos se cuentan en `credentials.passwords.failed_attempts`. Tras N intentos (configurable), la cuenta se bloquea temporalmente y devuelve `423` con `codigo: "AUTH_CUENTA_BLOQUEADA"` en el siguiente intento de login.
