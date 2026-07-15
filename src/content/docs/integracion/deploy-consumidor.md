---
title: Desplegar a Cloud Run
description: Empaquetar y desplegar a Cloud Run un backend NestJS que consume @hagemsa/auth-guard desde el Artifact Registry privado.
---

Esta guía cubre cómo **construir y desplegar a Google Cloud Run** un backend
**NestJS** que usa `@hagemsa/auth-guard`. Aplica igual a todos los backends del
ecosistema HAGEMSA: siguen el mismo estándar (NestJS + pnpm), así que el setup
de deploy es el mismo salvo dos variaciones que se marcan abajo (usar Prisma y/o
dependencias nativas).

:::note[El guard NO complica el runtime]
Lo único que se complica al desplegar es **autenticar el `pnpm install` contra el
registro privado** durante el build. En **runtime** el contenedor solo ejecuta la
lib ya empaquetada en la imagen y descarga el JWKS público — no necesita token ni
acceso al registry. Ver [Instalación](/integracion/instalacion/#1-4-en-ci-cloud-run).
:::

## Cómo usar esta guía

Elegí un camino:

- **Lo hago a mano** → seguí las secciones **1 a 4** en orden.
- **Que lo haga una IA** → andá directo a la [Sección 6](#6-prompt-para-que-tu-ia-lo-implemente)
  y pegale el prompt en tu agente (Claude Code, Cursor, etc.) abierto en la raíz
  del backend. El prompt es **autocontenido**: trae todos los archivos y el
  contexto que la IA necesita, no hace falta que le pases nada más.

En los comandos y archivos hay **placeholders entre `<...>`** que tenés que
reemplazar por tus valores:

| Placeholder | Qué es | Ejemplo |
|---|---|---|
| `<TU_PROYECTO>` | Project ID de GCP donde corre tu backend | `hagemsa-cloud` |
| `<REPO_DOCKER>` | Repo Docker de Artifact Registry = **código del bounded context** (ver 1.2) | `bc14`, `bc01`… |
| `<NOMBRE_DEL_SERVICIO>` | Nombre del servicio en Cloud Run | `bc14-cs-facturacion` |
| `<SA-DEL-BUILD>` | Service account que corre el build (Sección 1.3) | `123456789-compute@developer.gserviceaccount.com` |

Los valores **fijos** (no se cambian, son los mismos para todos los backends) son
el registro privado y el Auth Service:

- Registro npm privado: `hagemsa-npm` en `us-central1`, proyecto `hagemsa-cloud`.
- Auth Service: `https://auth.hagemsa.com` (JWKS público en `/.well-known/jwks.json`).

## 1. Pre-requisitos en Google Cloud (una sola vez)

Si tu backend se despliega en el **mismo proyecto** que ya corre otros servicios
HAGEMSA (`hagemsa-cloud`), lo más probable es que **ya esté todo configurado** y
puedas saltar a la Sección 2. Verifica/crea lo siguiente:

1. **APIs habilitadas** en el proyecto del backend:

   ```bash
   gcloud services enable cloudbuild.googleapis.com run.googleapis.com \
     artifactregistry.googleapis.com --project=<TU_PROYECTO>
   ```

2. **Repo Docker en Artifact Registry** donde se guarda la imagen.

   **Convención: el repo se nombra con el código del bounded context** al que
   pertenece tu backend (ej. `bc14`, `bc01`), así las imágenes quedan agrupadas
   por dominio. El Auth Service usa `auth` (su propio contexto).

   :::note[Solo define dónde se guarda la imagen]
   El `_AR_REPO` **no afecta cómo corre el servicio** — es únicamente el "estante"
   de Artifact Registry donde queda la imagen. Sirve para organizar por bounded
   context, aplicar permisos y políticas de limpieza por repo, y nada más.
   :::

   Listá los repos que ya existen:

   ```bash
   gcloud artifacts repositories list --location=us-central1 --format="table(name,format)"
   ```

   Si el repo de tu bounded context todavía no existe, creálo (formato **docker**,
   nombrándolo con el código del BC):

   ```bash
   gcloud artifacts repositories create <CODIGO_BC> \
     --repository-format=docker --location=us-central1 --project=<TU_PROYECTO>
   ```

   > Algunos backends antiguos cayeron en el repo genérico `cloud-run-source-deploy`
   > (lo crea Cloud Run al usar `gcloud run deploy --source .`). Para los nuevos,
   > usá el código del bounded context.

3. **Lectura del registro npm privado para la service account del build.** La SA
   que corre el build (por defecto la **Compute Engine default SA**
   `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`, o la SA propia del
   trigger) necesita `roles/artifactregistry.reader` sobre el repo `hagemsa-npm`.
   Si tu backend vive en **otro proyecto GCP**, es un grant **cross-project** hacia
   `hagemsa-cloud`:

   ```bash
   gcloud artifacts repositories add-iam-policy-binding hagemsa-npm \
     --project=hagemsa-cloud \
     --location=us-central1 \
     --member="serviceAccount:<SA-DEL-BUILD>" \
     --role="roles/artifactregistry.reader"
   ```

:::tip[En el mismo proyecto, ya suele estar listo]
En `hagemsa-cloud` la Compute SA tiene `roles/editor` y la SA de Cloud Build tiene
`cloudbuild.builds.builder` — ambas ya pueden leer `hagemsa-npm` y desplegar a
Cloud Run (`run.admin`). El servicio de Cloud Run se **crea solo** en el primer
deploy; no hay que pre-crearlo.
:::

## 2. Archivos en tu repo

### 2.1 `.npmrc` (raíz)

Enruta el scope `@hagemsa` al registry privado. **Solo el mapeo de registry — sin
token.** Detalle completo en
[Instalación](/integracion/instalacion/#1-1-configurar-el-registry-en-tu-proyecto).

```ini
@hagemsa:registry=https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:always-auth=true
```

:::danger[NO pongas el `_authToken` en el `.npmrc` del proyecto]
Desde **pnpm 11.11**, una credencial con `${VARIABLE}` en el `.npmrc` **del
proyecto** se **ignora a propósito** (el archivo se commitea y podría filtrar el
secreto a un registry hostil). pnpm avisa y sigue de largo:

```text
[WARN] Ignored project-level auth setting "//us-central1-npm.pkg.dev/.../:_authToken"
in ".../.npmrc": environment variables are not expanded in registry credentials that
come from a project .npmrc... Move this credential to a trusted source that pnpm still
expands — put the line in your user-level ~/.npmrc, or set it with pnpm config set
```

Y el install muere con `ERR_PNPM_FETCH_403` / `401` **aunque el token sea válido y
esté presente**. Por eso el token va al `.npmrc` **de usuario** (abajo y en el
Dockerfile), nunca al del repo.

Si pineás un pnpm anterior a 11.11 el token en el `.npmrc` del proyecto todavía
funciona — pero es una bomba de tiempo: en cuanto pnpm suba (o uses `pnpm@latest`),
el build rompe.
:::

**Para desarrollo local**, el token va a tu `~/.npmrc` de usuario. `pnpm config set`
lo escribe ahí:

```bash
pnpm config set "//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken" "$(gcloud auth print-access-token)"
```

> El token de `gcloud` **caduca en ~1h**: cuando vuelvas a ver un `403`, repetí ese
> comando. Para que se renueve solo, usá `npx google-artifactregistry-auth`.

### 2.2 `pnpm-workspace.yaml`

Excluí el paquete interno de la política de antigüedad mínima (si no, un deploy
justo después de publicar una versión nueva del guard falla con `minimumReleaseAge`):

```yaml
# ... tu config existente ...
minimumReleaseAgeExclude:
  - '@hagemsa/*'
```

:::caution[Usá el patrón `@hagemsa/*`, NO fijes la versión]
`minimumReleaseAge` existe para protegerte de paquetes **públicos** comprometidos;
los paquetes **propios de la organización** no necesitan cuarentena. Por eso se
excluye el scope entero.

Si fijás la versión (`- '@hagemsa/auth-guard@0.2.0'`), la exclusión **deja de
aplicar en silencio** apenas subís el guard a otra versión, y el build falla raro
tiempo después sin que nadie relacione la causa. `@hagemsa/*` sobrevive cualquier
bump.
:::

> Si tu proyecto no tiene `pnpm-workspace.yaml`, creálo en la raíz solo con ese
> bloque (y quitalo de la línea `COPY` del Dockerfile si no aplica).

### 2.3 `.dockerignore` (raíz)

```gitignore
node_modules
**/node_modules
dist
*.tsbuildinfo
.git
.gitignore
.env
.env.*
*.local
*.pem
*.key
Dockerfile
.dockerignore
*.log
coverage

# IMPORTANTE: NO ignorar .npmrc — el Dockerfile lo COPIA para enrutar el scope
# @hagemsa al registry privado. Si lo ignorás, el `COPY ... .npmrc ./` falla.
```

:::note[Lo que mantiene el token fuera de la imagen es el multi-stage, no esto]
Confusión habitual: `.dockerignore` **no** es lo que protege el secreto. De hecho el
`.npmrc` del repo **no tiene** secretos (solo el mapeo de registry, ver 2.1).

El token se escribe en `/root/.npmrc` **dentro del stage `deps`**, y ese stage se
**descarta**: a la imagen final (`runner`) solo se copia `node_modules`/`dist`. Por
eso el token nunca llega al contenedor publicado.
:::

### 2.4 `Dockerfile`

Versión base para un backend NestJS **sin Prisma ni dependencias nativas**:

```dockerfile
# syntax=docker/dockerfile:1.7
# Backend NestJS que consume @hagemsa/auth-guard. Target: Google Cloud Run.

# ---- deps: instala dependencias (incl. la libreria privada) ----
FROM node:22-alpine AS deps
WORKDIR /app

# Token OAuth del Artifact Registry npm. CADUCA EN ~1h: pasarlo SIEMPRE fresco
# en build-time con --build-arg (ver cloudbuild.yaml).
ARG GOOGLE_NPM_TOKEN

RUN corepack enable && corepack prepare pnpm@latest --activate

# El .npmrc del repo enruta el scope @hagemsa (sin token) -> hay que copiarlo.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Debug opcional: confirma que el token NO llega vacio (no filtra el valor).
RUN node -e "console.log('GOOGLE_NPM_TOKEN length:', ('$GOOGLE_NPM_TOKEN'||'').length)"

# El token va al .npmrc de USUARIO (/root/.npmrc), NO al del proyecto: pnpm 11.11+
# ignora credenciales del .npmrc del repo (ver 2.1). Este stage se descarta, asi
# que el token no llega a la imagen final.
RUN printf '//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken=%s\n' "$GOOGLE_NPM_TOKEN" > /root/.npmrc

RUN pnpm install --frozen-lockfile

# ---- build: compila TS ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN pnpm run build
RUN pnpm prune --prod

# ---- runner: imagen final minima ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
# Ajustá la ruta al entrypoint real de tu build (ver tu script "start:prod").
CMD ["node", "dist/main"]
```

:::caution[Pinea la versión de pnpm]
`pnpm@latest` funciona, pero para builds reproducibles reemplazá `@latest` por la
versión que generó tu `pnpm-lock.yaml` (ej. `pnpm@11.0.8`). Confirmá la ruta del
`CMD` con tu script `start:prod` (`dist/main` o `dist/src/main`).
:::

:::note[Prisma es el estándar HAGEMSA — casi todos los backends lo usan]
Si tu backend usa Prisma (lo normal en este ecosistema), ajustá el Dockerfile:

- En los stages `deps`/`build`/`runner`: instalá OpenSSL para el engine de Prisma
  (`RUN apt-get update && apt-get install -y --no-install-recommends openssl`) con
  base `node:22-bookworm-slim` en vez de `alpine`. **El síntoma de saltearte esto**
  es este warning en cada build (el engine igual arranca, pero adivinando la
  versión — no lo ignores):

  ```text
  prisma:warn Prisma failed to detect the libssl/openssl version to use,
  and may not work as expected. Defaulting to "openssl-1.1.x".
  ```
- En `build`, antes de `pnpm run build`: `RUN pnpm exec prisma generate`.
- En `runner`, copiá también `prisma/`, **`prisma.config.ts`** (y `generated/` si existe).
- Mové **`prisma` a `dependencies`** (no `devDependencies`), o `pnpm prune --prod`
  lo borra y el `migrate deploy` del arranque falla con `prisma: not found`.
- Decidí **cuándo corren las migraciones** (ver el callout de abajo). Si elegís que
  las corra el contenedor, usá un `docker-entrypoint.sh` que ejecute
  `pnpm exec prisma migrate deploy` antes de arrancar (guardalo con finales de
  línea **LF**).
- **`prisma.config.ts` DEBE declarar el datasource** (ver 2.5.1). Si no lo declara,
  el `migrate deploy` falla con *"The datasource.url property is required in your
  Prisma config file"* — el error más común al desplegar un backend con Prisma.
- **`DATABASE_URL` en runtime:** Cloud Run necesita la URL de la base (con
  credenciales) para migrar y conectar → va por **Secret Manager**
  (`--set-secrets=DATABASE_URL=<secreto>:latest`), nunca en `--set-env-vars`.
:::

:::tip[Dos estrategias para correr las migraciones — elegí una]
El `docker-entrypoint.sh` **no es obligatorio**. Hay dos caminos válidos y conviene
elegir a conciencia:

**A. Migrar en el arranque del contenedor** (el entrypoint de 2.5). Cada instancia
corre `prisma migrate deploy` al arrancar. Prisma serializa con *advisory locks*, así
que varias instancias en paralelo no se pisan.
- ✅ Imposible olvidarse de migrar; la base siempre acompaña al código desplegado.
- ❌ Encarece el **arranque en frío** y **ata el deploy a la migración**: si una
  migración falla, el servicio no levanta.

**B. Migrar aparte del deploy** (job, step previo, o a mano). El contenedor solo
arranca la app; el Dockerfile no lleva entrypoint.
- ✅ Control de **cuándo** migrás; arranque más liviano; un deploy no se cae por una
  migración.
- ❌ Requiere disciplina: si desplegás código que espera una columna que todavía no
  existe, rompe en runtime.

**BC-03 usa la B** y funciona bien. Si elegís B, saltate 2.5 y dejá el
`CMD ["node", "dist/main"]`.
:::

:::note[Variación B — el backend tiene dependencias nativas]
Si usás `argon2`, `bcrypt` u otra dep con bindings nativos, el stage `deps`
necesita toolchain: `RUN apt-get update && apt-get install -y --no-install-recommends
python3 make g++` (base `bookworm-slim`).
:::

### 2.5 `docker-entrypoint.sh` (solo si usás Prisma)

Guardar con finales de línea **LF**. Requiere `prisma` en `dependencies` y que
`DATABASE_URL` esté disponible en runtime (Secret Manager, ver 2.6).

```sh
#!/bin/sh
set -e
echo "[entrypoint] prisma migrate deploy..."
pnpm exec prisma migrate deploy
echo "[entrypoint] starting server..."
exec node dist/main
```

### 2.5.1 `prisma.config.ts` (solo si usás Prisma — raíz)

Desde Prisma 6/7, cuando existe un `prisma.config.ts` la CLI **deja de leer la URL
del bloque `datasource` de `schema.prisma`** y **deja de cargar `.env` sola**. Por
eso `prisma migrate deploy` (en el arranque del contenedor) falla con:

```text
Error: The datasource.url property is required in your Prisma config file when using prisma migrate deploy.
```

**El fix es declarar el datasource en el propio `prisma.config.ts`**, apuntando a
`env('DATABASE_URL')` (mismo patrón que usa el Auth Service):

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  // Si ya tenías un bloque migrations/seed, CONSERVALO.
});
```

> `import 'dotenv/config'` reemplaza la carga automática de `.env` (útil en local).
> Requiere que `dotenv` esté en **`dependencies`** (no `devDependencies`), o el
> `migrate deploy` del arranque crashea por módulo faltante. `env('DATABASE_URL')`
> se resuelve desde el entorno: en Cloud Run, esa variable la inyecta el deploy vía
> Secret Manager (2.6). En el build, el `prisma generate` corre con un
> `DATABASE_URL` **placeholder** (no conecta a la base; solo genera el client).

### 2.6 `cloudbuild.yaml`

No se puede usar `gcloud run deploy --source .` (no permite `--build-arg` y el
install necesita el token). Por eso este pipeline: **se asegura de que el repo
Docker exista** (lo crea si falta, sin tocar lo que ya tenga dentro), saca un
token fresco, hace build pasándolo, push y deploy:

```yaml
steps:
  - id: ensure-repo
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim'
    entrypoint: bash
    args:
      - -c
      - |
        gcloud artifacts repositories describe ${_AR_REPO} --location=${_REGION} --project=$PROJECT_ID >/dev/null 2>&1 \
        || gcloud artifacts repositories create ${_AR_REPO} --repository-format=docker --location=${_REGION} --project=$PROJECT_ID

  - id: token
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim'
    entrypoint: bash
    args: ['-c', 'gcloud auth print-access-token > /workspace/npm_token.txt']

  - id: build
    name: 'gcr.io/cloud-builders/docker'
    entrypoint: bash
    args:
      - -c
      - |
        docker build \
          --build-arg GOOGLE_NPM_TOKEN="$$(cat /workspace/npm_token.txt)" \
          -t ${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG} .

  - id: push
    name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG}']

  - id: deploy
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim'
    entrypoint: gcloud
    args:
      - run
      - deploy
      - ${_SERVICE}
      - --image=${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG}
      - --region=${_REGION}
      - --platform=managed
      - --allow-unauthenticated
      - --set-env-vars=AUTH_JWKS_URL=https://auth.hagemsa.com/.well-known/jwks.json,AUTH_JWT_ISSUER=https://auth.hagemsa.com,AUTH_JWT_AUDIENCE=hagemsa-backends

