---
title: Errores comunes
description: Problemas frecuentes integrando @hagemsa/auth-guard y cómo resolverlos.
---

> Todas las respuestas de error del Auth Service siguen el contrato definido en [Convenciones de la API](/api-reference/convenciones/). Si tu lib o cliente lo ignora, vas a perder información útil: el campo `codigo` es lo que te permite distinguir errores programáticamente, y `detalle` es el mensaje legible.

## Códigos más frecuentes en integración

| `codigo` | HTTP | Significado |
|---|---|---|
| `COMUN_NO_AUTENTICADO` | 401 | Falta header `Authorization`, JWT mal formado o expirado. |
| `COMUN_PROHIBIDO` | 403 | JWT válido pero sin permiso/scope requerido. |
| `COMUN_VALIDACION_FALLIDA` | 422 | DTO con campos inválidos. El array `errores` lista qué campos. |
| `COMUN_LIMITE_PETICIONES` | 429 | Rate limit excedido. |
| `AUTH_CREDENCIALES_INVALIDAS` | 401 | Login con email/password incorrectos (genérico — no enumera cuentas). |
| `AUTH_CUENTA_BLOQUEADA` | 423 | Cuenta bloqueada por intentos fallidos. |
| `AUTH_TOKEN_INVALIDO` | 401 | Refresh token inválido, expirado o consumido. |
| `AUTH_TOKEN_REUSADO` | 401 | Reuso detectado → toda la familia de tokens revocada. El usuario debe hacer login. |
| `AUTH_SESION_REVOCADA` | 401 | El JWT pertenece a una sesión revocada (vía blacklist). |

Lista completa de códigos `AUTH_*` en [Roles](/api-reference/roles/), [Cuentas](/api-reference/cuentas/), [Sesiones](/api-reference/sesiones/), etc. — cada endpoint documenta sus propios códigos posibles.

## 401 sesión revocada cuando el JWT fue recién emitido

**Síntoma:** loguás, obtenés un JWT, llamás a tu backend y devuelve 401 con cuerpo:

```json
{
  "tipo": "https://errores.hagemsa.com/auth/sesion-revocada",
  "titulo": "Sesión revocada",
  "estado": 401,
  "codigo": "AUTH_SESION_REVOCADA",
  "detalle": "La sesión fue revocada y ya no es válida.",
  "instancia": "/api/wms/inventario",
  "fecha": "2026-05-26T16:45:12.123Z",
  "trazaId": "5b8aa5a2d2c872e8321cf3713faf9b9e",
  "servicio": "hagemsa-wms-service",
  "errores": null
}
```

**Causa más común:** el `BlacklistChecker` está consultando `/api/internal/jti/:jti/revoked` y el Auth Service devuelve 401 porque tu backend **no está mandando el `X-Internal-Secret`** correctamente. La lib aplica fail-closed y rechaza el JWT.

**Solución:** verificá que pasaste `internalSecret` en la config:

```typescript
AuthGuardModule.forRoot({
  // ...
  internalSecret: process.env.AUTH_INTERNAL_SECRET,
})
```

Y que la env `AUTH_INTERNAL_SECRET` coincide exactamente con la del Auth Service.

## 401 con codigo: COMUN_NO_AUTENTICADO y mensaje sobre kid no encontrado

**Síntoma:** validación de firma falla. El `detalle` menciona "kid" o "clave pública".

**Causa:** el JWT fue firmado con un `kid` que tu cache local del JWKS no tiene.

**Soluciones:**

1. Verificá que `jwksUrl` apunta al Auth Service correcto (no a otro entorno).
2. La lib refresca automáticamente al detectar cache miss. Si sigue fallando, hacé un fetch manual: `curl <AUTH_JWKS_URL>` y compará el `kid` con el del JWT (decodificalo en jwt.io).
3. Si el Auth Service rotó claves, esperá unos segundos para que la lib refresque.

