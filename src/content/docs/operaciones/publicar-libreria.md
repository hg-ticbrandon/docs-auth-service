---
title: Publicar @hagemsa/auth-guard
description: Cómo publicar una nueva versión de la librería auth-guard al Artifact Registry interno.
---

La librería `@hagemsa/auth-guard` (el guard JWT que consumen los backends) vive
en el repo del Auth Service, en `libs/auth-guard/`, y se publica al **Artifact
Registry interno** para que los demás backends la instalen con una versión en
lugar de una ruta local.

- **Registry:** `https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/`
- **Repo Artifact Registry:** `hagemsa-npm` (formato npm, `us-central1`)
- **Lado consumidor:** ver [Instalación](/integracion/instalacion/).

## Crear el repo (una sola vez)

Ya está creado. Para referencia, así se hizo:

```bash
gcloud artifacts repositories create hagemsa-npm \
  --repository-format=npm \
  --location=us-central1 \
  --project=hagemsa-cloud \
  --description="Paquetes npm internos de HAGEMSA (ej. @hagemsa/auth-guard)"
```

## Publicar una versión nueva

### 1. Subir la versión

Editá `libs/auth-guard/package.json` y subí el campo `version` siguiendo SemVer
(ej. `0.1.0` → `0.1.1` para un fix, `0.2.0` para features compatibles). El
registry **rechaza** republicar una versión que ya existe.

### 2. Confirmar el `.npmrc` del paquete

`libs/auth-guard/.npmrc` ya viene versionado, sin secretos:

```ini
@hagemsa:registry=https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken=${GOOGLE_NPM_TOKEN}
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:always-auth=true
```