images:
  - '${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG}'

substitutions:
  _REGION: us-central1
  _AR_REPO: <REPO_DOCKER>        # repo DOCKER de Artifact Registry (no el npm)
  _SERVICE: <NOMBRE_DEL_SERVICIO>
  _TAG: v1

options:
  logging: CLOUD_LOGGING_ONLY
```

> `$$(...)` escapa el `$` para que lo evalúe bash, no Cloud Build. Usá `${_TAG}`,
> **no** `$COMMIT_SHA` (llega vacío en `builds submit` manual). Las env vars del
> guard van en `--set-env-vars`; los secretos (ej. `AUTH_INTERNAL_SECRET` para la
> blacklist) con `--set-secrets=...:latest`, nunca en texto plano.

:::note[Si tu backend ya tiene defaults, las `AUTH_*` son redundantes — pero setealas igual]
Varios backends (BC-03 entre ellos) tienen esos valores **por default en su schema de
configuración** apuntando a prod, y funcionan sin setearlos. Si ves que tu backend
arranca sin las `AUTH_*`, no te falta nada.

Aun así **conviene dejarlas explícitas** en el `--set-env-vars`: depender de un default
significa que un cambio en el schema de config (o un entorno nuevo) te mueve el issuer
o el JWKS sin que nadie lo note, y los síntomas de eso (401 en todos lados) son
molestos de diagnosticar.
:::

:::caution[Backend con Prisma: agregá `DATABASE_URL` al deploy]
Si tu backend usa Prisma, el contenedor corre `prisma migrate deploy` al arrancar
y la app conecta a la base — ambas cosas necesitan **`DATABASE_URL` en runtime**.
Como trae credenciales, va por **Secret Manager**, agregando al step `deploy` la
línea `- --set-secrets=DATABASE_URL=<SECRETO_DATABASE_URL>:latest` (creá el secreto
antes con `gcloud secrets create`). Si tu base es Cloud SQL por socket, sumá
también `- --add-cloudsql-instances=<PROYECTO>:<REGION>:<INSTANCIA>`. Sin
`DATABASE_URL`, el arranque falla con *"The datasource.url property is required in
your Prisma config file"* (combinado con el fix de `prisma.config.ts` de 2.5.1).
:::

:::note[El step `ensure-repo` es idempotente y seguro]
`describe || create`: si el repo existe, `describe` corta con `||` y **no se crea
nada** (las imágenes que ya tenga quedan intactas — pushear solo agrega la tuya);
si no existe, lo crea con formato docker. Para que pueda crearlo, la **service
account del build** necesita `artifactregistry.repositories.create` (incluido en
`roles/artifactregistry.admin` o en `roles/editor`). Si tu SA solo tiene
`reader`/`writer`, el repo lo tenés que crear a mano una vez (Sección 1.2) y este
step simplemente lo encontrará.
:::

## 3. Construir y desplegar

En **una sola línea** (al partirlo con `\` se rompe). El `.` final (contexto del
código) es **obligatorio**.

**Linux / macOS / Git Bash:**

```bash
gcloud builds submit --config=cloudbuild.yaml --region=us-central1 --substitutions=_AR_REPO=<REPO_DOCKER>,_SERVICE=<NOMBRE_DEL_SERVICIO>,_TAG=v1 .
```

**Windows / PowerShell** — el valor de `--substitutions` **debe ir entre comillas**:

```powershell
gcloud builds submit --config=cloudbuild.yaml --region=us-central1 --substitutions="_AR_REPO=<REPO_DOCKER>,_SERVICE=<NOMBRE_DEL_SERVICIO>,_TAG=v1" .
```

:::caution[En PowerShell SIEMPRE comillá las substitutions]
En PowerShell la coma `,` es el operador de arrays. Sin comillas,
`--substitutions=_AR_REPO=a,_SERVICE=b,_TAG=v1` se mete **todo en `_AR_REPO`** y
`_SERVICE`/`_TAG` quedan con sus defaults del yaml → te sale un nombre de imagen
inválido como `.../repo-test _SERVICE=b _TAG=v1/<NOMBRE_DEL_SERVICIO>:v1`. Las
comillas lo arreglan.
:::

Si tu `cloudbuild.yaml` ya trae los defaults correctos (no placeholders), alcanza
con: `gcloud builds submit --config=cloudbuild.yaml --region=us-central1 .`

Este **único comando** hace build + push + deploy: el `deploy` ya es un step del
`cloudbuild.yaml`. No hace falta un `gcloud run deploy` aparte.

:::caution[Si el build falla, `gcloud builds list` NO te lo muestra]
El build corre en la **región** `us-central1`, y `gcloud builds list` consulta el
ámbito **global** → te devuelve vacío y parecería que nunca corrió. Hay que pedir la
región explícitamente:

```bash
gcloud builds list --region=us-central1 --limit=5
gcloud builds log <BUILD_ID> --region=us-central1
```

Es de las cosas que más tiempo hacen perder: el build está, pero lo estás buscando en
el lugar equivocado.
:::

## 4. Verificar

```bash
# La URL la imprime el deploy (o gcloud run services describe <SERVICE>)
curl -i https://<TU_SERVICIO>-xxxx.run.app/<endpoint-protegido>
# Sin token -> 401. Con un JWT real del Auth Service en el header -> 200.
```

Para conseguir un JWT real, logueate contra el Auth Service y usá el `accessToken`
en `Authorization: Bearer ...`. Ver [Flujo del token](/integracion/flujo-token/).

## 5. Errores comunes

### 5.1 Los dos `401`/`403` del registry (se parecen, pero NO son lo mismo)

Ambos salen del `pnpm install` y **ninguno de los dos se parece a su causa**. Mirá
primero si hay un `[WARN] Ignored project-level auth setting` arriba en el log: eso
decide cuál de los dos es.

**Caso A — el token NO llegó.** Error textual:

```text
[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:
  @hagemsa/auth-guard@0.3.1 could not be checked against minimumReleaseAge
  (GET https://us-central1-npm.pkg.dev/.../@hagemsa%2Fauth-guard: Unauthorized - 401)
```

Parece un problema de política de supply-chain; en realidad significa **"no llegó
`GOOGLE_NPM_TOKEN`"**. Casi siempre por usar `gcloud run deploy --source .` (no admite
`--build-arg`). **Fix:** usar el `cloudbuild.yaml` (2.6). Confirmalo con el step de
debug: `GOOGLE_NPM_TOKEN length: 0` ⇒ no llegó.

**Caso B — el token llegó, pero pnpm lo ignoró.** Aparece **antes** del fallo:

```text
[WARN] Ignored project-level auth setting "//us-central1-npm.pkg.dev/.../:_authToken"
in ".../.npmrc": environment variables are not expanded in registry credentials that
come from a project .npmrc...
[ERR_PNPM_FETCH_403] GET https://us-central1-npm.pkg.dev/.../@hagemsa%2Fauth-guard: Forbidden - 403
```

Acá el token **está y es válido**: pnpm 11.11+ descarta credenciales del `.npmrc` del
**proyecto**. **Fix:** mové el token al `.npmrc` de **usuario** (2.1 para local,
`/root/.npmrc` en el Dockerfile 2.4). Si perseguís un "token faltante" acá, perdés el
día: el token nunca fue el problema.

### 5.2 Tabla rápida

| Síntoma | Causa | Fix |
|---|---|---|
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` + `401` | Token vacío/vencido (típico: `--source .`) | Token fresco `--build-arg` **+** exclude (2.2) — ver 5.1 caso A |
| `[WARN] Ignored project-level auth setting` + `403` | Token en el `.npmrc` del proyecto (pnpm ≥ 11.11) | Token al `~/.npmrc` / `/root/.npmrc` — ver 5.1 caso B |
| `401` aunque el token sea fresco y esté en el `.npmrc` de usuario | SA del build sin `artifactregistry.reader` | Grant de la Sección 1.3 |
| `gcloud builds list` no muestra el build que falló | El build es **regional**, el list es global | `gcloud builds list --region=us-central1` (Sección 3) |
| `prisma:warn ... failed to detect the libssl/openssl version` | Falta OpenSSL en la imagen | Base `bookworm-slim` + `apt install openssl` (2.4) |
| `COPY .npmrc … no such file` | `.npmrc` ausente o en `.dockerignore` | Crear `.npmrc` y sacarlo del ignore |
| `debug GOOGLE_NPM_TOKEN length: 0` | El `--build-arg` no se pasó | Usar `cloudbuild.yaml` (no `--source .`) |
| `prisma: not found` al arrancar | `prisma` quedó en devDeps tras `prune --prod` | Mover `prisma` a `dependencies` |
| `datasource.url property is required in your Prisma config file` | `prisma.config.ts` existe pero no declara el `datasource` | Agregar `datasource: { url: env('DATABASE_URL') }` (2.5.1) **+** proveer `DATABASE_URL` en runtime vía Secret Manager |
| `Cannot find module 'dotenv'` al migrar | `prisma.config.ts` hace `import 'dotenv/config'` pero `dotenv` está en devDeps | Mover `dotenv` a `dependencies` |
| `Error loading shared library libssl` | Falta OpenSSL (Prisma) | Base `bookworm-slim` + `apt install openssl` |
| `exec ./docker-entrypoint.sh: not found` | CRLF (editado en Windows) | Guardar el `.sh` en LF |
| Deploy "falla" pese a imagen OK | App no escucha en `0.0.0.0:$PORT` | `app.listen(process.env.PORT, '0.0.0.0')` |
| `Bad syntax for dict arg:[_TAG]` | El comando se partió en varias líneas | Correrlo en **una sola línea** |

Más detalle en [Errores comunes](/integracion/errores-comunes/).

## 6. Prompt para que tu IA lo implemente

Hay **dos prompts** según tu backend — elegí uno, no los mezcles. Pegá el que te
toque **entero** en tu agente de IA (Claude Code, Cursor, etc.) **abierto en la raíz
del backend**. Antes de pegarlo, reemplazá los placeholders `<...>` del final
(proyecto, repo Docker, nombre del servicio).

- **[6.1 — Con Prisma](#61-prompt-con-prisma-90-de-los-casos)**: el **90%** de los
  backends HAGEMSA (Prisma + PostgreSQL). Trae resuelto el error
  *"The datasource.url property is required in your Prisma config file"*.
- **[6.2 — Sin Prisma](#62-prompt-sin-prisma)**: backends que no usan Prisma (raro).

¿No sabés cuál? Si en la raíz hay carpeta `prisma/` o `@prisma/client` en
`package.json`, usá el de **Con Prisma**.

Ambos son **autocontenidos**: traen el contexto fijo y el contenido literal de cada
archivo; la IA solo **detecta** unas pocas cosas de tu repo (versión de pnpm, ruta
del `dist`, deps nativas, nombres de env vars) y ajusta los archivos a eso.

### 6.1 Prompt CON Prisma (90% de los casos)

````text
Sos un asistente que configura el deploy de un backend NestJS + Prisma a Google
Cloud Run. El backend consume la librería privada @hagemsa/auth-guard. Implementá
EXACTAMENTE lo que sigue. No inventes nombres, rutas ni flags que no estén acá; si
algo no se puede determinar, decímelo en vez de asumir.

═══════════════════════════════════════════════════════════════════════════
CONTEXTO FIJO (es igual para todos los backends del ecosistema; no lo cambies)
═══════════════════════════════════════════════════════════════════════════
- Registro npm privado: us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/
  · scope @hagemsa · paquete @hagemsa/auth-guard (ya está en package.json).
- El registro pide auth. Se autentica con un token OAuth de Google (~1h de vida)
  que se inyecta SOLO en build-time como build-arg GOOGLE_NPM_TOKEN. En runtime el
  contenedor NO usa el token ni el registro (la lib ya queda dentro de la imagen).
- Auth Service: https://auth.hagemsa.com · JWKS público: /.well-known/jwks.json
  · issuer = https://auth.hagemsa.com · audience = hagemsa-backends
- Gestor de paquetes: pnpm. Plataforma destino: Google Cloud Run (escucha en
  0.0.0.0:$PORT; Cloud Run inyecta PORT, default 8080).
- Persistencia: este backend usa PRISMA + PostgreSQL (el caso estándar HAGEMSA). El
  contenedor corre `prisma migrate deploy` al arrancar (vía docker-entrypoint.sh),
  por eso necesita DATABASE_URL en runtime y un prisma.config.ts que declare el
  datasource (ver PASO 2). Si descubrís que en realidad NO usa Prisma (no hay
  carpeta prisma/ ni @prisma/client), PARÁ y avisame: te toca el otro prompt.

═══════════════════════════════════════════════════════════════════════════
PASO 1 — INSPECCIONÁ el repo y determiná (no asumas):
═══════════════════════════════════════════════════════════════════════════
a) La versión de pnpm que generó pnpm-lock.yaml (campo lockfileVersion + lo que
   uses normalmente). Pinéala en el Dockerfile (corepack prepare pnpm@X.Y.Z). NO
   uses @latest.
b) La ruta REAL del archivo de entrada compilado: leé el script "start:prod" en
   package.json y nest-cli.json. Suele ser dist/main(.js) o dist/src/main(.js).
   Esa ruta va en el CMD del Dockerfile y en el entrypoint.
c) prisma.config.ts en la raíz:
   - Si EXISTE: tiene que declarar `datasource: { url: env('DATABASE_URL') }`. Si no
     lo declara, AGREGASELO (sin borrar el bloque migrations/seed que ya tenga). Sin
     ese bloque, `prisma migrate deploy` del arranque crashea con "The datasource.url
     property is required in your Prisma config file" — EL error que prevenimos.
   - Si NO existe: creálo con el contenido del PASO 2 (es el estándar Prisma 6/7).
   "prisma" SIEMPRE en dependencies (no devDependencies), o "pnpm prune --prod" lo
   borra y el migrate del arranque falla con "prisma: not found". Si prisma.config.ts
   hace `import 'dotenv/config'`, "dotenv" también en dependencies. Movélos si hace
   falta.
   El backend necesita DATABASE_URL en runtime. Buscá el nombre del SECRETO en Secret
   Manager que la contiene (en otros cloudbuild/deploy del repo, o preguntámelo). Esa
   URL va por --set-secrets (trae credenciales), NUNCA por --set-env-vars.
d) ¿Tiene dependencias nativas que compilan (argon2, bcrypt, etc.)? Si sí, sumá el
   bloque NATIVO al stage deps.
