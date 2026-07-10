---
title: Comunicación backend-a-backend (M2M)
description: Cómo un backend obtiene un token de servicio (client credentials) para llamar a otro backend protegido.
---

El flujo normal es: el usuario se loguea en el frontend y cada backend lee **su**
token. Pero cuando un backend necesita llamar a un endpoint protegido de **otro
backend** sin un usuario en el medio (un job, un consumidor de cola, una
sincronización), no hay token de usuario que reenviar. Para eso existen los
**clientes de servicio** y el grant **OAuth2 client credentials**.

## Cómo funciona

1. Un admin crea un **cliente de servicio** en el Auth Service y le asigna los
   roles/permisos mínimos que necesita. Recibe un `clientId` + un `clientSecret`
   (el secret se muestra **una sola vez**).
2. El backend consumidor guarda el `clientSecret` en su Secret Manager.
3. En runtime, el backend canjea `clientId` + `clientSecret` por un **token de
   servicio** en `POST /api/auth/token`. Es un JWT de vida corta (**10 min**) con
   `tokenUse: "service"` y los permisos del cliente embebidos.
4. El backend presenta ese JWT como `Authorization: Bearer <token>` al llamar al
   otro backend. El `JwtAuthGuard` del destino lo valida y autoriza **igual que un
   token de usuario** — por permisos, sin round-trip.
5. Al vencer, se pide otro. **No hay refresh token**: el secret es la credencial
   de largo plazo.

```
svc-flota (backend)                Auth Service              WMS (backend)
      │                                  │                        │
      │ POST /api/auth/token             │                        │
      │  {grantType, clientId, secret}   │                        │
      │─────────────────────────────────▶                        │
      │ 200 {accessToken, expiresIn:600} │                        │
      │◀─────────────────────────────────                        │
      │                                                           │
      │ GET /api/inventario  Authorization: Bearer <svc-token>    │
      │──────────────────────────────────────────────────────────▶
      │                       200 (guard valida firma + permisos) │
      │◀──────────────────────────────────────────────────────────
```

## 1. Crear el cliente de servicio (admin, una vez)

Con un usuario que tenga `auth:service-client:write`:

```http
POST /api/admin/service-clients
Authorization: Bearer <accessToken-admin>
Content-Type: application/json

{
  "clientId": "svc-flota",
  "nombre": "Servicio de Flota",
  "roles": [{ "rolId": "<rolId>", "scope": {} }]
}
```

La respuesta trae el `secret` **una única vez** — guardalo en el Secret Manager
del backend consumidor. Detalle completo del CRUD (rotar, revocar, suspender) en
[Clientes de servicio (admin)](/api-reference/service-clients/).

## 2. Consumir tokens con `ServiceTokenProvider`

La lib `@hagemsa/auth-guard` (≥ 0.3.0) trae un `ServiceTokenProvider` que hace
trivial la adopción: cachea el token en memoria, lo **renueva proactivamente**
~60s antes de vencer y aplica **single-flight** (varias llamadas concurrentes
disparan un solo `POST /token`).

Registralo con `forServiceClient` — es **independiente** de `forRoot`. Un backend
puede validar tokens entrantes (`forRoot`) y/o emitir salientes
(`forServiceClient`):

```typescript
// app.module.ts
import { AuthGuardModule } from '@hagemsa/auth-guard';

@Module({
  imports: [
    // Emite tokens salientes hacia otros backends.
    AuthGuardModule.forServiceClient({
      authServiceUrl: process.env.AUTH_SERVICE_URL!,
      clientId: process.env.SVC_CLIENT_ID!,
      clientSecret: process.env.SVC_CLIENT_SECRET!, // desde Secret Manager
    }),
  ],
})
export class AppModule {}
```

Después, inyectá el provider donde hagas la llamada saliente:

```typescript
import { Injectable } from '@nestjs/common';
import { ServiceTokenProvider } from '@hagemsa/auth-guard';

@Injectable()
export class WmsClient {
  constructor(private readonly tokens: ServiceTokenProvider) {}

  async obtenerInventario(almacenId: string) {
    const headers = await this.tokens.authorizationHeader(); // { Authorization: 'Bearer ...' }
    const r = await fetch(`${process.env.WMS_URL}/api/inventario/${almacenId}`, {
      headers,
    });
    return r.json();
  }
}
```

`getToken()` devuelve el string del JWT si preferís armar el header a mano.
`invalidar()` descarta el token cacheado (útil si recibís un `401` inesperado y
querés forzar una re-emisión).

## 3. Restringir por tipo de token (opcional)

Por defecto un endpoint acepta **tokens de usuario y de servicio** — decide por
permisos. Si un endpoint debe restringirse a un solo tipo, usá los decoradores
opt-in:

```typescript
import { ServiceOnly, UserOnly } from '@hagemsa/auth-guard';

@ServiceOnly() // solo tokens de servicio; un token de usuario recibe 403
@Post('sincronizar')
sincronizar() { /* ... */ }

@UserOnly() // solo tokens de usuario; un token de servicio recibe 403
@Get('perfil')
verPerfil() { /* ... */ }
```

En un handler con token de servicio, `@CurrentUser()` trae `tokenUse: 'service'`
y `clientId`; `email`/`name`/`type` vienen vacíos (no hay usuario detrás).

## Seguridad

- El `clientSecret` va **solo** en el Secret Manager del consumidor, nunca en el
  código ni en el repo.
- **Least privilege:** asigná al cliente solo los roles que necesita.
- **Rotación sin downtime:** un cliente admite 2 secretos activos. Rotá, desplegá
  el nuevo secret, revocá el viejo.
- **Revocación:** suspender el cliente corta futuras emisiones; para matar un
  token vivo al instante (raro, por el TTL de 10 min) está la blacklist de `jti`.
- Cada emisión queda **auditada** (`clientId`, IP) con el evento
  `service_token_emitido`.
