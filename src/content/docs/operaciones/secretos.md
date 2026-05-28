---
title: Secretos y claves
description: Generar claves RSA y subir secretos a Secret Manager.
---

## Secretos requeridos

| Secret | Contenido |
|---|---|
| `jwt-private-key` | Clave privada RSA 2048 (PEM) — firma JWTs |
| `jwt-public-key` | Clave pública RSA 2048 (PEM) — expuesta vía JWKS |
| `auth-db-url` | Connection string PostgreSQL del usuario runtime |
| `internal-shared-secret` | Token compartido para `/api/internal/*` |
| `sendgrid-api-key` | API key de SendGrid (opcional, solo si se usa email) |
| `password-reset-link` | URL base donde el usuario completa el reset (`https://app.hagemsa.com/reset?token=`) |

## 1. Generar par RSA

Localmente, en una máquina segura:

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

> Borrá `private.pem` y `public.pem` localmente después de subirlos. Nunca commitearlos al repo.

## 2. Subir a Secret Manager

```bash
gcloud secrets create jwt-private-key --data-file=private.pem
gcloud secrets create jwt-public-key --data-file=public.pem
```

## 3. Connection string de la DB

**Importante:** URL-encode los caracteres especiales del password. `+` → `%2B`, `/` → `%2F`, `=` → `%3D`, `@` → `%40`.

```bash
# Componer la URL vía variables (evita problemas de wrap en Cloud Shell)
SVC='auth_service'
PWD='<password-de-auth_service-url-encoded>'
DB='db_auth_service'
INST='hagemsa-cloud:us-central1:hagemsa-postgresql'

echo -n "postgresql://${SVC}:${PWD}@/${DB}?host=/cloudsql/${INST}" > /tmp/dburl.txt

# Verificar (debe ser un string en una sola línea)
cat /tmp/dburl.txt; echo
wc -c /tmp/dburl.txt

gcloud secrets create auth-db-url --data-file=/tmp/dburl.txt
rm /tmp/dburl.txt
```

> **Por qué archivo temporal:** Cloud Shell mete saltos de línea en pipes con strings largos. Usar archivo evita el problema.

## 4. Internal shared secret

```bash
openssl rand -base64 32 > /tmp/secret.txt
gcloud secrets create internal-shared-secret --data-file=/tmp/secret.txt
rm /tmp/secret.txt
```

> **Compartir este secreto** con cada backend que vaya a usar `@hagemsa/auth-guard` con `enableBlacklistCheck: true`. En sus deploys, va como env `AUTH_INTERNAL_SECRET` (también desde Secret Manager).

## 5. SendGrid (opcional)

Si vas a usar SendGrid para envío de password reset emails:

1. Crear API key en SendGrid → Settings → API Keys → "Mail Send" only permission.
2. Subir:

```bash
echo -n "<sendgrid-api-key>" > /tmp/sg.txt
gcloud secrets create sendgrid-api-key --data-file=/tmp/sg.txt
rm /tmp/sg.txt
```

Sin esta key, el Auth Service usa `LoggingEmailSender` (loggea el email en lugar de enviarlo) — útil en dev/staging.

## 6. Password reset link

```bash
echo -n "https://app.hagemsa.com/reset?token=" > /tmp/link.txt
gcloud secrets create password-reset-link --data-file=/tmp/link.txt
rm /tmp/link.txt
```

## Verificar todos los secretos

```bash
gcloud secrets list
```

Esperado:

```
NAME                       CREATED
jwt-private-key            ...
jwt-public-key             ...
auth-db-url                ...
internal-shared-secret     ...
sendgrid-api-key           ...
password-reset-link        ...
```

## Service Account + IAM

Crear la SA que usará Cloud Run:

```bash
gcloud iam service-accounts create auth-service \
  --display-name="Auth Service - Cloud Run"
```

Asignar roles mínimos:

```bash
SA="auth-service@hagemsa-cloud.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding hagemsa-cloud \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None

gcloud projects add-iam-policy-binding hagemsa-cloud \
  --member="serviceAccount:${SA}" \
  --role="roles/cloudsql.client" \
  --condition=None

gcloud projects add-iam-policy-binding hagemsa-cloud \
  --member="serviceAccount:${SA}" \
  --role="roles/logging.logWriter" \
  --condition=None
```

> Si el proyecto ya tiene **conditional bindings** preexistentes, hay que pasar `--condition=None` explícito o gcloud entra en prompt interactivo.

## Próximo paso

[Aplicar migrations →](/operaciones/migrations/)