e) Los NOMBRES de las env vars que el backend lee para configurar el guard: abrí
   app.module.ts (o donde llame a AuthGuardModule.forRoot) y mirá qué process.env.*
   usa. El estándar es AUTH_JWKS_URL, AUTH_JWT_ISSUER, AUTH_JWT_AUDIENCE (+ y
   AUTH_SERVICE_URL y AUTH_INTERNAL_SECRET solo si activa la blacklist). Usá los
   nombres REALES de este repo en --set-env-vars, con los valores fijos de arriba.

═══════════════════════════════════════════════════════════════════════════
PASO 2 — CREÁ / ACTUALIZÁ estos archivos en la raíz, con este contenido exacto:
═══════════════════════════════════════════════════════════════════════════

### .npmrc  (SOLO el mapeo de registry — SIN token, ver reglas)
```
@hagemsa:registry=https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:always-auth=true
```
Si el repo ya tiene un `.npmrc` con una línea `_authToken=...`, BORRÁ esa línea:
pnpm 11.11+ ignora credenciales en el `.npmrc` del proyecto (falla con 403 aunque el
token sea válido). El token se inyecta en el `.npmrc` de USUARIO (ver Dockerfile).

### pnpm-workspace.yaml  (NO borres lo que ya tenga; solo AGREGÁ este bloque)
Usá el patrón del scope, NO fijes la versión: si el repo ya tiene
`- '@hagemsa/auth-guard@0.2.0'` (o cualquier versión), REEMPLAZALO por `- '@hagemsa/*'`.
Fijar la versión hace que la exclusión deje de aplicar en silencio al subir el guard.
```
minimumReleaseAgeExclude:
  - '@hagemsa/*'
```

