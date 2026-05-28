---
title: Seguridad
description: Decisiones de seguridad del Auth Service.
---

## Reglas inquebrantables

Estas reglas son **absolutas** (ver `CLAUDE.md §5.3` en el repo). Si te encuentres tentado a romperlas, primero pregunta.

| # | Regla |
|---|---|
| 1 | **NUNCA loggear** passwords, tokens, secrets, refresh tokens — ni en debug |
| 2 | **NUNCA exponer** stack traces o mensajes internos en respuestas HTTP de error 500 |
| 3 | **NUNCA poner JWT en URL.** Solo en header `Authorization: Bearer ...` |
| 4 | **NUNCA guardar passwords en plaintext.** Siempre Argon2id |
| 5 | **NUNCA hardcodear secretos** en código. Siempre vía Secret Manager o env vars |
| 6 | **NUNCA confiar en input del usuario.** Validar con class-validator antes de pasar al dominio |
| 7 | **NUNCA exponer info que permita enumerar cuentas.** `"Credenciales inválidas"` genérico, no `"email no existe"` |
| 8 | **El audit log es append-only.** Nunca UPDATE ni DELETE en `audit.auth_events` |

## Password hashing — Argon2id

- Algoritmo: `argon2id` (RFC 9106).
- Memoria: 64MB (parametrizable).
- Iteraciones: ≥3.
- Lanes: 4.
- Resistente a GPU/ASIC. Recomendado por OWASP (2024+).

**Verificación timing-safe:** `argon2.verify()` internamente compara los hashes en tiempo constante.

## JWT — RS256

- Algoritmo: **RS256** (RSA SHA-256), asimétrico.
- Tamaño de clave: 2048 bits.
- TTL access token: **1 hora** (configurable via `JWT_ACCESS_TTL_SECONDS`).
- TTL refresh token: **30 días** (configurable via `JWT_REFRESH_TTL_SECONDS`).

**Por qué RS256 y no HS256:**

- HS256 requiere compartir un secreto con cada backend que valide JWT → si un backend se compromete, todos quedan comprometidos.
- RS256 expone solo la clave **pública**. La privada nunca sale del Auth Service.
- Rotar claves no requiere distribuir nada — los backends descubren el nuevo `kid` vía JWKS automáticamente.

### `JWT_PRIVATE_KEY` no es un "JWT secret" cualquiera

En muchos tutoriales y proyectos basados en `jsonwebtoken` con HS256 vas a ver una sola env var del estilo `JWT_SECRET=mistring`. Acá tenemos algo diferente:

| | Tutoriales con `JWT_SECRET` (HS256) | Este proyecto (RS256) |
|---|---|---|
| Cuántas envs | Una (`JWT_SECRET`) | Dos (`JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY`) |
| Formato | String aleatorio | PEM estructurado (BEGIN/END) |
| Firma | Misma string firma y verifica | Solo la privada firma |
| Verifica | Misma string | Cualquiera con la pública |
| Quién la tiene | Todos los servicios que verifican | Solo el Auth Service tiene la privada; los demás descubren la pública vía JWKS |
| Si se filtra el secreto | Cualquiera firma como cualquier usuario | Cualquiera firma como cualquier usuario (la privada cumple el mismo rol) |
| Rotación | Coordinar despliegue de todos los servicios a la vez | Publicar nuevo `kid` en JWKS, los verifiers lo adoptan solos |

**Conclusión práctica:** `JWT_PRIVATE_KEY` cumple el mismo rol funcional que ese "JWT secret" — firmar tokens — y debe protegerse con el mismo nivel de paranoia. Pero **no son lo mismo técnicamente**: es la mitad privada de un par RSA, viene con una contraparte pública, y permite el modelo "un emisor, muchos verifiers" que es el corazón del diseño de este servicio.

### El par de claves es único y fijo para todo el servicio

`JWT_PRIVATE_KEY` y `JWT_PUBLIC_KEY` **no cambian** por usuario ni por backend consumidor. Es **un solo par criptográfico** para todo el Auth Service:

- **Todos los usuarios** que hacen login reciben un JWT firmado con la misma `JWT_PRIVATE_KEY`.
- **Todos los backends** verifican con la misma `JWT_PUBLIC_KEY` (la fetchean del JWKS).
- Lo único que **varía por sesión** es el JWT en sí (con su `sub`, `jti`, `roles[]`, `permisos[]`, `iat`, `exp` propios). La clave que lo firma es la misma.
- El par solo cambia cuando se **rotan claves**: rotación inicial (deploy), rotación programada periódica, o rotación de emergencia por compromiso.

