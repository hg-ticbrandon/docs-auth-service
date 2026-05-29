---
title: Deploy a Cloud Run
description: Construir la imagen y desplegar el Auth Service a Cloud Run.
---

## Pre-requisitos

Antes de cualquier deploy, las siguientes piezas tienen que estar en su lugar:

- [Setup de GCP](/operaciones/setup-gcp/) completo (proyecto, APIs, Cloud SQL, schemas, IAM).
- [Secretos](/operaciones/secretos/) configurados (`jwt-private-key`, `jwt-public-key`, `auth-db-url`, `internal-shared-secret`).
- [Migrations](/operaciones/migrations/) aplicadas y `prisma db seed` corrido contra Cloud SQL.

:::caution[Migrations NO corren en Cloud Build]
El `cloudbuild.yaml` **no** incluye un step de `prisma migrate deploy` porque el container corre como `USER node` y corepack no tiene permisos sobre `/builder/home/.cache`. **Las migrations se corren manualmente** desde tu máquina con el Cloud SQL Auth Proxy antes de cada deploy que toque el schema. Ver [Migrations](/operaciones/migrations/).
:::

## Opciones

| Método | Cuándo usar |
|---|---|
| `gcloud builds submit` manual desde local | Recomendado para el go-live y mientras el repo no está conectado a GitHub |
| Cloud Build trigger sobre GitHub | Cuando el repo esté en GitHub y querés CI/CD automático en push a `main` |

## Opción A: Build + Deploy manual (recomendado para go-live)

### A.1 Verificar que el `cloudbuild.yaml` y el `Dockerfile` están al día

Ambos viven en la raíz del repo del backend. El pipeline tiene 3 steps:

1. `docker-build` — construye la imagen multi-stage.
2. `docker-push` — pushea a Artifact Registry (`us-central1-docker.pkg.dev/hagemsa-cloud/auth/auth-service`).
3. `cloud-run-deploy` — `gcloud run deploy` con la imagen recién pushada, secretos del Secret Manager y el SA `auth-service@`.

### A.2 Lanzar el build

Desde la raíz del repo:

```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --region=us-central1 \
  --substitutions=COMMIT_SHA=local-$(date +%s)
```

`COMMIT_SHA` se usa como tag de la imagen. Cuando estés con trigger sobre GitHub, Cloud Build lo inyecta automáticamente del commit del push.

Duración esperada: ~2-3 min en frío, ~1 min con cache de capas.

### A.3 Permitir acceso público

Por default Cloud Run requiere autenticación IAM. El Auth Service necesita ser público (login, JWKS y health son endpoints públicos):

```bash
gcloud run services add-iam-policy-binding auth-service \
  --region=us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

Solo hace falta correrlo una vez (el binding persiste entre deploys).

### A.4 Verificar el deploy

```bash
URL=$(gcloud run services describe auth-service --region=us-central1 --format='value(status.url)')

# 1. Liveness
curl -s "$URL/health"
# → {"status":"ok","uptime":...}

# 2. Readiness (verifica DB + claves RSA cargadas)
curl -s "$URL/health/ready"
# → {"status":"ok","checks":{"db":{"ok":true},"rsaKeys":{"ok":true}}}

# 3. JWKS (clave pública con la que los backends verifican JWTs)
curl -s "$URL/.well-known/jwks.json"
# → {"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"...","n":"..."}]}

# 4. Health info — qué configuración levantó
curl -s "$URL/health/info"
# → versión, Node, env vars cargadas (sin exponer secretos), kid activo
```

Si **alguno de los 4 falla**, ver [Troubleshooting](/operaciones/troubleshooting/).

## Opción B: Cloud Build trigger sobre GitHub

Se setea **después** del primer go-live, cuando el repo esté pusheado a GitHub.

### B.1 Conectar repo

1. Cloud Build console → Triggers → Connect Repository.
2. Elegir GitHub, autorizar la GitHub App de Google Cloud Build.
3. Seleccionar el repo `hagemsa-auth-service`.

### B.2 Crear trigger

1. New Trigger:
   - **Event:** Push to a branch.
   - **Branch:** `^main$`.
   - **Configuration:** Cloud Build configuration file → `cloudbuild.yaml`.
2. Substitutions (las defaults del yaml ya son razonables):
   - `_REGION=us-central1`
   - `_SERVICE_NAME=auth-service`

### B.3 Probar

Push a `main` → Cloud Build construye la imagen y la deploya. Ver progreso en Cloud Build console.

## Crear el SUPER_ADMIN inicial

La primera vez no hay ningún usuario. Para crear el primero, usamos el script `scripts/bootstrap-super-admin.ts` (idempotente — podés correrlo dos veces sin problema).

### 1. Asegurate que el proxy esté arriba

Ver [Migrations §2](/operaciones/migrations/#2-levantar-el-proxy). El script corre desde tu máquina contra Cloud SQL vía proxy.

### 2. Correr el script

```bash
cd hagemsa-auth-service

# Bajamos la URL del secret y extraemos el password URL-encoded
gcloud secrets versions access latest --secret=auth-db-url > /tmp/url-prod.txt
PW_ENCODED=$(python -c "
import re
with open('/tmp/url-prod.txt') as f:
    url = f.read().strip()
m = re.match(r'postgresql://auth_service:([^@]+)@', url)
print(m.group(1))
")

DATABASE_URL="postgresql://auth_service:${PW_ENCODED}@127.0.0.1:5433/db_auth_service?schema=public" \
BOOTSTRAP_ADMIN_EMAIL="admin@hagemsa.com" \
BOOTSTRAP_ADMIN_PASSWORD="<password-temporal-fuerte>" \
BOOTSTRAP_ADMIN_NOMBRE="Super Admin" \
  pnpm exec ts-node -r tsconfig-paths/register scripts/bootstrap-super-admin.ts

rm /tmp/url-prod.txt
```

El script:

1. Busca el rol `SUPER_ADMIN` (debe existir del seed).
2. Crea o reactiva la cuenta con el email dado.
3. Crea o actualiza la credencial con el password hasheado en Argon2id.
4. Asigna el rol `SUPER_ADMIN` con scope `{}` y sin expiración.

### 3. Probar login

```bash
curl -s -X POST "$URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hagemsa.com","password":"<password-temporal>"}'
```

Esperado: `{ "datos": { "accessToken": "...", "refreshToken": "...", ... } }`.

### 4. Cambiar el password al primer login (recomendado)

Una vez logueado desde el frontend de admin, ir a perfil → cambiar password y poner uno fuerte.

## Gotchas conocidos del Dockerfile

Si modificás el `Dockerfile` y el container deja de arrancar:

| Síntoma en logs de Cloud Run | Causa | Fix |
|---|---|---|
| `Cannot find module 'dotenv/config'` | `main.ts` importa `dotenv/config` pero `dotenv` está en `devDependencies` | Mover `dotenv` a `dependencies` |
| `Cannot find module '/app/dist/main.js'` | El `nest build` produce `dist/src/main.js` (no `dist/main.js`) por `sourceRoot: "src"` en `nest-cli.json` | `CMD ["node", "dist/src/main.js"]` |
| `Error: Could not find Prisma Schema` durante `pnpm install` | El `postinstall` corre `prisma generate` antes de que `prisma/` esté copiado | `COPY prisma ./prisma` **antes** de `RUN pnpm install` |
| `Cannot find module 'prisma'` durante el postinstall | `prisma` (CLI) está en `devDependencies` pero el runtime stage usa `pnpm install --prod` | Mover `prisma` a `dependencies` |

## Próximo paso

[Monitoring →](/operaciones/monitoring/)
