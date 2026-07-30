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

:::danger[pnpm NO lee este archivo — es la causa de los 403 al publicar]
Este repo es un workspace de pnpm, y **pnpm resuelve el `.npmrc` desde la raíz del
workspace y desde el de usuario, no desde la carpeta del paquete**. O sea que
`libs/auth-guard/.npmrc` queda ignorado por completo. Se comprueba en un segundo,
parado dentro de `libs/auth-guard`:

```bash
pnpm config get @hagemsa:registry   # -> undefined
```

Consecuencia: `pnpm publish` sale sin credencial y Artifact Registry responde
**`[E403] The caller does not have permission`**, un mensaje que hace pensar en
un problema de IAM cuando en realidad el token nunca viajó. Si te pasa,
comprobá el permiso antes de tocar IAM:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/@hagemsa%2fauth-guard"
```

Un `200` significa que la credencial y el permiso están bien y el problema es de
configuración, no de IAM.

`npm` sí expande `${GOOGLE_NPM_TOKEN}` desde el `.npmrc` del paquete, así que el
archivo se queda como está: sirve para el flujo con `npm publish`.
:::

### 3. Publicar

El `prepublishOnly` del `package.json` corre `pnpm build` automáticamente antes
de empaquetar, así que el `dist/` publicado siempre refleja el source actual.

Forma recomendada — empaquetar con pnpm y subir con npm, que sí lee el `.npmrc`
del paquete:

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

Quien publica necesita `roles/artifactregistry.writer` sobre el repo (o `owner`,
que lo incluye).

#### Alternativa: `pnpm publish` con el `.npmrc` en la raíz

`pnpm publish` **funciona**, siempre que la credencial esté donde pnpm la busca.
Así se publicó la 0.5.0 el 2026-07-30:

```bash
# Desde la RAIZ del repo, no desde libs/auth-guard
T="$(gcloud auth print-access-token)"
printf '@hagemsa:registry=https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/\n//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken=%s\n' "$T" > .npmrc

cd libs/auth-guard && pnpm publish --no-git-checks

# Borrar el .npmrc de la raiz SIEMPRE, lleva el token en claro
cd .. && rm -f .npmrc
```

:::caution[Ese `.npmrc` de la raíz lleva un token en claro]
Borralo siempre al terminar. `/.npmrc` está en el `.gitignore` del repo para que
no se pueda commitear por accidente, pero el archivo igual queda en disco.

Y si usás un `trap` para automatizar el borrado, **no lo escribas con `$PWD`**: se
evalúa al salir, cuando ya hiciste `cd` a otra carpeta, y termina borrando el
`.npmrc` equivocado. Usá la ruta absoluta.
:::

`--no-git-checks` es necesario porque `pnpm publish` exige por defecto estar en la
rama principal con el árbol limpio.

### 4. Verificar

```bash
gcloud artifacts versions list \
  --package=@hagemsa/auth-guard \
  --repository=hagemsa-npm \
  --location=us-central1 \
  --project=hagemsa-cloud
```

## Gotchas (leer antes de publicar)

### El fallo de `pnpm publish` es de configuración, no del registry

Esta sección decía que `pnpm publish` era incompatible con Artifact Registry. **No
es así**: la 0.5.0 se publicó con `pnpm publish` el 2026-07-30. Lo que falla es
*dónde* busca pnpm la credencial — ver el aviso de la sección 2. Si el `.npmrc`
está solo en `libs/auth-guard/`, pnpm no lo lee, publica sin token y el registry
devuelve `403`.

Se deja `pnpm pack && npm publish *.tgz` como forma recomendada igual, porque no
obliga a dejar un token en claro en la raíz del repo. Pero si ves un `403`, no
busques el problema en IAM ni asumas que la herramienta no sirve.

Desde **pnpm v11**, `pnpm publish` está implementado de forma nativa y ya no
delega en el CLI de `npm` ([doc oficial](https://pnpm.io/cli/publish)), que es de
donde venía la sospecha original.
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
| **0.4.0** | 2026-07-24 | **Soporte de tokens "flacos".** El guard resuelve `rol → permisos` desde el catálogo del Auth Service (`GET /api/internal/roles-permisos`, cacheado en memoria con single-flight + stale-while-revalidate) cuando el JWT llega sin permisos embebidos. Permite emitir tokens que no crecen con la cantidad de permisos (antes un usuario con muchos roles generaba un JWT de varios KB). Cambios **aditivos**: `RolEnJwt.permisos` pasa a **opcional**, `permissionCacheTtlSeconds` **vuelve a tener efecto** (TTL del catálogo, default 300s), y el nuevo `CatalogoPermisosService`. El guard acepta **ambos formatos** (gordo/flaco), así que se actualiza sin coordinar; el flip a tokens flacos (`JWT_EMBED_PERMISOS=false`) es un paso posterior. **Cada backend debe definir `AUTH_SERVICE_URL` y `AUTH_INTERNAL_SECRET`** (en el entorno **y** en el deploy) y pasarlas al `forRoot` como `authServiceUrl` / `internalSecret`: sin ellas, un token flaco da **500**. Los endpoints y decoradores del consumidor no cambian. |
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