Analogía: pensalo como el sello de un notario. Hay **un solo sello** (`JWT_PRIVATE_KEY`). Lo usa para sellar miles de documentos distintos (los JWT de cada usuario). Cualquiera con una copia pública del molde del sello (`JWT_PUBLIC_KEY`) puede verificar si un documento es auténtico, pero solo el notario puede sellar nuevos.

## Modelo de amenaza: ¿qué pasa si alguien roba la clave pública y un JWT?

Esta es una pregunta razonable y la respuesta resumida es: **el modelo está diseñado para que esa combinación NO permita atacar.** Lo desglosamos por escenarios.

### Roban solo la clave pública

**Daño: ninguno.** La clave pública es **pública por diseño** — el Auth Service la expone en `/.well-known/jwks.json` para que cualquiera la lea. No es secreto. Lo único que permite hacer es **verificar** firmas que ya existen. Es matemáticamente imposible firmar nuevos JWT con ella (la firma RSA solo funciona con la privada).

### Roban el JWT de un usuario

**Daño: sí hay riesgo, pero acotado y mitigado.** Es el equivalente a robar una cookie de sesión. Mientras el JWT no haya expirado y el `jti` no esté revocado, el atacante puede suplantar a ese usuario específico en los backends.

**Lo que NO puede hacer aún con el JWT en mano:**

- Modificar el `sub` para suplantar a **otro** usuario (rompe la firma — el verifier lo rechaza).
- Escalar privilegios cambiando `roles[]` o `permisos[]` (rompe la firma).
- Extender el `exp` para que dure más tiempo (rompe la firma).
- Crear JWT nuevos desde cero (necesita la privada).

**Las mitigaciones que el sistema ya tiene:**

| Capa | Cómo limita el ataque |
|---|---|
| **TTL corto del access token** (15 min) | El JWT robado expira solo en máximo 15 min. Después es papel mojado. |
| **Cookies `httpOnly`** | El JWT vive en cookie httpOnly que JavaScript no puede leer. Bloquea XSS, el vector #1 de robo. |
| **HTTPS + `Secure`** | El JWT viaja siempre por TLS. Un atacante en la red local no lo ve. |
| **`SameSite=Lax`** | Las cookies no se envían a sitios cruzados. Mitiga CSRF. |
| **Blacklist de `jti`** | Si detectás el robo, el admin revoca el `jti` y el token muere al instante. |
| **Refresh token rotation con detección de reuso** | Si el atacante usa un refresh viejo, se revoca toda la familia automáticamente. |
| **Audit log append-only** | Cada login, refresh y revocación queda registrado con IP y user-agent. Comportamiento anómalo se detecta. |

### Roban pública + JWT

**Daño: idéntico al caso anterior.** Tener la pública no agrega capacidad de ataque. Lo único que el atacante podría hacer con la pública es verificar que el JWT que ya tiene es legítimo — y eso lo sabe igual sin la pública (lo recibió del usuario o del cliente comprometido).

### Roban la **privada**

**Daño: catastrófico.** Es el único caso que sí compromete todo el sistema. El atacante puede firmar JWT como cualquier usuario (incluyendo `SUPER_ADMIN`) y los backends los aceptarán porque la firma es válida.

**Por eso la privada se protege con todas las capas posibles:**

- Vive en **GCP Secret Manager**, nunca en código, imágenes Docker, ni repos.
- Solo el contenedor de Cloud Run del Auth Service la inyecta como env var en runtime.
- Logs nunca la imprimen (ni en debug ni en stack traces).
- Permisos granulares: solo el service account del Auth Service tiene `secretAccessor` sobre `jwt-private-key`.
- Si se compromete: **rotación inmediata**. Nuevo par RSA, deploy del Auth Service, los JWT viejos quedan inválidos automáticamente porque el nuevo `kid` no aparece en JWKS.

### Tabla resumen del modelo de amenaza

| Escenario | ¿Comprometido? | Daño | Mitigación principal |
|---|---|---|---|
| Atacante tiene solo la pública | Sí (siempre — es pública) | Ninguno | N/A — es pública por diseño |
| Atacante tiene un JWT de usuario | Sí | Suplantar a ese usuario por max 15 min | TTL corto + httpOnly + blacklist |
| Atacante tiene pública + JWT | Igual que solo JWT | Igual que solo JWT | Las mismas |
| Atacante tiene la **privada** | Catastrófico | Puede emitir JWT como cualquier usuario | Secret Manager + rotación inmediata |

### El concepto clave

