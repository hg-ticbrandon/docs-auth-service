---
title: Convenciones de la API
description: Contrato común a todos los endpoints del Auth Service (errores, paginación, envoltura de respuestas).
---

> Todos los endpoints del Auth Service (y de cualquier otro backend del ecosistema HAGEMSA) siguen el mismo contrato de respuesta. El frontend distingue errores y construye paginadores asumiendo estos campos. **No hay excepciones.**

## Base URL

| Entorno | URL |
|---|---|
| Producción | `https://auth.hagemsa.com` |
| Staging | `https://auth-staging.hagemsa.com` (TBD) |
| Local | `http://localhost:8080` |

## Autenticación

La mayoría de endpoints exigen un JWT en el header:

```http
Authorization: Bearer <accessToken>
```

Excepciones:

- **Públicos:** `POST /api/auth/login`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `GET /.well-known/jwks.json`, `GET /health`, `GET /health/ready`, `GET /health/info`.
- **Internos:** `GET /api/internal/*` exigen `X-Internal-Secret` en lugar de JWT.

## Content-Type

Para todos los POST/PATCH:

```http
Content-Type: application/json
```

Responses son siempre `application/json` (excepto `/health`, que también es JSON pero con su propio shape).

## Reglas generales del contrato

- **Claves JSON en español sin tildes ni ñ** (ej. `paginacion`, `tamanoPagina`, `razonSocial`). Esto evita problemas con generadores de tipos y herramientas que asumen ASCII.
- El **contenido** de los campos sí va en español natural con tildes y ñ (ej. `"detalle": "Cuenta suspendida"`, `"razonSocial": "ACME SAC"`).
- `codigo` es el **identificador estable** que el frontend usa para lógica condicional. Una vez publicado, **nunca cambia**.
- `trazaId` se pobla desde el contexto de tracing distribuido (header `X-Request-Id` si viene en el request; si no, se genera). Es **obligatorio** en toda respuesta de error.
- Errores 5xx **NUNCA** exponen stack traces, nombres de tablas, ni mensajes internos. Esa información va **solo a logs**.
- Lista vacía retorna **`200`** con `datos: []`. **NUNCA** `404` ni `null` cuando la consulta es válida pero sin resultados.

## Respuesta de error (status >= 400)

```json
{
  "tipo": "https://errores.hagemsa.com/comun/validacion-fallida",
  "titulo": "Error de validación",
  "estado": 422,
  "codigo": "COMUN_VALIDACION_FALLIDA",
  "detalle": "La solicitud contiene 2 campos con errores.",
  "instancia": "/api/admin/cuentas",
  "fecha": "2026-05-26T16:45:12.123Z",
  "trazaId": "5b8aa5a2d2c872e8321cf3713faf9b9e",
  "servicio": "hagemsa-auth-service",
  "errores": [
    {
      "campo": "email",
      "codigo": "FORMATO_INVALIDO",
      "mensaje": "El email no tiene un formato válido.",
      "valorRechazado": "no-es-email"
    },
    {
      "campo": "nombreCompleto",
      "codigo": "REQUERIDO",
      "mensaje": "El nombre completo es obligatorio.",
      "valorRechazado": null
    }
  ]
}
```

### Significado de cada campo

| Campo | Obligatorio | Descripción |
|---|---|---|
| `tipo` | Sí | URI estable que identifica el tipo de error. Apunta a documentación pública. |
| `titulo` | Sí | Resumen corto y estable del tipo de error. No incluye datos variables. |
| `estado` | Sí | Código HTTP. Coincide con el status real de la respuesta. |
| `codigo` | Sí | Código interno estable. Formato `<PREFIJO>_<ERROR>`. El frontend lo usa para distinguir errores. |
| `detalle` | Sí | Explicación específica de esta ocurrencia. Puede contener datos variables. Es lo que se muestra al usuario. |
| `instancia` | Sí | Path del recurso afectado. |
| `fecha` | Sí | ISO 8601 en UTC. |
| `trazaId` | Sí | ID de correlación distribuida (también se devuelve en header `X-Request-Id`). |
| `servicio` | Sí | Nombre del backend que originó el error. En este servicio: `hagemsa-auth-service`. |
| `errores` | Solo en validación 422 | Array con detalle de errores por campo. `null` cuando no aplica. |