### .dockerignore  (CRÍTICO: jamás incluyas .npmrc acá)
```
node_modules
**/node_modules
dist
*.tsbuildinfo
.git
.gitignore
.env
.env.*
*.local
*.pem
*.key
Dockerfile
.dockerignore
*.log
coverage
```

### Dockerfile (base bookworm-slim por el engine de Prisma)
Reemplazá <PNPM_VERSION> (paso 1a) y dist/main (paso 1b). "prisma" (y "dotenv" si
prisma.config.ts lo importa) DEBEN estar en dependencies, no devDependencies.
Notá el DATABASE_URL PLACEHOLDER en los `pnpm install`: el postinstall suele correr
"prisma generate", que evalúa prisma.config.ts y exige DATABASE_URL aunque no
conecte a la base. El placeholder NO es la base real; la real llega en runtime.
```
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ARG GOOGLE_NPM_TOKEN
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@<PNPM_VERSION> --activate
# prisma.config.ts + prisma/ deben estar ANTES del install (el postinstall genera el client).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc prisma.config.ts ./
COPY prisma ./prisma
# El token va al .npmrc de USUARIO (/root/.npmrc), NUNCA al del proyecto: pnpm 11.11+
# ignora credenciales del .npmrc del repo y falla con 403 aunque el token sea valido.
# Este stage se descarta (solo se copia node_modules), asi que el token no llega a la imagen final.
RUN printf '//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken=%s\n' "$GOOGLE_NPM_TOKEN" > /root/.npmrc
RUN DATABASE_URL=postgresql://placeholder@localhost:5432/x pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@<PNPM_VERSION> --activate
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN DATABASE_URL=postgresql://placeholder@localhost:5432/x pnpm exec prisma generate
RUN pnpm run build
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@<PNPM_VERSION> --activate
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
# Copiá también generated/ SI existe en este repo (output del prisma generate).
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh
EXPOSE 8080
CMD ["./docker-entrypoint.sh"]
```