## 403 con codigo: COMUN_PROHIBIDO

**Síntoma:** el JWT es válido pero tu backend devuelve 403.

**Causas posibles:**

1. **El rol del usuario no tiene el permiso requerido.** Verificá con un admin:
   ```http
   GET /api/admin/roles/:id  → lista los permisos del rol en datos.permisos
   ```
2. **El usuario tiene el permiso, pero el scope no coincide.** Verificá:
   - El JWT en `roles[]` muestra el scope efectivo del rol.
   - El `paramKey` del decorador coincide con el nombre del param de tu endpoint.
   - El `scopeKey` coincide con la key del JSON de scope.

## 401 con codigo: AUTH_TOKEN_INVALIDO

Mensaje genérico cuando `jsonwebtoken` no puede verificar. Habilitá logs `debug` en el guard para ver el detalle:

```typescript
NestFactory.create(AppModule, { logger: ['error', 'warn', 'log', 'debug'] })
```

Los logs del `JwtAuthGuard` te dirán si el problema es:

- `jwt malformed` → el header `Authorization` no tiene `Bearer <token>`.
- `jwt expired` → el `exp` del token ya pasó. Hay que refrescar.
- `audience invalid` → `aud` del JWT no coincide con tu config.
- `jwt issuer invalid` → `iss` no coincide.
- `invalid signature` → la clave pública no firma este JWT. Probablemente apuntás al JWKS equivocado.

## ECONNREFUSED al Auth Service

**Síntoma:** la lib loggea `Falló fetch del estado de revocación jti=X; fail-closed`.

**Causas:**

- Tu backend no tiene conectividad de red al Auth Service (VPC mal configurada, firewall, DNS).
- Estás usando `localhost` en producción.
- El Auth Service está abajo.

Probá manualmente: `curl <AUTH_BASE_URL>/health` desde el contenedor de tu backend.

## internalSecret está definido pero recibo 401 igual

**Causa probable:** el secret en tu env no coincide exactamente con el del Auth Service. La comparación es **timing-safe y exacta**, sin trim, sin case-insensitive.

Verificá:

```bash
# En tu backend
echo -n "$AUTH_INTERNAL_SECRET" | wc -c

# En el Auth Service (Cloud Run)
# Pedile al equipo de plataforma que confirme el length del secret en Secret Manager
```

Si los lengths difieren, hay un newline o espacio sobrando.

## El JWT trae el rol esperado pero el endpoint sigue dando 403

**Diagnóstico paso a paso:**

1. Decodificá el JWT (jwt.io) y mirá `roles[]`. ¿Está el rol esperado?
2. ¿El permiso esperado está en el `permisos[]` de ese rol? Si **no** está, le falta el permiso al rol — un admin debe agregárselo con `POST /api/admin/roles/:id/permisos`. El usuario tiene que refrescar el token para verlo.
3. Si el permiso **sí** está pero igual da 403, el problema es **scope**. Compará el `scope` del JWT contra lo que el endpoint exige. Compartí el JSON de `roles[]` (sin el token completo) con el equipo de plataforma para diagnosticar.

> Los permisos del JWT son **snapshot al momento de emisión**. Si cambiaron recientemente y el JWT muestra los viejos, el cambio se aplica al próximo refresh o re-login.

## Cómo usar el campo `trazaId` para soporte

Cuando reportes un problema al equipo de plataforma, **incluí siempre el `trazaId`** que viene en el body de la respuesta de error o en el header `X-Request-Id`. Eso permite correlacionar tu request específico contra los logs del Auth Service en Cloud Logging y diagnosticar en minutos.

## Vínculos útiles

- **Swagger del Auth Service:** `https://auth.hagemsa.com/docs`
- **OpenAPI spec:** `https://auth.hagemsa.com/docs-json`
- **Slack/email del equipo de plataforma:** `cloud.infra@transporteshagemsa.com`