### Catálogo de códigos

**Comunes a todos los servicios — prefijo `COMUN_`:**

| Código | HTTP | Cuándo se devuelve |
|---|---|---|
| `COMUN_VALIDACION_FALLIDA` | 422 | DTO con campos inválidos. `errores` lista qué campos. |
| `COMUN_NO_AUTENTICADO` | 401 | Falta JWT, o el JWT es inválido/expirado. |
| `COMUN_PROHIBIDO` | 403 | JWT válido pero sin el permiso o scope requerido. |
| `COMUN_SOLICITUD_INVALIDA` | 400 | Solicitud mal formada, payload corrupto. |
| `COMUN_NO_ENCONTRADO` | 404 | Recurso inexistente (genérico). |
| `COMUN_CONFLICTO` | 409 | Conflicto genérico de estado. |
| `COMUN_LIMITE_PETICIONES` | 429 | Rate limit excedido. |
| `COMUN_ERROR_INTERNO` | 500 | Bug en el servidor. Sin detalle interno expuesto. |

**Específicos del Auth Service — prefijo `AUTH_`:** ver [Errores comunes](/integracion/errores-comunes/) para la lista completa con descripción de cada uno.

**Códigos del array `errores` (validación campo a campo, genéricos sin prefijo):**

`REQUERIDO`, `FORMATO_INVALIDO`, `LONGITUD_INVALIDA`, `VALOR_FUERA_DE_RANGO`, `VALOR_NO_PERMITIDO`, `YA_EXISTE`, `NO_ENCONTRADO`.

## Respuesta paginada (listados)

```json
{
  "datos": [ /* array de recursos */ ],
  "paginacion": {
    "pagina": 2,
    "limite": 20,
    "total": 137,
    "totalPaginas": 7,
    "tieneSiguiente": true,
    "tieneAnterior": true
  }
}
```

### Reglas

- `pagina` empieza en **`1`**, no en `0`.
- `limite` por defecto **`20`**, máximo **`100`**. Si el cliente pide más, retornar `422` con `codigo: "COMUN_VALIDACION_FALLIDA"` y detalle del campo `limite` en `errores`.
- **Lista vacía:** `datos: []`, `total: 0`, `totalPaginas: 0`, `tieneSiguiente: false`, `tieneAnterior: false`. Status `200`.
- **Único patrón permitido:** paginación por offset (`pagina/limite`). No se aceptan variantes (cursor, keyset) — todos los listados, incluido audit log y exports, usan este mismo shape.

### Query parameters

```http
GET /api/admin/cuentas?pagina=2&limite=20
```

| Query | Default | Rango | Descripción |
|---|---|---|---|
| `pagina` | `1` | ≥ 1 | Número de página (1-based). |
| `limite` | `20` | 1–100 | Items por página. |

Cada endpoint paginado puede aceptar **filtros propios** adicionales (ej. `estado`, `tipoCuenta`, `busqueda`). Ver la doc del endpoint específico.

## Respuesta de recurso individual

Todo endpoint que devuelve **un** recurso lo envuelve en `datos`:

```json
{
  "datos": {
    "id": "8c1d8a4f-3b2e-4a5d-9c7e-1b3d5f7a9c2e",
    "email": "juan@hagemsa.com",
    "nombreCompleto": "Juan Pérez",
    "tipoCuenta": "interno",
    "estado": "activo",
    "fechaCreacion": "2026-05-26T16:45:12.123Z"
  }
}
```

### Reglas

