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

## Próximo paso

[Configurar secretos →](/operaciones/secretos/)
