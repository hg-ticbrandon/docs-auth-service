---
title: Flujo del token (frontend → backends)
description: Cómo FR_HagemsaERP obtiene el JWT y lo envía a cada backend, y cómo el backend lo usa con @hagemsa/auth-guard.
---

El ecosistema HAGEMSA tiene **un solo frontend** (`FR_HagemsaERP`) que consume
**varios backends** (WMS, facturación, socio de negocio, etc.). Todos esos
backends validan el **mismo** JWT emitido por el Auth Service. Esta página explica,
de punta a punta, **cómo viaja el token** desde el navegador hasta cada backend.

## Principios de seguridad (no negociables)

1. **El JWT vive en una cookie `httpOnly`** (`hagemsa_access`). El JavaScript del
   navegador **no puede leerlo** — mitiga el robo por XSS.
2. **El navegador NUNCA pega directo al Auth Service ni a los backends.** Siempre
   pasa por el propio Next.js (mismo origen). Es un patrón **BFF**
   (Backend-For-Frontend).
3. **El navegador nunca "ve" el token.** Lo maneja el servidor de Next; al cliente
   solo le llegan datos de usuario, nunca el JWT.

## Topología

```
┌────────────┐   1. /api/...        ┌─────────────────────┐   2. Bearer <jwt>   ┌──────────────────┐
│  Navegador │ ───(cookie httpOnly)─▶│  Next.js (FR_Hagemsa)│ ───────────────────▶│  Backend (WMS,   │
│  (sin JWT) │ ◀────────────────────│  Route Handlers / BFF│ ◀───────────────────│  facturación...) │
└────────────┘   datos (no el token) └─────────────────────┘   200 / 401 / 403   │ + @hagemsa/      │
                                              │                                    │   auth-guard     │
                                              │ (login / refresh)                  └──────────────────┘
                                              ▼                                            │
                                       ┌──────────────┐                                    │ verifica firma
                                       │ Auth Service │◀───────── JWKS público ────────────┘ vía JWKS (local)
                                       └──────────────┘
```

El navegador solo habla con su propio origen (Next). Next es quien guarda el token
y lo reenvía a quien corresponda.

## Paso 1 — Login: obtener y guardar el token

El navegador manda email/password a un **Route Handler del propio Next**
(`/api/auth/login`), no al Auth Service.

```typescript
// FR_HagemsaERP — src/app/api/auth/login/route.ts (resumido)
export async function POST(request: Request) {
  const { email, password } = await request.json()
  const ipCliente = extraerIpCliente(request)

  // Llamada SERVER-SIDE al Auth Service (el navegador nunca la hace).
  const tokens = await loginContraAuthService(email, password, ipCliente)

  // Guarda accessToken + refreshToken en cookies httpOnly. El cliente NO los recibe.
  const cookieStore = await cookies()
  setCookiesSesion(cookieStore, tokens)

  // Al navegador solo le devolvemos el usuario, nunca el token.
  const payload = decodificarAccessToken(tokens.accessToken)
  return NextResponse.json({ usuario: mapearPayloadAUsuario(payload) })
}
```

Las cookies se setean así (`src/compartido/autenticacion/cookies-sesion.ts`):

```typescript
export const COOKIE_ACCESS = "hagemsa_access"
export const COOKIE_REFRESH = "hagemsa_refresh"

export const opcionesCookieSesion = {
  httpOnly: true,                                  // JS no puede leerla
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",   // solo HTTPS en prod
  path: "/",
}
```

Resultado: el navegador queda con dos cookies httpOnly (`hagemsa_access`,
`hagemsa_refresh`). Nunca tuvo el token en una variable de JS.

## Paso 2 — Enviar el token a un backend (BFF proxy)

Cuando la UI necesita datos de un backend, **no llama al backend directamente**:
llama a una ruta del propio Next (mismo origen). La cookie httpOnly viaja sola.

```typescript
// FR_HagemsaERP — src/compartido/api/cliente-http.ts
// Cliente del NAVEGADOR: pega a rutas relativas /api/... de Next.
// NO inyecta Authorization — el token vive en la cookie httpOnly y lo agrega
// el Route Handler del lado servidor.
export const clienteHttp = crearClienteHttp({ baseURL: "", timeoutMs: 8000 })
```

El **Route Handler de Next** lee la cookie, extrae el JWT e inyecta el header
`Authorization: Bearer` al reenviar al backend real:

```typescript
// FR_HagemsaERP — src/app/api/admin/[...path]/route.ts (resumido)
async function reenviar(request: NextRequest, ctx: Ctx) {
  // 1. Lee el JWT de la cookie httpOnly (server-side).
  const accessToken = await obtenerAccessToken()   // cookieStore.get("hagemsa_access")
  if (!accessToken) {
    return NextResponse.json({ message: "Sesion no iniciada." }, { status: 401 })
  }

  // 2. Reenvía al backend real inyectando el Bearer.
  const urlDestino = `${URLS_SERVIDOR.authService}/api/admin/${path.join("/")}${query}`
  const respuesta = await fetch(urlDestino, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,   // ← acá viaja el token al backend
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body: METODOS_CON_BODY.has(request.method) ? await request.text() : undefined,
  })

  // 3. Devuelve la respuesta del backend tal cual al navegador.
  return new NextResponse(await respuesta.text(), { status: respuesta.status, /* ... */ })
}
```