- **Crear (POST):** `201 Created` con `{ datos: recursoCreado }`. Se recomienda header `Location: /api/admin/<recurso>/<id>`.
- **Obtener uno (GET /:id):** `200 OK` con `{ datos: recurso }`. Si no existe → `404` con el error del dominio (ej. `AUTH_CUENTA_NO_ENCONTRADA`).
- **Actualizar parcial (PATCH):** `204 No Content` cuando no devuelve recurso. Si devuelve, `200 OK` con `{ datos: recursoActualizado }`.
- El recurso DENTRO de `datos` usa **camelCase del dominio en español** (`nombreCompleto`, `fechaCreacion`, `tipoCuenta`).

## Respuesta de operación sin recurso

Operaciones que cambian estado pero no devuelven recurso responden **`204 No Content` sin body**:

```
DELETE /api/admin/cuentas/8c1d.../...      → 204 No Content
POST   /api/admin/cuentas/.../suspender    → 204 No Content
POST   /api/admin/cuentas/.../reactivar    → 204 No Content
POST   /api/auth/logout                    → 204 No Content
DELETE /api/admin/roles/.../permisos/...   → 204 No Content
```

**Excepción:** si la operación produce información útil para el cliente (ej. nuevo `accessToken` tras `POST /api/auth/refresh`, o `passwordTemporal` tras `POST /api/admin/cuentas/.../reset-password`), devolver `200 OK` con `{ datos: { ... } }`.

**Async accepted:** `POST /api/auth/forgot-password` devuelve **`202 Accepted` sin body**. El cliente debe asumir que la operación está en curso; el resultado no es síncrono.

**Nunca** retornar `{ mensaje: "..." }` plano para operaciones sin recurso. Si el frontend necesita mostrar un toast, lo arma del lado del cliente.

## Códigos de estado HTTP

| Código | Significado | Body |
|---|---|---|
| `200` | OK con recurso | `{ datos: ... }` o `{ datos: [...], paginacion: ... }` |
| `201` | Creado | `{ datos: recursoCreado }` + header `Location` |
| `202` | Aceptado (async) | Sin body |
| `204` | OK sin body | — |
| `400` | Solicitud mal formada | Error del contrato |
| `401` | No autenticado | Error del contrato (`COMUN_NO_AUTENTICADO` / `AUTH_CREDENCIALES_INVALIDAS` / `AUTH_TOKEN_INVALIDO`) |
| `403` | Sin permiso | Error del contrato (`COMUN_PROHIBIDO`) |
| `404` | No encontrado | Error del contrato del dominio |
| `409` | Conflicto de estado | Error del contrato (`AUTH_CUENTA_SUSPENDIDA`, `AUTH_EMAIL_YA_REGISTRADO`, `AUTH_NOMBRE_USUARIO_YA_REGISTRADO`, `AUTH_ROL_YA_EXISTE`, `AUTH_ROL_EN_USO`, `AUTH_ROL_DE_SISTEMA_PROTEGIDO`, `AUTH_PERMISO_YA_EXISTE`, `AUTH_PERMISO_EN_USO`, etc.) |
| `422` | Validación fallida | Error del contrato con array `errores` |
| `423` | Recurso bloqueado | `AUTH_CUENTA_BLOQUEADA` (tras múltiples intentos fallidos) |
| `429` | Rate limit | `COMUN_LIMITE_PETICIONES` |
| `500` | Error interno | `COMUN_ERROR_INTERNO` (sin detalles internos expuestos) |

## Rate limiting

Los endpoints `POST /api/auth/login`, `POST /api/auth/forgot-password` y `POST /api/auth/reset-password` están limitados a **5 requests por minuto por IP** (configurable vía `@nestjs/throttler`). Excedido → `429` con `codigo: "COMUN_LIMITE_PETICIONES"`.

## Correlation ID

Cada request tiene un `X-Request-Id`. Si lo mandás en el header, el Auth Service lo respeta y lo devuelve en la response (útil para tracing distribuido). Si no, se genera uno. El mismo valor aparece como `trazaId` en el body de cualquier respuesta de error.

## Idioma

- **Mensajes al usuario** (campo `detalle`, `mensaje` de cada error de campo) → español natural con tildes.
- **Claves del JSON** → español sin tildes ni ñ.
- **Logs internos**, nombres técnicos, IDs → inglés.