### prisma.config.ts  (SOLO Prisma — créalo si no existe; si existe, asegurá el datasource)
SIN el bloque `datasource.url`, `prisma migrate deploy` falla con "The datasource.url
property is required in your Prisma config file". Si el repo ya tenía este archivo con
un bloque migrations/seed, CONSERVALO y solo agregá el datasource.
```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

### docker-entrypoint.sh  (SOLO Prisma; guardalo con finales de línea LF)
Reemplazá dist/main por la ruta del paso 1b. Necesita DATABASE_URL en runtime
(se inyecta en el deploy vía Secret Manager, ver cloudbuild.yaml).
```
#!/bin/sh
set -e
echo "[entrypoint] prisma migrate deploy..."
pnpm exec prisma migrate deploy
echo "[entrypoint] starting server..."
exec node dist/main
```

### Bloque NATIVO (solo si el paso 1d dio deps nativas): agregá esta línea al
stage "deps", después del apt-get de openssl:
```
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
```

### cloudbuild.yaml
Dejá los placeholders <REPO_DOCKER> y <NOMBRE_DEL_SERVICIO> tal cual: se pasan al
lanzar el build (NO los resuelvas vos). <REPO_DOCKER> = el código del bounded
context del backend (ej. bc14, bc01); el Auth Service usa "auth". Solo define en
qué repo de Artifact Registry se guarda la imagen, no afecta el runtime. En
--set-env-vars usá los NOMBRES de var reales del paso 1e. El step ensure-repo crea
el repo Docker si no existe (idempotente: si ya existe no toca su contenido).
PRISMA (estándar): el step deploy DEBE inyectar DATABASE_URL desde Secret Manager.
En la línea --set-secrets reemplazá <SECRETO_DATABASE_URL> por el nombre REAL del
secreto (paso 1c). NUNCA pongas la URL de la base en --set-env-vars (trae
credenciales). Si la base es Cloud SQL por socket, sumá también una línea
"- --add-cloudsql-instances=<PROYECTO>:<REGION>:<INSTANCIA>". Si el backend NO usa
Prisma, borrá la línea --set-secrets de DATABASE_URL.
```
steps:
  - id: ensure-repo
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim'
    entrypoint: bash
    args:
      - -c
      - |
        gcloud artifacts repositories describe ${_AR_REPO} --location=${_REGION} --project=$PROJECT_ID >/dev/null 2>&1 \
        || gcloud artifacts repositories create ${_AR_REPO} --repository-format=docker --location=${_REGION} --project=$PROJECT_ID
  - id: token
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim'
    entrypoint: bash
    args: ['-c', 'gcloud auth print-access-token > /workspace/npm_token.txt']
  - id: build
    name: 'gcr.io/cloud-builders/docker'
    entrypoint: bash
    args:
      - -c
      - |
        docker build \
          --build-arg GOOGLE_NPM_TOKEN="$$(cat /workspace/npm_token.txt)" \
          -t ${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG} .
  - id: push
    name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG}']
  - id: deploy
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim'
    entrypoint: gcloud
    args:
      - run
      - deploy
      - ${_SERVICE}
      - --image=${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG}
      - --region=${_REGION}
      - --platform=managed
      - --allow-unauthenticated
      - --set-env-vars=AUTH_JWKS_URL=https://auth.hagemsa.com/.well-known/jwks.json,AUTH_JWT_ISSUER=https://auth.hagemsa.com,AUTH_JWT_AUDIENCE=hagemsa-backends
      # PRISMA (estándar): DATABASE_URL desde Secret Manager. Reemplazá el nombre del
      # secreto por el real (paso 1c). Si el backend NO usa Prisma, borrá esta línea.
      - --set-secrets=DATABASE_URL=<SECRETO_DATABASE_URL>:latest