> En criptografía asimétrica, **la seguridad no depende de ocultar la pública**. Depende de mantener la privada en secreto.

El nombre "clave pública" puede confundir — suena a que "es una clave, debería ser secreta". Pero por definición y por diseño:

- **Pública** = se publica activamente; todos la deben tener para verificar firmas.
- **Privada** = se guarda celosamente; solo el emisor la tiene para crear firmas.

Si la pública tuviera que ser secreta, todo el modelo se rompería: ningún backend podría verificar JWT sin pedírsela al Auth Service primero, y volveríamos al modelo HMAC con sus problemas (un secreto compartido entre N servicios).

Este patrón es el mismo que usan SSL/TLS (toda la web), OAuth 2.0 / OIDC (Google, Auth0, AWS Cognito), GPG, SSH y firma de paquetes (apt, npm). Está validado por décadas de uso en producción y revisión académica.

## Refresh token rotation + detección de reuso

Cada `POST /api/auth/refresh` rota el token: el viejo queda como `used_at`, se emite uno nuevo. Mismo `family_id`.

**Reuso detectado:** si alguien intenta usar un token con `used_at != null`, asumimos compromiso:

1. Se revoca **toda la familia** (`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = X`).
2. Se emite evento `refresh_reuso_detectado`.
3. El usuario tiene que volver a hacer login desde cero.

## Blacklist + fail-closed

`POST /api/auth/logout` agrega el `jti` a `sessions.revoked_jtis` hasta su `exp`. Los backends consultan `/api/internal/jti/:jti/revoked` con cache 30s.

**Fail-closed:** si el endpoint no responde, los backends asumen revocado y rechazan. Filosofía: preferimos rechazar accesos válidos por unos segundos que dejar pasar sesiones comprometidas.

## Rate limiting

Implementado con `@nestjs/throttler`:

- `POST /api/auth/login`: 5 req/min/IP
- `POST /api/auth/forgot-password`: 5 req/min/IP
- `POST /api/auth/reset-password`: 5 req/min/IP

En el futuro: agregar throttling por cuenta también (no solo por IP), para evitar account-locking por terceros desde IPs distintas.

## Logging — scrubbing

`JsonLogger` (`shared/infrastructure/observability/`) escanea recursivamente los objetos antes de loggear y **redacta** keys sensibles:

- `password`, `pwd`
- `accessToken`, `refreshToken`, `token` (en cualquier nivel del objeto)
- `secret`, `apiKey`, `authorization`
- `passwordHash`, `password_hash`

Valor reemplazado por `'[REDACTED]'`.

## Endpoints internos

`GET /api/internal/*` solo accesibles con header `X-Internal-Secret`. Comparación timing-safe contra `process.env.INTERNAL_SHARED_SECRET`.

Si la env no está definida → el guard **permite** (modo dev local), pero loggea warn una vez por proceso.

## Self-protection de `/api/admin/*`

Todos los endpoints `/api/admin/*` están protegidos por **JwtAuthGuard global** + `@RequirePermission('auth:*')` específico por endpoint. El **actor** del comando (`suspendidoPor`, `creadoPor`, etc.) sale del JWT verificado, **no del body** del request. Esto previene impersonation.

## Cleanup de tokens expirados

Cron job (`@nestjs/schedule`) corre cada hora:

- Borra `refresh_tokens` con `revoked_at IS NOT NULL AND revoked_at < now() - 7 days` (ventana forense).
- Borra `revoked_jtis` con `expires_at < now()`.
- Borra `password_reset_tokens` con `expires_at < now() OR used_at IS NOT NULL`.

Idempotente — si N instancias del Auth Service corren a la vez, el primer DELETE limpia, los demás borran 0 filas.

## Postura ante incidentes

Si sospechás compromiso de:

- **Clave privada JWT:** rotar inmediatamente. Generar nuevo par RSA, subirlo a Secret Manager, redeploy. Los JWTs viejos quedan inválidos (nuevo `kid` no aparece en JWKS).
- **Internal shared secret:** rotar en Secret Manager. Todos los backends deben recibir el nuevo simultáneamente. Mientras se propaga, hay un período de `fail-closed` que rechaza algunas requests.
- **DB completa:** las passwords están en Argon2id, los refresh tokens están hasheados. El atacante no puede usar nada directamente — pero forzar logout global de todos los usuarios es prudente.

## Auditabilidad

15 tipos de evento canónicos cubren toda acción sensible (login, logout, cambios de password, suspensión, asignación de roles, revocación de sesión). El `audit.auth_events` es append-only y replica a sistemas externos (BigQuery, SIEM) en el roadmap.
