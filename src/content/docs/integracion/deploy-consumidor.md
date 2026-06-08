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

Enruta el scope `@hagemsa` al registry privado. Detalle completo en
[Instalación](/integracion/instalacion/#1-1-configurar-el-registry-en-tu-proyecto).

```ini
@hagemsa:registry=https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken=${GOOGLE_NPM_TOKEN}
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:always-auth=true
```

### 2.2 `pnpm-workspace.yaml`

Excluí el paquete interno de la política de antigüedad mínima (si no, un deploy
justo después de publicar una versión nueva del guard falla con `minimumReleaseAge`):

```yaml
# ... tu config existente ...
minimumReleaseAgeExclude:
  - '@hagemsa/auth-guard'
```

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

# IMPORTANTE: NO ignorar .npmrc — autentica el install contra el registro privado.
```

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
ENV GOOGLE_NPM_TOKEN=$GOOGLE_NPM_TOKEN

RUN corepack enable && corepack prepare pnpm@latest --activate

# El .npmrc DEBE copiarse para autenticar contra el registro privado.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Debug opcional: confirma que el token NO llega vacio (no filtra el valor).
RUN node -e "console.log('GOOGLE_NPM_TOKEN length:', (process.env.GOOGLE_NPM_TOKEN||'').length)"

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

:::note[Variación A — el backend usa Prisma]
Agregá al Dockerfile:

- En los stages `deps`/`build`/`runner`: instalá OpenSSL para el engine de Prisma:
  `RUN apt-get update && apt-get install -y --no-install-recommends openssl` (con
  base `node:22-bookworm-slim` en vez de `alpine`).
- En `build`, antes de `pnpm run build`: `RUN pnpm exec prisma generate`.
- En `runner`, copiá también `prisma/`, `generated/` y `prisma.config.ts`.
- Mové **`prisma` a `dependencies`** (no `devDependencies`), o `pnpm prune --prod`
  lo borra y el `migrate deploy` del arranque falla con `prisma: not found`.
- Usá un `docker-entrypoint.sh` que corra `pnpm exec prisma migrate deploy` antes
  de arrancar (guardalo con finales de línea **LF**).
:::

:::note[Variación B — el backend tiene dependencias nativas]
Si usás `argon2`, `bcrypt` u otra dep con bindings nativos, el stage `deps`
necesita toolchain: `RUN apt-get update && apt-get install -y --no-install-recommends
python3 make g++` (base `bookworm-slim`).
:::

### 2.5 `docker-entrypoint.sh` (solo Variación A — Prisma)

Guardar con finales de línea **LF**. Requiere `prisma` en `dependencies`.

```sh
#!/bin/sh
set -e
echo "[entrypoint] prisma migrate deploy..."
pnpm exec prisma migrate deploy
echo "[entrypoint] starting server..."
exec node dist/main
```

### 2.6 `cloudbuild.yaml`

No se puede usar `gcloud run deploy --source .` (no permite `--build-arg` y el
install necesita el token). Por eso este pipeline saca un token fresco, hace
build pasándolo, push y deploy:

```yaml
steps:
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

## 3. Construir y desplegar

En **una sola línea** (al partirlo con `\` en Git Bash se rompe):

```bash
gcloud builds submit --config=cloudbuild.yaml --region=us-central1 --substitutions=_AR_REPO=<REPO_DOCKER>,_SERVICE=<NOMBRE_DEL_SERVICIO>,_TAG=v1 .
```

El `.` final (contexto del código) es **obligatorio**. Si tu `cloudbuild.yaml` ya
trae los defaults, alcanza con:
`gcloud builds submit --config=cloudbuild.yaml --region=us-central1 .`

## 4. Verificar

```bash
# La URL la imprime el deploy (o gcloud run services describe <SERVICE>)
curl -i https://<TU_SERVICIO>-xxxx.run.app/<endpoint-protegido>
# Sin token -> 401. Con un JWT real del Auth Service en el header -> 200.
```

Para conseguir un JWT real, logueate contra el Auth Service y usá el `accessToken`
en `Authorization: Bearer ...`. Ver [Flujo del token](/integracion/flujo-token/).

## 5. Errores comunes

| Síntoma | Causa | Fix |
|---|---|---|
| `401` + `minimumReleaseAge` sobre `@hagemsa/auth-guard` | Token vacío/vencido | Token fresco `--build-arg` **+** exclude (2.2) |
| `401` aunque el token sea fresco | SA del build sin `artifactregistry.reader` | Grant de la Sección 1.3 |
| `COPY .npmrc … no such file` | `.npmrc` ausente o en `.dockerignore` | Crear `.npmrc` y sacarlo del ignore |
| `debug GOOGLE_NPM_TOKEN length: 0` | El `--build-arg` no se pasó | Usar `cloudbuild.yaml` (no `--source .`) |
| `prisma: not found` al arrancar | `prisma` quedó en devDeps tras `prune --prod` | Mover `prisma` a `dependencies` |
| `Error loading shared library libssl` | Falta OpenSSL (Prisma) | Base `bookworm-slim` + `apt install openssl` |
| `exec ./docker-entrypoint.sh: not found` | CRLF (editado en Windows) | Guardar el `.sh` en LF |
| Deploy "falla" pese a imagen OK | App no escucha en `0.0.0.0:$PORT` | `app.listen(process.env.PORT, '0.0.0.0')` |
| `Bad syntax for dict arg:[_TAG]` | El comando se partió en varias líneas | Correrlo en **una sola línea** |

Más detalle en [Errores comunes](/integracion/errores-comunes/).

## 6. Prompt para que tu IA lo implemente

Pegá **todo el bloque de abajo** en tu agente de IA (Claude Code, Cursor, etc.)
**abierto en la raíz del backend** que vas a desplegar. Antes de pegarlo, reemplazá
los placeholders `<...>` del final (proyecto, repo Docker, nombre del servicio).

El prompt es **autocontenido**: incluye el contexto fijo y el contenido exacto de
cada archivo, así la IA no tiene que adivinar nada. Solo le pedimos que **detecte**
3 cosas de tu repo (versión de pnpm, ruta del `dist`, si usa Prisma / deps nativas)
y elija la variante de Dockerfile correcta.

````text
Sos un asistente que configura el deploy de un backend NestJS a Google Cloud Run.
El backend consume la librería privada @hagemsa/auth-guard. Implementá EXACTAMENTE
lo que sigue. No inventes nombres, rutas ni flags que no estén acá; si algo no se
puede determinar, decímelo en vez de asumir.

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

═══════════════════════════════════════════════════════════════════════════
PASO 1 — INSPECCIONÁ el repo y determiná (no asumas):
═══════════════════════════════════════════════════════════════════════════
a) La versión de pnpm que generó pnpm-lock.yaml (campo lockfileVersion + lo que
   uses normalmente). Pinéala en el Dockerfile (corepack prepare pnpm@X.Y.Z). NO
   uses @latest.
b) La ruta REAL del archivo de entrada compilado: leé el script "start:prod" en
   package.json y nest-cli.json. Suele ser dist/main(.js) o dist/src/main(.js).
   Esa ruta va en el CMD del Dockerfile y, si aplica, en el entrypoint.
c) ¿Usa Prisma? (existe carpeta prisma/ o @prisma/client en dependencies). Si sí,
   usá la VARIANTE B del Dockerfile. Si no, la VARIANTE A.
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

### .npmrc
```
@hagemsa:registry=https://us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:_authToken=${GOOGLE_NPM_TOKEN}
//us-central1-npm.pkg.dev/hagemsa-cloud/hagemsa-npm/:always-auth=true
```

### pnpm-workspace.yaml  (NO borres lo que ya tenga; solo AGREGÁ este bloque)
```
minimumReleaseAgeExclude:
  - '@hagemsa/auth-guard'
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

### Dockerfile — VARIANTE A (sin Prisma ni deps nativas)
Reemplazá <PNPM_VERSION> por la del paso 1a y dist/main por la ruta del paso 1b.
```
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /app
ARG GOOGLE_NPM_TOKEN
ENV GOOGLE_NPM_TOKEN=$GOOGLE_NPM_TOKEN
RUN corepack enable && corepack prepare pnpm@<PNPM_VERSION> --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN node -e "console.log('GOOGLE_NPM_TOKEN length:', (process.env.GOOGLE_NPM_TOKEN||'').length)"
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

### Dockerfile — VARIANTE B (usa Prisma)
Igual que A pero con base bookworm-slim (OpenSSL para el engine de Prisma),
prisma generate antes del build, copia de prisma/, y arranque vía entrypoint.
ADEMÁS: mové "prisma" de devDependencies a dependencies en package.json (si queda
en devDependencies, "pnpm prune --prod" lo borra y el migrate del arranque falla).
```
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ARG GOOGLE_NPM_TOKEN
ENV GOOGLE_NPM_TOKEN=$GOOGLE_NPM_TOKEN
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@<PNPM_VERSION> --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN node -e "console.log('GOOGLE_NPM_TOKEN length:', (process.env.GOOGLE_NPM_TOKEN||'').length)"
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@<PNPM_VERSION> --activate
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN pnpm exec prisma generate
RUN pnpm run build
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
# Copiá también generated/ y prisma.config.ts SI existen en este repo.
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh
EXPOSE 8080
CMD ["./docker-entrypoint.sh"]
```

### docker-entrypoint.sh  (SOLO para la VARIANTE B; guardalo con finales de línea LF)
Reemplazá dist/main por la ruta del paso 1b.
```
#!/bin/sh
set -e
echo "[entrypoint] prisma migrate deploy..."
pnpm exec prisma migrate deploy
echo "[entrypoint] starting server..."
exec node dist/main
```

### Bloque NATIVO (solo si el paso 1d dio deps nativas): agregá esta línea al
stage "deps", después del apt-get de openssl (o como primer RUN si es la variante A
alpine, usando apk: RUN apk add --no-cache python3 make g++):
```
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
```

### cloudbuild.yaml
Dejá los placeholders <REPO_DOCKER> y <NOMBRE_DEL_SERVICIO> tal cual: se pasan al
lanzar el build (NO los resuelvas vos). <REPO_DOCKER> = el código del bounded
context del backend (ej. bc14, bc01); el Auth Service usa "auth". Solo define en
qué repo de Artifact Registry se guarda la imagen, no afecta el runtime. En
--set-env-vars usá los NOMBRES de var reales del paso 1e.
```
steps:
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
- NUNCA poner .npmrc en .dockerignore (si lo ignorás, "COPY .npmrc" falla).
- El backend DEBE escuchar en 0.0.0.0:process.env.PORT. Revisá main.ts: si hace
  app.listen sin respetar process.env.PORT, corregilo a
  `await app.listen(process.env.PORT ?? 8080, '0.0.0.0')`.
- Variante B: "prisma" DEBE estar en dependencies (no devDependencies).
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
- Decime qué variante de Dockerfile usaste y por qué (Prisma sí/no, nativas sí/no).
- Dame el comando final para lanzar el deploy, en UNA sola línea, con mis valores:
  gcloud builds submit --config=cloudbuild.yaml --region=us-central1 --substitutions=_AR_REPO=<REPO_DOCKER>,_SERVICE=<NOMBRE_DEL_SERVICIO>,_TAG=v1 .
- Recordame que la service account del build necesita roles/artifactregistry.reader
  sobre hagemsa-npm (proyecto hagemsa-cloud), o el install dará 401.
````

:::tip[Por qué el prompt repite todo]
La IA del backend consumidor **no tiene esta documentación a la vista** ni conoce el
ecosistema HAGEMSA. Por eso el prompt es autocontenido: trae los valores fijos, el
contenido literal de cada archivo y las reglas. Lo único que delega en la IA es
**leer el repo** (versión de pnpm, ruta del `dist`, Prisma/nativas, nombres de env
vars) — cosas que sí puede ver — y elegir la variante. Así no alucina.
:::

## Próximo paso

[Errores comunes →](/integracion/errores-comunes/)