images:
  - '${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG}'
substitutions:
  _REGION: us-central1
  _AR_REPO: <REPO_DOCKER>
  _SERVICE: <NOMBRE_DEL_SERVICIO>
  _TAG: v1
options:
  logging: CLOUD_LOGGING_ONLY
```

═══════════════════════════════════════════════════════════════════════════
REGLAS INQUEBRANTABLES
═══════════════════════════════════════════════════════════════════════════
- NUNCA hardcodear el token ni secretos. El token es build-arg (GOOGLE_NPM_TOKEN);
  los secretos (ej. AUTH_INTERNAL_SECRET) van por Secret Manager con --set-secrets
  (ej. --set-secrets=AUTH_INTERNAL_SECRET=INTERNAL_SHARED_SECRET:latest), nunca en
  texto plano ni en --set-env-vars.
- NUNCA poner .npmrc en .dockerignore (si lo ignorás, "COPY .npmrc" falla). Aclaración:
  el .npmrc del repo NO tiene secretos (solo el mapeo de registry); lo que mantiene el
  token fuera de la imagen final es el MULTI-STAGE (el stage deps se descarta), no el
  .dockerignore.
- El _authToken NUNCA va en el .npmrc del PROYECTO. pnpm 11.11+ ignora credenciales de
  un .npmrc commiteado (avisa con "[WARN] Ignored project-level auth setting") y el
  install muere con 403 AUNQUE el token sea valido y este presente. El token se escribe
  en el .npmrc de USUARIO (/root/.npmrc en el Dockerfile; ~/.npmrc en local vía
  `pnpm config set`). Si ves un 403 con ese WARN, NO busques un token faltante: el
  token esta, pnpm lo descarto.
- El backend DEBE escuchar en 0.0.0.0:process.env.PORT. Revisá main.ts: si hace
  app.listen sin respetar process.env.PORT, corregilo a
  `await app.listen(process.env.PORT ?? 8080, '0.0.0.0')`.
- PRISMA (estándar HAGEMSA):
  · "prisma" DEBE estar en dependencies (no devDependencies), o "pnpm prune --prod"
    lo borra y el migrate del arranque falla con "prisma: not found".
  · prisma.config.ts DEBE declarar `datasource: { url: env('DATABASE_URL') }`. Sin
    eso, "prisma migrate deploy" falla con "The datasource.url property is required
    in your Prisma config file". Este es el error que más se repite — verificalo.
  · Si prisma.config.ts hace `import 'dotenv/config'`, "dotenv" DEBE estar en
    dependencies (si no, el migrate crashea por módulo faltante).
  · DATABASE_URL se inyecta en runtime SOLO por Secret Manager (--set-secrets),
    JAMÁS en --set-env-vars (trae credenciales) ni hardcodeada.
- NO uses "gcloud run deploy --source ." — no admite --build-arg y el install
  fallaría con 401. Hay que usar el cloudbuild.yaml de arriba.
- Si el .npmrc autentica con ${GOOGLE_NPM_TOKEN} y ese token no llega, el install
  da "401 / minimumReleaseAge". El minimumReleaseAgeExclude NO reemplaza al token:
  son dos cosas distintas, hacen falta ambas.

═══════════════════════════════════════════════════════════════════════════
PASO 3 — VERIFICÁ y entregá
═══════════════════════════════════════════════════════════════════════════
- Corré "pnpm run build" y confirmá que produce el archivo del CMD (paso 1b). Si no
  existe, corregí la ruta del CMD/entrypoint.
- Si usa Prisma: confirmá que prisma.config.ts tiene el bloque datasource con
  env('DATABASE_URL'); que "prisma" (y "dotenv" si se importa) están en
  dependencies; y que el step deploy tiene --set-secrets=DATABASE_URL=...:latest con
  el nombre real del secreto. Recordame crear ese secreto si todavía no existe
  (gcloud secrets create) y darle acceso a la service account de Cloud Run.
- Confirmá: Dockerfile base bookworm-slim, prisma.config.ts con datasource, y
  entrypoint que corre el migrate. Decime si sumaste el bloque nativo (y por qué).
- Dame el comando final para lanzar el deploy, en UNA sola línea, con mis valores.
  En bash/Git Bash:
  gcloud builds submit --config=cloudbuild.yaml --region=us-central1 --substitutions=_AR_REPO=<REPO_DOCKER>,_SERVICE=<NOMBRE_DEL_SERVICIO>,_TAG=v1 .
  En PowerShell (Windows) el valor de --substitutions DEBE ir entre comillas, o la
  coma se interpreta como operador de arrays y rompe el nombre de la imagen:
  gcloud builds submit --config=cloudbuild.yaml --region=us-central1 --substitutions="_AR_REPO=<REPO_DOCKER>,_SERVICE=<NOMBRE_DEL_SERVICIO>,_TAG=v1" .
- Recordame que la service account del build necesita roles/artifactregistry.reader
  sobre hagemsa-npm (proyecto hagemsa-cloud), o el install dará 401.
````

### 6.2 Prompt SIN Prisma

Usá este SOLO si tu backend **no** usa Prisma (no hay carpeta `prisma/` ni
`@prisma/client`). No crea `prisma.config.ts`, ni entrypoint de migración, ni
inyecta `DATABASE_URL`.

````text
Sos un asistente que configura el deploy de un backend NestJS a Google Cloud Run.
El backend consume la librería privada @hagemsa/auth-guard y NO usa Prisma.
Implementá EXACTAMENTE lo que sigue. No inventes nombres, rutas ni flags que no
estén acá; si algo no se puede determinar, decímelo en vez de asumir.

═══════════════════════════════════════════════════════════════════════════
CONTEXTO FIJO (igual para todos los backends del ecosistema; no lo cambies)
═══════════════════════════════════════════════════════════════════════════
- Registro npm privado: us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/
  · scope @hagemsa · paquete @hagemsa/auth-guard (ya está en package.json).
- El registro pide auth. Se autentica con un token OAuth de Google (~1h de vida)
  que se inyecta SOLO en build-time como build-arg GOOGLE_NPM_TOKEN. En runtime el
  contenedor NO usa el token ni el registro (la lib ya queda dentro de la imagen).
- Auth Service: https://auth.hagemsa.com · JWKS público: /.well-known/jwks.json
  · issuer = https://auth.hagemsa.com · audience = hagemsa-backends
- Gestor de paquetes: pnpm. Plataforma destino: Google Cloud Run (escucha en
  0.0.0.0:$PORT; Cloud Run inyecta PORT, default 8080).
- Este backend NO usa Prisma. Si encontrás carpeta prisma/ o @prisma/client en
  package.json, PARÁ y avisame: te corresponde el otro prompt (Con Prisma).

═══════════════════════════════════════════════════════════════════════════
PASO 1 — INSPECCIONÁ el repo y determiná (no asumas):
═══════════════════════════════════════════════════════════════════════════
a) La versión de pnpm que generó pnpm-lock.yaml (lockfileVersion + lo que uses).
   Pinéala en el Dockerfile (corepack prepare pnpm@X.Y.Z). NO uses @latest.
b) La ruta REAL del archivo de entrada compilado: leé "start:prod" en package.json
   y nest-cli.json. Suele ser dist/main(.js) o dist/src/main(.js). Va en el CMD.
c) ¿Deps nativas que compilan (argon2, bcrypt, etc.)? Si sí, sumá el bloque NATIVO.
d) Los NOMBRES de las env vars del guard: abrí app.module.ts (o donde llame a
   AuthGuardModule.forRoot) y mirá qué process.env.* usa. El estándar es
   AUTH_JWKS_URL, AUTH_JWT_ISSUER, AUTH_JWT_AUDIENCE (+ AUTH_SERVICE_URL y
   AUTH_INTERNAL_SECRET solo si activa la blacklist). Usá los nombres REALES en
   --set-env-vars, con los valores fijos de arriba.

═══════════════════════════════════════════════════════════════════════════
PASO 2 — CREÁ / ACTUALIZÁ estos archivos en la raíz, con este contenido exacto:
═══════════════════════════════════════════════════════════════════════════

### .npmrc  (SOLO el mapeo de registry — SIN token, ver reglas)
```
@hagemsa:registry=https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:always-auth=true
```
Si el repo ya tiene un `.npmrc` con una línea `_authToken=...`, BORRÁ esa línea:
pnpm 11.11+ ignora credenciales en el `.npmrc` del proyecto (falla con 403 aunque el
token sea válido). El token se inyecta en el `.npmrc` de USUARIO (ver Dockerfile).

### pnpm-workspace.yaml  (NO borres lo que ya tenga; solo AGREGÁ este bloque)
Usá el patrón del scope, NO fijes la versión: si el repo ya tiene
`- '@hagemsa/auth-guard@0.2.0'` (o cualquier versión), REEMPLAZALO por `- '@hagemsa/*'`.
Fijar la versión hace que la exclusión deje de aplicar en silencio al subir el guard.
```
minimumReleaseAgeExclude:
  - '@hagemsa/*'
