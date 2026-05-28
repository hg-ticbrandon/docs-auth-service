---
title: Migrations
description: Aplicar migrations + seed contra Cloud SQL.
---

Las migrations se aplican **desde tu máquina** (no desde Cloud Run), conectándote a Cloud SQL vía Auth Proxy.

## 1. Instalar Cloud SQL Auth Proxy

**Windows:**

```powershell
# Descargar el binario más reciente
Invoke-WebRequest `
  -Uri https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.x.x/cloud-sql-proxy.x64.exe `
  -OutFile cloud-sql-proxy.exe
```

**macOS/Linux:** ver [docs oficiales](https://cloud.google.com/sql/docs/postgres/sql-proxy).

## 2. Levantar el proxy

```bash
./cloud-sql-proxy hagemsa-cloud:us-central1:hagemsa-postgresql
```

El proxy abre Postgres en `127.0.0.1:5432`. Autentica con tus credenciales de `gcloud auth login` (no necesitás IP pública abierta).

## 3. DATABASE_URL para migrations

En **otra terminal**, en el proyecto del Auth Service, exportá la URL apuntando al proxy con el usuario `auth_migrator`:

```bash
export DATABASE_URL="postgresql://auth_migrator:<password-url-encoded>@127.0.0.1:5432/db_auth_service"
```

> Si **no recordás la password** de `auth_migrator`, regenerala:
> ```bash
> gcloud sql users set-password auth_migrator \
>   --instance=hagemsa-postgresql \
>   --password="$(openssl rand -base64 18 | tr -d '=+/')Aa1"
> ```

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
