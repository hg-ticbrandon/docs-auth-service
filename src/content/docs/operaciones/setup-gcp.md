---
title: Setup de GCP
description: One-time setup del proyecto GCP para el Auth Service.
---

Esta guía es para hacer el setup inicial **una sola vez** en un proyecto GCP nuevo. Si ya está hecho, salta a [Deploy a Cloud Run](/operaciones/deploy-cloud-run/).

## Pre-requisitos

- Cuenta GCP con rol `roles/owner` en el proyecto.
- `gcloud` CLI instalado y autenticado: `gcloud auth login`.
- Proyecto creado en GCP (ej. `hagemsa-cloud`).

## 1. Configurar proyecto

```bash
gcloud config set project hagemsa-cloud
gcloud config set compute/region us-central1
```

## 2. Habilitar APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  vpcaccess.googleapis.com
```

## 3. Cloud SQL (PostgreSQL)

### 3.1 Crear instancia

```bash
gcloud sql instances create hagemsa-postgresql \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --availability-type=REGIONAL \
  --database-flags=max_connections=200
```

> **Tier:** `db-f1-micro` para empezar. Subir a `db-custom-2-7680` o superior cuando llegue tráfico real.

### 3.2 Crear database + usuarios

```bash
gcloud sql databases create db_auth_service --instance=hagemsa-postgresql

# Usuario runtime (DML only)
gcloud sql users create auth_service \
  --instance=hagemsa-postgresql \
  --password="$(openssl rand -base64 18 | tr -d '=+/')Aa1"

# Usuario migrator (DDL)
gcloud sql users create auth_migrator \
  --instance=hagemsa-postgresql \
  --password="$(openssl rand -base64 18 | tr -d '=+/')Aa1"
```

> **Guardar las passwords en tu password manager.** Las vas a necesitar para Secret Manager y para correr migrations.

### 3.3 Crear schemas y grants

Conectarse como `postgres`:

```bash
gcloud sql connect hagemsa-postgresql --user=postgres --database=db_auth_service
```

Y ejecutar:

```sql
-- Crear los 5 schemas
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS credentials;
CREATE SCHEMA IF NOT EXISTS "authorization";  -- comillas obligatorias (palabra reservada)
CREATE SCHEMA IF NOT EXISTS sessions;
CREATE SCHEMA IF NOT EXISTS audit;

-- auth_migrator puede crear tablas
GRANT USAGE, CREATE ON SCHEMA identity, credentials, "authorization", sessions, audit TO auth_migrator;

-- auth_service puede leer/escribir
GRANT USAGE ON SCHEMA identity, credentials, "authorization", sessions, audit TO auth_service;

-- Cloud SQL: postgres NO es SUPERUSER real. Para ALTER DEFAULT PRIVILEGES
-- en nombre de auth_migrator, hay que ganar membership temporalmente.
GRANT auth_migrator TO postgres;

-- Cada vez que auth_migrator cree una tabla, auth_service tendrá SELECT/INSERT/UPDATE/DELETE
ALTER DEFAULT PRIVILEGES FOR ROLE auth_migrator IN SCHEMA identity, credentials, "authorization", sessions, audit
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_service;

ALTER DEFAULT PRIVILEGES FOR ROLE auth_migrator IN SCHEMA identity, credentials, "authorization", sessions, audit
  GRANT USAGE ON SEQUENCES TO auth_service;

REVOKE auth_migrator FROM postgres;
```

### 3.4 Ajustar ownership de schemas si fueron creados por auth_migrator

Si los schemas terminaron siendo del usuario equivocado, aplicar el patrón:

```sql
GRANT auth_migrator TO postgres;
ALTER SCHEMA identity OWNER TO postgres;
ALTER SCHEMA credentials OWNER TO postgres;
ALTER SCHEMA "authorization" OWNER TO postgres;
ALTER SCHEMA sessions OWNER TO postgres;
ALTER SCHEMA audit OWNER TO postgres;
REVOKE auth_migrator FROM postgres;
```

## 4. Artifact Registry

```bash
gcloud artifacts repositories create auth \
  --repository-format=docker \
  --location=us-central1 \
  --description="Imágenes del Auth Service"
```

## 5. Service Account de runtime

El servicio corre en Cloud Run con un SA dedicado que solo tiene los roles que necesita.

```bash
gcloud iam service-accounts create auth-service \
  --display-name="Auth Service runtime"

PROJECT_ID=hagemsa-cloud
RUNTIME_SA=auth-service@${PROJECT_ID}.iam.gserviceaccount.com

# Leer secretos, conectar a Cloud SQL, escribir logs
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$RUNTIME_SA" --role="roles/secretmanager.secretAccessor" --condition=None
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$RUNTIME_SA" --role="roles/cloudsql.client" --condition=None
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$RUNTIME_SA" --role="roles/logging.logWriter" --condition=None
```

## 6. IAM para el SA que ejecuta builds

Cloud Build regional (con `--region=us-central1`) corre por default con el **Compute Engine default SA** (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`), no con el legacy Cloud Build SA. Hay que darle 3 roles para que pueda hacer el build + deploy:

```bash
PROJECT_NUM=$(gcloud projects describe hagemsa-cloud --format="value(projectNumber)")
COMPUTE_SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"
RUNTIME_SA="auth-service@hagemsa-cloud.iam.gserviceaccount.com"

# Leer secrets durante el build
gcloud projects add-iam-policy-binding hagemsa-cloud --member="serviceAccount:$COMPUTE_SA" --role="roles/secretmanager.secretAccessor" --condition=None

# Deployar Cloud Run
gcloud projects add-iam-policy-binding hagemsa-cloud --member="serviceAccount:$COMPUTE_SA" --role="roles/run.admin" --condition=None

# Impersonar al runtime SA (necesario para asignarlo al service)
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$COMPUTE_SA" \
  --role="roles/iam.serviceAccountUser"
```

:::caution[Conditional IAM bindings preexistentes]
Si el proyecto tiene bindings con `condition` (por ejemplo, Developer Connect), `gcloud` falla al agregar nuevos roles **sin** el flag `--condition=None`. Pasarlo siempre como en los ejemplos de arriba.
:::

## 7. APIs adicionales según features

El bloque del paso 2 cubre lo mínimo. Si vas a habilitar features extra, agregar:

```bash
# Si usás Memorystore Redis para cache de permisos:
gcloud services enable redis.googleapis.com

# Si configurás Cloud Build trigger sobre GitHub:
gcloud services enable cloudbuild.googleapis.com  # (ya está en el paso 2)
gcloud services enable iam.googleapis.com         # (ya está)
```

## Próximo paso

[Configurar secretos →](/operaciones/secretos/)
