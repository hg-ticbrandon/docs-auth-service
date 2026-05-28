---
title: Deploy a Cloud Run
description: Construir la imagen y desplegar el Auth Service a Cloud Run.
---

## Opciones

| Método | Cuándo usar |
|---|---|
| Cloud Build + trigger sobre GitHub | Recomendado: deploy automático en cada push a `main` |
| `gcloud run deploy` manual | Para deploys ad-hoc o validar la primera vez |

## Opción A: Cloud Build trigger sobre GitHub (recomendado)

### A.1 Conectar repo

1. Cloud Build console → Triggers → Connect Repository.
2. Elegir GitHub, autorizar la GitHub App de Google Cloud Build.
3. Seleccionar el repo `hagemsa-auth-service`.

### A.2 Crear trigger

1. New Trigger:
   - **Event:** Push to a branch.
   - **Branch:** `^main$`.
   - **Configuration:** Cloud Build configuration file → `cloudbuild.yaml` (vive en el repo).
2. Variables substitutions (si el `cloudbuild.yaml` las usa):
   - `_REGION=us-central1`
   - `_SERVICE_NAME=auth-service`

### A.3 Probar

Push a `main` → Cloud Build construye la imagen y la deploya. Ver progreso en Cloud Build console.

## Opción B: Deploy manual

### B.1 Build localmente

Desde la raíz del repo:

```bash
gcloud builds submit \
  --tag us-central1-docker.pkg.dev/hagemsa-cloud/api/auth/auth-service:v0.1.0
```

### B.2 Deploy

```bash
gcloud run deploy auth-service \
  --image=us-central1-docker.pkg.dev/hagemsa-cloud/api/auth/auth-service:v0.1.0 \
  --region=us-central1 \
  --service-account=auth-service@hagemsa-cloud.iam.gserviceaccount.com \
  --add-cloudsql-instances=hagemsa-cloud:us-central1:hagemsa-postgresql \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --concurrency=80 \
  --timeout=30s \
  --update-secrets=JWT_PRIVATE_KEY=jwt-private-key:latest \
  --update-secrets=JWT_PUBLIC_KEY=jwt-public-key:latest \
  --update-secrets=DATABASE_URL=auth-db-url:latest \
  --update-secrets=INTERNAL_SHARED_SECRET=internal-shared-secret:latest \
  --update-secrets=SENDGRID_API_KEY=sendgrid-api-key:latest \
  --update-secrets=PASSWORD_RESET_LINK=password-reset-link:latest \
  --set-env-vars=JWT_ISSUER=https://auth.hagemsa.com \
  --set-env-vars=JWT_AUDIENCE=hagemsa-backends \
  --set-env-vars=JWT_ACCESS_TTL_SECONDS=3600 \
  --set-env-vars=JWT_REFRESH_TTL_SECONDS=2592000 \
  --set-env-vars=ENVIRONMENT=production \
  --set-env-vars=SENDGRID_FROM=no-reply@hagemsa.com \
  --set-env-vars=SENDGRID_FROM_NAME=HAGEMSA \
  --startup-probe=httpGet.path=/health/ready,initialDelaySeconds=5,timeoutSeconds=3,periodSeconds=5,failureThreshold=5 \
  --liveness-probe=httpGet.path=/health,initialDelaySeconds=15,timeoutSeconds=3,periodSeconds=15,failureThreshold=3
```

> El repo tiene `cloud-run-service.yaml` con esta config en formato declarativo. Para usarlo: `gcloud run services replace cloud-run-service.yaml --region us-central1`.

## Verificar el deploy

```bash
# URL del servicio
gcloud run services describe auth-service --region=us-central1 --format='value(status.url)'

# Probar health
curl https://<url-del-servicio>/health
# → { "status": "ok" }

# Probar JWKS
curl https://<url-del-servicio>/.well-known/jwks.json
# → { "keys": [{ "kty": "RSA", ... }] }
```

## Crear el SUPER_ADMIN inicial

La primera vez, no hay ningún usuario. Para crear el primer SUPER_ADMIN, hay dos opciones:

**Opción 1: directo en DB** (rápido para bootstrap).

Conectarse con `auth_migrator` vía proxy (ver [Migrations](/operaciones/migrations/)) y ejecutar:

```sql
-- Crear cuenta
INSERT INTO identity.accounts (id, email, account_type, status, full_name, updated_at)
VALUES (gen_random_uuid(), 'admin@hagemsa.com', 'interno', 'activo', 'Super Admin', now())
RETURNING id;

-- Setear password (hash Argon2id pre-calculado para "TempPass123" — cambiar inmediatamente):
INSERT INTO credentials.passwords (account_id, password_hash, password_changed_at)
VALUES ('<id-recien-creado>', '$argon2id$v=19$m=65536,t=3,p=4$...', now());

-- Asignar SUPER_ADMIN (id del rol viene del seed)
INSERT INTO authorization.user_role_assignments (id, account_id, role_id, scope, assigned_at)
SELECT gen_random_uuid(), '<id-recien-creado>', id, '{}'::jsonb, now()
FROM authorization.roles WHERE name = 'SUPER_ADMIN';
```

**Opción 2: script `scripts/bootstrap-admin.ts`** (si lo creas más adelante).

Después, login con `admin@hagemsa.com` y cambiar el password inmediatamente.

## Próximo paso

[Monitoring →](/operaciones/monitoring/)
