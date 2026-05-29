---
title: Migrations
description: Aplicar migrations + seed contra Cloud SQL.
---

Las migrations se aplican **desde tu máquina** (no desde Cloud Run), conectándote a Cloud SQL vía Auth Proxy.

## 1. Instalar Cloud SQL Auth Proxy

**Windows:**

```powershell
# Descargar el binario (ajustar la versión a la última disponible)
mkdir -p $env:USERPROFILE\bin
Invoke-WebRequest `
  -Uri https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.2/cloud-sql-proxy.x64.exe `
  -OutFile $env:USERPROFILE\bin\cloud-sql-proxy.exe
```

**macOS/Linux:** ver [docs oficiales](https://cloud.google.com/sql/docs/postgres/sql-proxy).

## 2. Levantar el proxy

El proxy soporta dos formas de autenticarse:

**Opción A — Application Default Credentials (recomendado):**

```bash
gcloud auth application-default login   # one-time
./cloud-sql-proxy --port 5433 hagemsa-cloud:us-central1:hagemsa-postgresql
```

**Opción B — Access token corto (si ADC falla por política del Workspace):**

Si el `application-default login` falla porque tu Workspace bloquea la pantalla de consent (error "Missing required parameter: redirect_uri" o "scope not consented"), usá un access token corto del `gcloud auth login` que ya tenés activo:

```bash
./cloud-sql-proxy --port 5433 \
  --token "$(gcloud auth print-access-token)" \
  hagemsa-cloud:us-central1:hagemsa-postgresql
```

:::caution[Token expira en ~1h]
Si la sesión dura más, el proxy empezará a tirar `Server has closed the connection`. Reiniciarlo con un token fresco.
:::

El proxy abre Postgres en `127.0.0.1:5433` (cambialo si tenés otro Postgres en `5432`).

## 3. DATABASE_URL para migrations

En **otra terminal**, en el proyecto del Auth Service, exportá la URL apuntando al proxy con el usuario `auth_migrator`:

```bash
export DATABASE_URL="postgresql://auth_migrator:<password-url-encoded>@127.0.0.1:5433/db_auth_service?schema=public"
```

:::tip[URL-encoding del password]
Los caracteres `+`, `=`, `{`, `}` y similares deben ir URL-encoded en la connection string. Quick way en Python:
```bash
python -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "<password-en-claro>"
```

Para evitar futuros dolores de cabeza, generar passwords solo con caracteres alfanuméricos + un sufijo fijo (ej. `Pw1-`) que satisfaga la política de Cloud SQL sin tener chars problemáticos:
```bash
RAW=$(openssl rand -base64 24 | tr '+/=' 'Aa1')
NEW_PW="Pw1-${RAW}"
```
:::

> Si **no recordás la password** de `auth_migrator` o `auth_service`, regenerá la del que necesitás:
> ```bash
> gcloud sql users set-password auth_service \
>   --instance=hagemsa-postgresql \
>   --password="<NUEVA-PASSWORD>"
> ```
> Y **actualizá el secret** `auth-db-url` con la URL nueva (ver [Secretos](/operaciones/secretos/)).

## 4. Aplicar migrations

```bash
pnpm prisma migrate deploy
```

**Esperado:**

```
Applying migration `20260520181735_init_identity`
Applying migration `20260520182945_add_credentials`
Applying migration `20260520184059_add_sessions`
Applying migration `20260520185639_add_authorization`
Applying migration `20260520192033_add_refresh_tokens`
Applying migration `20260520204914_add_audit_and_reset_tokens`
```

## 5. Generar Prisma Client (si cambió el schema)

```bash
pnpm prisma generate
```

## 6. Seed inicial (catálogo de roles y permisos)

```bash
pnpm prisma db seed
```

Esto pobla:

- `authorization.permissions` con el catálogo de ~32 permisos.
- `authorization.roles` con los ~11 roles del sistema (`SUPER_ADMIN`, `GERENTE`, `JEFE_ALMACEN`, `ALMACENERO`, `OPERADOR_FLOTA`, `CONTADOR`, `FACTURADOR`, `VENDEDOR`, `RRHH`, `CHOFER`, `CLIENTE`, `PROVEEDOR`).
- `authorization.role_permissions` con las asignaciones por default.

**Idempotente:** podés correrlo dos veces sin problema. Usa `upsert`.

## 7. Bajar el proxy

Volvé a la terminal con el proxy corriendo y `Ctrl+C`.

## ¿Cuándo aplicar migrations nuevas?

Cada vez que cambies `prisma/schema.prisma`:

1. **En dev** local: `pnpm prisma migrate dev --name <descripcion>`. Esto genera la migration y la aplica a tu DB local.
2. **Revisar el SQL generado** en `prisma/migrations/<timestamp>_<descripcion>/migration.sql`.
3. **Commit** del schema + migration al repo.
4. **En prod:** reconectar el proxy y correr `pnpm prisma migrate deploy`.

## Reglas inquebrantables

- **NUNCA editar manualmente** las migrations en `prisma/migrations/`. Si está mal, borrar la migration completa y regenerar con `migrate dev`.
- **Una migration por feature.** No mezclar cambios no relacionados.
- **Nombre de migration descriptivo y en español.** Ej: `agregar-tabla-refresh-tokens`.
- **Producción: solo `migrate deploy`**, nunca `migrate dev`.

## Próximo paso

[Deploy a Cloud Run →](/operaciones/deploy-cloud-run/)
