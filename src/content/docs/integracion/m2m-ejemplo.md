---
title: Ejemplo end-to-end (M2M)
description: Un caso completo, paso a paso, de un backend llamando a un endpoint protegido de otro backend con un token de servicio.
---

Este es el mismo flujo de [Comunicación backend-a-backend (M2M)](/integracion/m2m/),
pero **completo y concreto**: desde crear el cliente de servicio hasta ver el
`200` en el backend destino, con verificación y errores comunes.

:::note[Sustituí por tus backends]
El ejemplo usa **Flota** (el que llama) y **WMS / Almacenes** (el que expone el
endpoint) con el permiso `wms:inventario:read`. **Cambiá los tres por los tuyos**
(backend origen, backend destino, permiso requerido): el flujo es idéntico.
:::

## El escenario

**Flota** corre un **job nocturno** (sin ningún usuario logueado) que necesita
leer el inventario de repuestos que expone **WMS**:

```
Flota (job, sin usuario)                Auth Service                 WMS
        │                                    │                         │
        │  ①  POST /api/auth/token           │                         │
        │     {grantType, clientId, secret}  │                         │
        │───────────────────────────────────▶                         │
        │  ②  200 {accessToken (JWT), 600s}  │                         │
        │◀───────────────────────────────────                         │
        │                                                              │
        │  ③  GET /api/inventario/lima-1                               │
        │      Authorization: Bearer <accessToken>                     │
        │──────────────────────────────────────────────────────────────▶
        │  ④  el guard valida firma + permiso (wms:inventario:read)    │
        │      200 { datos: [...] }                                    │
        │◀──────────────────────────────────────────────────────────────
```

El endpoint de WMS está protegido así (nada nuevo — es el mismo `@RequirePermission`
que ya usás para usuarios):

```typescript
// WMS — inventario.controller.ts
@RequirePermission('wms:inventario:read')
@Get('inventario/:almacenId')
listar(@Param('almacenId') almacenId: string) {
  return { datos: /* ... */ };
}
```

El truco del M2M es que el **token de servicio** que consigue Flota **también
lleva permisos embebidos** — los del rol que le asignás al cliente. Si ese rol
tiene `wms:inventario:read`, el `@RequirePermission` de WMS lo deja pasar sin
distinguir si atrás hay una persona o un backend.

---

## Paso 1 — (Admin) Crear un rol con least privilege

Podés reusar un rol existente (ej. `ALMACENERO`), pero lo recomendado es un rol
**dedicado** que tenga **solo** lo que el backend necesita. Con un usuario admin
(`auth:role:manage`):

```http
POST /api/admin/roles
Authorization: Bearer <accessToken-admin>
Content-Type: application/json

{ "nombre": "SVC_FLOTA", "descripcion": "Cliente de servicio: job de inventario de Flota" }
```

Respuesta `201` → guardá el `id` del rol. Después agregale el permiso:

```http
POST /api/admin/roles/<rolId>/permisos
Authorization: Bearer <accessToken-admin>
Content-Type: application/json

{ "codigoPermiso": "wms:inventario:read" }
```

> Detalle del CRUD de roles/permisos en [Roles (admin)](/api-reference/roles/).

## Paso 2 — (Admin) Crear el cliente de servicio

Con un usuario admin (`auth:service-client:write`), creá `svc-flota` y asignale
el rol del paso 1:

```http
POST /api/admin/service-clients
Authorization: Bearer <accessToken-admin>
Content-Type: application/json

{
  "clientId": "svc-flota",
  "nombre": "Servicio de Flota",
  "descripcion": "Job nocturno de inventario",
  "roles": [{ "rolId": "<rolId-de-SVC_FLOTA>", "scope": {} }]
}
```

Respuesta `201` — **acá está el secret, se muestra una única vez**:

```json
{
  "datos": {
    "id": "8c1d...e9",
    "clientId": "svc-flota",
    "secret": "cs_a1b2c3d4e5f6..."
  }
}
```