:::note[Acá SÍ va el `_authToken` en el `.npmrc` del proyecto — no lo "corrijas"]
Puede chocar con lo que dice
[Instalación](/integracion/instalacion/#11-configurar-el-registry-en-tu-proyecto), donde
el token va **obligatoriamente** al `~/.npmrc` de usuario. La diferencia es la
herramienta:

- **Publicar** usa **`npm publish`** (ver el gotcha de abajo). **npm sí expande**
  `${GOOGLE_NPM_TOKEN}` desde el `.npmrc` del proyecto → este flujo funciona.
- **Instalar** en los backends consumidores usa **`pnpm`**, y **pnpm 11.11+ ignora**
  credenciales del `.npmrc` del proyecto → allí el token debe ir al de usuario.

Por eso este archivo se queda como está. Si algún día el publish pasa a pnpm, hay que
mover el token al `~/.npmrc`.
:::

### 3. Publicar

El `prepublishOnly` del `package.json` corre `pnpm build` automáticamente antes
de empaquetar, así que el `dist/` publicado siempre refleja el source actual.

Forma recomendada — empaquetar con pnpm y subir con npm (ver el gotcha de abajo):

```powershell
cd libs/auth-guard
$env:GOOGLE_NPM_TOKEN = (gcloud auth print-access-token)
pnpm pack
npm publish (Get-Item *.tgz).Name
```

```bash
cd libs/auth-guard
export GOOGLE_NPM_TOKEN="$(gcloud auth print-access-token)"
pnpm pack
npm publish *.tgz
```

Quien publica necesita `roles/artifactregistry.writer` sobre el repo.

### 4. Verificar

```bash
gcloud artifacts versions list \
  --package=@hagemsa/auth-guard \
  --repository=hagemsa-npm \
  --location=us-central1 \
  --project=hagemsa-cloud
```

## Gotchas (leer antes de publicar)

### `pnpm publish` no funciona contra Artifact Registry — usar `pnpm pack && npm publish`

Desde **pnpm v11**, `pnpm publish` está implementado de forma nativa y ya no
delega en el CLI de `npm` ([doc oficial](https://pnpm.io/cli/publish)). Esa
implementación nativa falla la autenticación contra GCP Artifact Registry con
`[E401] need: Basic realm=...`, aun con el token correcto en el `.npmrc` (no arma
bien el Basic auth para registries con path).

La misma doc de pnpm documenta el workaround: **`pnpm pack && npm publish *.tgz`**.
`pnpm pack` arma el tarball (corre `prepublishOnly`, respeta `files`, y reescribe
cualquier dependencia con protocolo `workspace:` a su versión real), y `npm publish`
—que sí autentica bien con el `.npmrc` (token Bearer)— solo lo sube.

> `npm publish` directo (sin `pnpm pack`) también funciona **hoy**, porque
> `auth-guard` no tiene dependencias con protocolo `workspace:`. Si en el futuro
> las tuviera, `npm publish` directo las publicaría sin reescribir y el paquete
> quedaría roto — por eso la forma canónica es `pnpm pack && npm publish *.tgz`.

Para `install` se usa pnpm normalmente — el problema es solo en `publish`.

### El `dist/` está versionado y se compila desde el source

El `dist/` de la lib está commiteado en el repo. Si alguna vez se edita el source
de `libs/auth-guard/` y no se recompila, el `dist/` queda desactualizado y los
consumidores reciben código viejo (en el pasado esto causó `HTTP 500` por un
servicio fantasma `permission-resolver` que ya no existía en el source).

El `prepublishOnly` cubre el publish, pero al commitear cambios al source de la
lib, **recompilá y commiteá el `dist/` también**:

```bash
cd libs/auth-guard
pnpm build
git add dist
```

### El token dura ~1 hora

`gcloud auth print-access-token` da un token de corta vida. Si el publish falla
con `401`, regeneralo (`$env:GOOGLE_NPM_TOKEN = (gcloud auth print-access-token)`)
y reintentá.

## Costo

Para un paquete de decenas de KB el costo es **efectivamente $0**: cae dentro del
free tier de Artifact Registry (0.5 GB de almacenamiento). El egress hacia
consumidores dentro de GCP es mínimo.

## Historial de versiones

| Versión | Fecha | Cambios |
|---|---|---|
| **0.3.1** | 2026-07-10 | **Fix de compatibilidad (usar esta, no la 0.3.0).** La 0.3.0 había hecho `tokenUse` **requerido** en `AuthContext`, lo que rompía a los consumidores que **construyen** un `AuthContext` (mocks / usuarios por defecto): `error TS2741: Property 'tokenUse' is missing`. Ahora `tokenUse` es **opcional** en `AuthContext` (el guard lo puebla siempre; al leerlo desde `@CurrentUser()` está presente). Además `email`/`name`/`type` vuelven a ser **requeridos** en `JwtPayload` (como en 0.2.0) — el guard los normaliza a `''` para tokens de servicio. Con esto la línea 0.3.x es un **superset aditivo** de 0.2.0. |
| **0.3.0** | 2026-07-10 | ⚠️ **Superada por 0.3.1** (introdujo un tipo que rompía la compilación de algunos consumidores). Soporte **M2M / tokens de servicio**: `tokenUse` (`'user'` \| `'service'`) y `clientId` en `AuthContext` / `JwtPayload`, decoradores opt-in `@ServiceOnly()` / `@UserOnly()`, y `ServiceTokenProvider` (+ `AuthGuardModule.forServiceClient(...)`) para obtener tokens de servicio con cache, renovación proactiva y single-flight. Ver [Comunicación backend-a-backend (M2M)](/integracion/m2m/). |
| **0.2.0** | 2026-07-02 | Agrega al `AuthContext` y al `JwtPayload` los campos del **socio de negocio (BC01)**, presentes **solo si la cuenta tiene un socio vinculado**: `codigoSocio`, `codigoCuenta`, `socioExternoId`, `socioNombre`, `socioDocumento`. Cambio **aditivo** (campos opcionales): los consumidores en `0.1.0` **no se rompen**; para leer los campos nuevos hay que subir a `^0.2.0`. |
| **0.1.0** | 2026-05-29 | Versión inicial: `JwtAuthGuard`, decoradores `@CurrentUser` / `@Public` / `@RequirePermission` / `@RequireScope`, `AuthGuardModule`, cache de JWKS y `BlacklistChecker`. |

:::note[Semántica actual de `codigoSocio` / `codigoCuenta`]
La **forma** del tipo `AuthContext` / `JwtPayload` no cambió desde 0.2.0 (los
campos siguen ahí, opcionales), pero a partir del **2026-07-09** cambió su
**semántica** en el auth-service: `codigoSocio` y `codigoCuenta` pasaron a ser
**códigos de la cuenta, independientes del socio** (antes solo aparecían con un
socio vinculado). Ahora aparecen si la cuenta los tiene, con o sin socio, y
admiten **1 a 20 caracteres** (antes 2). No requiere subir de versión el lib: el
guard solo los lee del JWT.
:::

:::note[Cómo consume esto un backend]
Publicar una versión **no** actualiza a los consumidores automáticamente. Cada
backend debe subir su dependencia (`pnpm add @hagemsa/auth-guard@<versión>`),
regenerar su lockfile y **redeployar**. Ver [Instalación → Actualizar a una versión nueva](/integracion/instalacion/).
:::