Así, el token solo existe en el servidor de Next; viaja al backend en el header
`Authorization`, nunca por la URL ni por el navegador.

## Paso 3 — El backend usa el token

El backend (Auth Service, WMS, facturación…) recibe `Authorization: Bearer <jwt>`
y lo procesa con **`@hagemsa/auth-guard`**, **sin volver a llamar al frontend ni
al Auth Service** para autorizar:

1. Verifica la **firma RS256** con la clave pública del **JWKS** (cacheada 24h).
2. Verifica **`iss`** (`https://auth.hagemsa.com`) y **`aud`** (`hagemsa-backends`).
3. Resuelve **permisos y scopes**: desde los claims embebidos en el JWT
   (`roles[].permisos` / `roles[].scope`) con tokens "gordos" —el default—, o desde
   el catálogo cacheado del Auth Service con tokens "flacos" (≥ 0.4.0).
4. Responde `200`, o `401` (token inválido/expirado) / `403` (sin permiso o scope).

Ver [Proteger endpoints](/integracion/proteger-endpoints/) y
[Permisos y scopes](/integracion/permisos-scopes/) para el detalle.

## Varios backends, el mismo token

Acá está la clave de por qué esto escala a N backends:

- **Todos los backends confían en el mismo emisor.** Un JWT con
  `iss=https://auth.hagemsa.com` y `aud=hagemsa-backends` es válido en **cualquier**
  backend del ecosistema. No hay que emitir un token por backend.
- **Cada backend verifica solo, vía JWKS.** No se coordinan entre sí ni llaman al
  Auth Service en cada request — descargan la clave pública una vez y verifican
  localmente. Agregar un backend nuevo no toca al Auth Service ni a los demás.
- **El frontend reenvía el mismo Bearer a cada uno.** El patrón del Paso 2 se
  repite por backend.

### Cómo sumar un backend nuevo al frontend

Replicá el patrón BFF: una ruta proxy en Next por backend, que lee la cookie y
reenvía con Bearer. Por ejemplo, para un backend de despacho:

```typescript
// src/app/api/despacho/[...path]/route.ts
import { URLS_SERVIDOR } from "@/compartido/api/config-servidor"
import { obtenerAccessToken } from "@/compartido/autenticacion/sesion-servidor"

async function reenviar(request, ctx) {
  const accessToken = await obtenerAccessToken()
  if (!accessToken) return NextResponse.json({ message: "Sesion no iniciada." }, { status: 401 })

  const { path } = await ctx.params
  const urlDestino = `${URLS_SERVIDOR.despacho}/api/${path.join("/")}${request.nextUrl.search}`
  const respuesta = await fetch(urlDestino, {
    method: request.method,
    headers: { Authorization: `Bearer ${accessToken}`, /* content-type */ },
    body: /* body crudo si aplica */,
  })
  return new NextResponse(await respuesta.text(), { status: respuesta.status })
}
export { reenviar as GET, reenviar as POST, /* PUT, PATCH, DELETE */ }
```

La URL del backend va en config **server-side** (`URLS_SERVIDOR`), **sin** prefijo
`NEXT_PUBLIC_` — no debe exponerse al navegador.

:::caution[Regla de oro para no romper la seguridad]
Toda llamada a un backend protegido **debe pasar por un Route Handler de Next**
que lea la cookie httpOnly e inyecte el Bearer. Un cliente que llame al backend
**directo desde el navegador** no puede adjuntar el JWT (está en cookie httpOnly,
ilegible por JS) → el backend responde `401`. Si ves un cliente del navegador
apuntando a la URL de un backend, falta el proxy BFF.
:::

## Refresh transparente

El access token dura ~1 hora. El **middleware** de Next (`src/proxy.ts` +
`refrescar-sesion.ts`) detecta cuando está por expirar y, usando el
`hagemsa_refresh`, pide un par nuevo al Auth Service y reescribe las cookies —
todo del lado servidor, sin que el usuario ni la UI se enteren. Si el refresh
falla (expiró o fue revocado), redirige a `/login`.

## Resumen: qué corre dónde

| Pieza | Dónde corre | Qué hace con el token |
|---|---|---|
| Navegador | Cliente | Nunca lo ve; solo manda cookies same-origin a Next |
| Route Handlers `/api/*` (Next) | Servidor de Next | Lee la cookie httpOnly, inyecta `Authorization: Bearer` hacia el backend |
| Middleware `proxy.ts` (Next) | Servidor de Next (Edge) | Refresca el token transparentemente |
| Backend + `@hagemsa/auth-guard` | Cada backend | Verifica firma (JWKS), iss/aud/exp, permisos/scopes |
| Auth Service | Servicio central | Emite los tokens y publica el JWKS; no se llama en cada request |