> ⚠️ Copiá el `secret` ahora. No se puede recuperar (solo se guarda su hash
> Argon2id). Si se pierde, se [rota](/api-reference/service-clients/#post-apiadminservice-clientsidrotar-secreto).

## Paso 3 — Guardar el secret en el backend Flota

El `secret` es la credencial de largo plazo de Flota. Va a **Secret Manager**
(no al repo, no hardcodeado) y se expone por env al contenedor:

```bash
# Secret Manager / env del backend Flota
SVC_CLIENT_ID=svc-flota
SVC_CLIENT_SECRET=cs_a1b2c3d4e5f6...
AUTH_SERVICE_URL=https://auth.hagemsa.com
WMS_URL=https://wms.hagemsa.com
```

## Paso 4 — (Flota) Instalar y configurar la lib

```bash
export GOOGLE_NPM_TOKEN="$(gcloud auth print-access-token)"
pnpm add @hagemsa/auth-guard@^0.3.1
```

Registrá `forServiceClient` (es independiente de `forRoot`; podés tener los dos):

```typescript
// Flota — app.module.ts
import { AuthGuardModule } from '@hagemsa/auth-guard';

@Module({
  imports: [
    AuthGuardModule.forServiceClient({
      authServiceUrl: process.env.AUTH_SERVICE_URL!,
      clientId: process.env.SVC_CLIENT_ID!,
      clientSecret: process.env.SVC_CLIENT_SECRET!,
    }),
  ],
})
export class AppModule {}
```

## Paso 5 — (Flota) Llamar a WMS

Inyectás el `ServiceTokenProvider` y listo — él consigue, cachea y renueva el
token solo:

```typescript
// Flota — wms.client.ts
import { Injectable } from '@nestjs/common';
import { ServiceTokenProvider } from '@hagemsa/auth-guard';

@Injectable()
export class WmsClient {
  constructor(private readonly tokens: ServiceTokenProvider) {}

  async inventarioDe(almacenId: string) {
    const headers = await this.tokens.authorizationHeader();
    // headers = { Authorization: 'Bearer eyJhbGciOi...' }
    const r = await fetch(`${process.env.WMS_URL}/api/inventario/${almacenId}`, {
      headers,
    });
    if (!r.ok) throw new Error(`WMS respondió ${r.status}`);
    return r.json();
  }
}
```

```typescript
// Flota — el job nocturno que lo usa
@Injectable()
export class InventarioJob {
  constructor(private readonly wms: WmsClient) {}

  @Cron('0 2 * * *') // 2 AM, sin usuario en el medio
  async sincronizar() {
    const inventario = await this.wms.inventarioDe('lima-1');
    // ... procesar
  }
}
```

Eso es todo del lado de Flota. **No hay login, no hay refresh token, no hay
usuario.** El `ServiceTokenProvider`:

- Pide el token la primera vez y lo **cachea en memoria**.
- Lo **renueva ~60s antes de vencer** (TTL 10 min).
- Hace **single-flight**: mil llamadas concurrentes → una sola llamada a `/token`.

---

## Qué viaja por dentro

**①–② Flota consigue el token** (lo hace el provider):

```http
POST https://auth.hagemsa.com/api/auth/token
Content-Type: application/json

{ "grantType": "client_credentials", "clientId": "svc-flota", "clientSecret": "cs_a1b2c3..." }
```
```json
{ "datos": { "accessToken": "eyJhbGciOi...", "tokenType": "Bearer", "expiresIn": 600 } }
```

El `accessToken` es un JWT de servicio. Decodificado, su payload:

```json
{
  "sub": "svc-flota",
  "jti": "b3f1...c9",
  "tokenUse": "service",
  "clientId": "svc-flota",
  "roles": [
    {
      "role": "SVC_FLOTA",
      "scope": {},
      "permisos": ["wms:inventario:read"]
    }
  ],
  "iss": "https://auth.hagemsa.com",
  "aud": "hagemsa-backends",
  "iat": 1783699200,
  "exp": 1783699800
}
```

Fijate: **no** trae `email`/`name`/`type` (no hay usuario), sí trae `tokenUse:
"service"`, `clientId`, y los `permisos` embebidos.

**③–④ WMS autoriza**. El `JwtAuthGuard` de WMS:

1. Valida la firma con el JWKS del Auth Service (sin round-trip; cachea las claves).
2. `@RequirePermission('wms:inventario:read')` → recorre `roles[].permisos` del
   token → **lo encuentra** → deja pasar. Da igual que sea un token de servicio.

---

## Verificación

**Probar la emisión del token a mano** (sin la lib):

```bash
curl -s -X POST https://auth.hagemsa.com/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"grantType":"client_credentials","clientId":"svc-flota","clientSecret":"cs_a1b2c3..."}'
```

**Probar el endpoint destino con ese token:**

```bash
TOKEN=$(curl -s -X POST https://auth.hagemsa.com/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"grantType":"client_credentials","clientId":"svc-flota","clientSecret":"cs_a1b2c3..."}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).datos.accessToken')

curl -s https://wms.hagemsa.com/api/inventario/lima-1 \
  -H "Authorization: Bearer $TOKEN"
```

## Errores comunes

| Síntoma | Causa | Solución |
|---|---|---|
| `401` en `POST /api/auth/token` (`AUTH_SERVICE_CLIENT_CREDENCIALES_INVALIDAS`) | `clientId` o `clientSecret` mal | Verificá el secret; si se perdió, [rotá](/api-reference/service-clients/#post-apiadminservice-clientsidrotar-secreto). |
| `403` en el endpoint destino (`COMUN_PROHIBIDO`) | El token es válido pero el `svc-client` **no tiene el permiso** requerido | Agregá el permiso al rol del cliente (paso 1) y **volvé a pedir el token** (los permisos se resuelven al emitir; el token viejo no se actualiza hasta vencer). |
| `409` en `POST /api/auth/token` (`AUTH_SERVICE_CLIENT_SUSPENDIDO`) | El cliente de servicio está suspendido | Reactivalo con `POST /admin/service-clients/:id/reactivar`. |
| `403` con `@ServiceOnly()`/`@UserOnly()` | El endpoint restringe por tipo de token | Revisá que el tipo de token coincida con el decorador. Para M2M común, no uses esos decoradores. |
| Cambié permisos y el backend sigue con `403` | El token cacheado es viejo | Esperá el TTL (10 min) o llamá `serviceTokenProvider.invalidar()` para forzar re-emisión. |

## Rotación del secret (sin downtime)

Un cliente admite **2 secretos activos**, así podés rotar sin cortar:

1. `POST /admin/service-clients/:id/rotar-secreto` → te da un `secret` nuevo (el
   viejo sigue vivo).
2. Actualizá `SVC_CLIENT_SECRET` en Secret Manager y **redeployá** Flota.
3. Cuando confirmes que anda con el nuevo,
   [revocá el viejo](/api-reference/service-clients/#post-apiadminservice-clientsidrevocar-secretosecretoid).

## Checklist

- [ ] Rol dedicado con **solo** los permisos necesarios (least privilege).
- [ ] Cliente de servicio creado con ese rol; `secret` guardado en Secret Manager.
- [ ] `forServiceClient` configurado en el backend que llama.
- [ ] El backend destino protege el endpoint con `@RequirePermission(...)`.
- [ ] Probado con `curl` que el token trae el permiso y el endpoint responde `200`.
