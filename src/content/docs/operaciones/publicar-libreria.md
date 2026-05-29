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