```

### .dockerignore  (CRÍTICO: jamás incluyas .npmrc acá)
```
node_modules
**/node_modules
dist
*.tsbuildinfo
.git
.gitignore
.env
.env.*
*.local
*.pem
*.key
Dockerfile
.dockerignore
*.log
coverage
```

### Dockerfile (base alpine; sin Prisma)
Reemplazá <PNPM_VERSION> (paso 1a) y dist/main (paso 1b).
```
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /app
ARG GOOGLE_NPM_TOKEN
RUN corepack enable && corepack prepare pnpm@<PNPM_VERSION> --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# El token va al .npmrc de USUARIO (/root/.npmrc), NUNCA al del proyecto: pnpm 11.11+
# ignora credenciales del .npmrc del repo y falla con 403 aunque el token sea valido.
# Este stage se descarta (solo se copia node_modules), asi que el token no llega a la imagen final.
RUN printf '//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken=%s\n' "$GOOGLE_NPM_TOKEN" > /root/.npmrc
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@<PNPM_VERSION> --activate
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN pnpm run build
RUN pnpm prune --prod

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "dist/main"]
```

### Bloque NATIVO (solo si el paso 1c dio deps nativas): agregá como primer RUN del
stage "deps" (alpine usa apk):
```
RUN apk add --no-cache python3 make g++
```

### cloudbuild.yaml
Dejá <REPO_DOCKER> y <NOMBRE_DEL_SERVICIO> tal cual (se pasan al lanzar el build).
<REPO_DOCKER> = código del bounded context (ej. bc14, bc01); el Auth Service usa
"auth". En --set-env-vars usá los nombres reales del paso 1d. El step ensure-repo
crea el repo Docker si no existe (idempotente: si ya existe no toca su contenido).
```
steps:
  - id: ensure-repo
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim'
    entrypoint: bash
    args:
      - -c
      - |
        gcloud artifacts repositories describe ${_AR_REPO} --location=${_REGION} --project=$PROJECT_ID >/dev/null 2>&1 \
        || gcloud artifacts repositories create ${_AR_REPO} --repository-format=docker --location=${_REGION} --project=$PROJECT_ID
  - id: token
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim'
    entrypoint: bash
    args: ['-c', 'gcloud auth print-access-token > /workspace/npm_token.txt']
  - id: build
    name: 'gcr.io/cloud-builders/docker'
    entrypoint: bash
    args:
      - -c
      - |
        docker build \
          --build-arg GOOGLE_NPM_TOKEN="$$(cat /workspace/npm_token.txt)" \
          -t ${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG} .
  - id: push
    name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG}']
  - id: deploy
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim'
    entrypoint: gcloud
    args:
      - run
      - deploy
      - ${_SERVICE}
      - --image=${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG}
      - --region=${_REGION}
      - --platform=managed
      - --allow-unauthenticated
      - --set-env-vars=AUTH_JWKS_URL=https://auth.hagemsa.com/.well-known/jwks.json,AUTH_JWT_ISSUER=https://auth.hagemsa.com,AUTH_JWT_AUDIENCE=hagemsa-backends
