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

### Rotar el password de `auth_service`

Si el password de `auth_service` quedó desincronizado con Cloud SQL (típicamente porque cambió en uno pero no en el otro), rotalo y actualizá una nueva versión del secret:

```bash
# 1. Generar password URL-safe que cumpla la política (mayúscula + minúscula + número + special)
RAW=$(openssl rand -base64 24 | tr '+/=' 'Aa1')
NEW_PW="Pw1-${RAW}"

# 2. Aplicar a Cloud SQL
gcloud sql users set-password auth_service --instance=hagemsa-postgresql --password="$NEW_PW"

# 3. Componer la URL nueva y subirla como nueva versión del secret
PW_ENCODED=$(python -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$NEW_PW")
echo -n "postgresql://auth_service:${PW_ENCODED}@/db_auth_service?host=/cloudsql/hagemsa-cloud:us-central1:hagemsa-postgresql" \
  > /tmp/dburl.txt
gcloud secrets versions add auth-db-url --data-file=/tmp/dburl.txt
rm /tmp/dburl.txt
```

Cloud Run lee `auth-db-url:latest` y toma la versión nueva en el próximo deploy o restart automático. **No** hay que cambiar la config del servicio.

:::caution[Passwords con `+`, `=`, `/`]
Cloud SQL acepta passwords con estos caracteres, pero te van a complicar todo el resto del flujo (URL-encoding, shell escaping, lectura del secret en scripts). Recomendado: generar passwords solo con alfanuméricos + un sufijo fijo seguro (`Pw1-` ya tiene los 4 tipos exigidos por la política).
:::

## 4. Internal shared secret

Este secreto viaja como header HTTP `X-Internal-Secret` y se compara **byte-exacto**
(timing-safe, sin trim) en el Auth Service. Por eso **NO puede tener un salto de
línea final** ni espacios: un header HTTP no puede contener `\r`/`\n`, y un byte
de más rompe la comparación → todos los consumidores recibirían 401.

```bash
# Generar SIN newline final (tr -d '\n'). NUNCA `openssl ... > archivo` ni `echo`,
# que dejan un \n y rompen la comparación byte-exacta.
openssl rand -hex 32 | tr -d '\n' | \
  gcloud secrets create internal-shared-secret --data-file=- --project=hagemsa-cloud
```

:::danger[No metas un newline en este secreto]
`openssl rand -base64 32 > archivo` y `echo "valor" | gcloud ...` agregan un `\n`
final (en Windows, `\r\n`). Como el valor se manda en un header HTTP y se compara
byte-exacto, ese newline hace que **ningún backend pueda autenticarse** a
`/api/internal/*` (la blacklist queda inutilizable). Usá siempre `printf '%s'` o
`| tr -d '\n'` y verificá con `gcloud secrets versions access latest --secret=internal-shared-secret | xxd | tail -1` que NO termine en `0d`/`0a`.
:::

### Cómo OBTENER el valor (para compartirlo con un backend)

Quien tenga rol `roles/secretmanager.secretAccessor` sobre el secreto:

```bash
gcloud secrets versions access latest \
  --secret=internal-shared-secret --project=hagemsa-cloud
```

> **Compartir este secreto** con cada backend que vaya a usar `@hagemsa/auth-guard`
> con `enableBlacklistCheck: true` **o** que resuelva permisos por catálogo (tokens
> "flacos", ≥ 0.4.0, cuando el Auth Service emita con `JWT_EMBED_PERMISOS=false`).
> Ambos usos pegan a `/api/internal/*` con este header. En sus deploys va como env
> `AUTH_INTERNAL_SECRET` (idealmente también desde Secret Manager, no en texto
> plano). Los devs que solo integran un backend normalmente **lo piden al equipo de
> plataforma** en vez de tener acceso directo al secreto.
>
> El **frontend** (`FR_HagemsaERP`) también lo necesita —como `INTERNAL_SHARED_SECRET`—
> para resolver permisos de tokens flacos del lado servidor. Mismo valor, byte-exacto.

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