images:
  - '${_REGION}-docker.pkg.dev/$PROJECT_ID/${_AR_REPO}/${_SERVICE}:${_TAG}'
substitutions:
  _REGION: us-central1
  _AR_REPO: <REPO_DOCKER>
  _SERVICE: <NOMBRE_DEL_SERVICIO>
  _TAG: v1
options:
  logging: CLOUD_LOGGING_ONLY
```

═══════════════════════════════════════════════════════════════════════════
REGLAS INQUEBRANTABLES
═══════════════════════════════════════════════════════════════════════════
- NUNCA hardcodear el token ni secretos. El token es build-arg (GOOGLE_NPM_TOKEN);
  los secretos (ej. AUTH_INTERNAL_SECRET) van por Secret Manager con --set-secrets
  (ej. --set-secrets=AUTH_INTERNAL_SECRET=INTERNAL_SHARED_SECRET:latest), nunca en
  texto plano ni en --set-env-vars.
- NUNCA poner .npmrc en .dockerignore (si lo ignorás, "COPY .npmrc" falla). Aclaración:
  el .npmrc del repo NO tiene secretos (solo el mapeo de registry); lo que mantiene el
  token fuera de la imagen final es el MULTI-STAGE (el stage deps se descarta), no el
  .dockerignore.
- El _authToken NUNCA va en el .npmrc del PROYECTO. pnpm 11.11+ ignora credenciales de
  un .npmrc commiteado (avisa con "[WARN] Ignored project-level auth setting") y el
  install muere con 403 AUNQUE el token sea valido y este presente. El token se escribe
  en el .npmrc de USUARIO (/root/.npmrc en el Dockerfile; ~/.npmrc en local vía
  `pnpm config set`). Si ves un 403 con ese WARN, NO busques un token faltante: el
  token esta, pnpm lo descarto.
- El backend DEBE escuchar en 0.0.0.0:process.env.PORT. Revisá main.ts: si hace
  app.listen sin respetar process.env.PORT, corregilo a
  `await app.listen(process.env.PORT ?? 8080, '0.0.0.0')`.
- NO uses "gcloud run deploy --source ." — no admite --build-arg y el install
  fallaría con 401. Hay que usar el cloudbuild.yaml de arriba.
- Si el .npmrc autentica con ${GOOGLE_NPM_TOKEN} y ese token no llega, el install
  da "401 / minimumReleaseAge". El minimumReleaseAgeExclude NO reemplaza al token:
  son dos cosas distintas, hacen falta ambas.

═══════════════════════════════════════════════════════════════════════════
PASO 3 — VERIFICÁ y entregá
═══════════════════════════════════════════════════════════════════════════
- Corré "pnpm run build" y confirmá que produce el archivo del CMD (paso 1b). Si no
  existe, corregí la ruta del CMD.
- Decime si sumaste el bloque nativo (y por qué).
- Dame el comando final para lanzar el deploy, en UNA sola línea, con mis valores.
  En bash/Git Bash:
  gcloud builds submit --config=cloudbuild.yaml --region=us-central1 --substitutions=_AR_REPO=<REPO_DOCKER>,_SERVICE=<NOMBRE_DEL_SERVICIO>,_TAG=v1 .
  En PowerShell (Windows) el valor de --substitutions DEBE ir entre comillas, o la
  coma se interpreta como operador de arrays y rompe el nombre de la imagen:
  gcloud builds submit --config=cloudbuild.yaml --region=us-central1 --substitutions="_AR_REPO=<REPO_DOCKER>,_SERVICE=<NOMBRE_DEL_SERVICIO>,_TAG=v1" .
- Recordame que la service account del build necesita roles/artifactregistry.reader
  sobre hagemsa-npm (proyecto hagemsa-cloud), o el install dará 401.
````

:::tip[Por qué los prompts repiten todo]
La IA del backend consumidor **no tiene esta documentación a la vista** ni conoce el
ecosistema HAGEMSA. Por eso cada prompt es autocontenido: trae los valores fijos, el
contenido literal de cada archivo y las reglas. Lo único que delega en la IA es
**leer el repo** (versión de pnpm, ruta del `dist`, deps nativas, nombres de env
vars) — cosas que sí puede ver. Elegir entre Con/Sin Prisma lo hacés vos al copiar
el prompt correcto, así la IA no tiene que adivinar ni alucinar.
:::

## Próximo paso

[Errores comunes →](/integracion/errores-comunes/)
