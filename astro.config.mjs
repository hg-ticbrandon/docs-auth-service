// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'HAGEMSA Auth Service',
      description:
        'Documentación del servicio de autenticación y autorización centralizado de Transportes HAGEMSA SAC.',
      customCss: ['./src/styles/custom.css'],
      defaultLocale: 'root',
      locales: {
        root: { label: 'Español', lang: 'es' },
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/hagemsa',
        },
      ],
      sidebar: [
        {
          label: 'Empezar aquí',
          items: [
            { label: 'Qué es el Auth Service', slug: 'getting-started/intro' },
            { label: 'Conceptos clave', slug: 'getting-started/conceptos' },
            { label: 'Glosario del dominio', slug: 'getting-started/glosario' },
          ],
        },
        {
          label: 'Integrar un backend',
          items: [
            { label: 'Visión general', slug: 'integracion/vision-general' },
            { label: 'Flujo del token (frontend → backend)', slug: 'integracion/flujo-token' },
            { label: 'Instalación', slug: 'integracion/instalacion' },
            { label: 'Configuración', slug: 'integracion/configuracion' },
            { label: 'Proteger endpoints', slug: 'integracion/proteger-endpoints' },
            { label: 'Permisos y scopes', slug: 'integracion/permisos-scopes' },
            { label: 'Backend-a-backend (M2M)', slug: 'integracion/m2m' },
            { label: 'Ejemplo end-to-end (M2M)', slug: 'integracion/m2m-ejemplo' },
            { label: 'Revocación y logout', slug: 'integracion/revocacion' },
            { label: 'Desplegar a Cloud Run', slug: 'integracion/deploy-consumidor' },
            { label: 'Errores comunes', slug: 'integracion/errores-comunes' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'Convenciones', slug: 'api-reference/convenciones' },
            { label: 'Autenticación', slug: 'api-reference/auth' },
            { label: 'Cuentas (admin)', slug: 'api-reference/cuentas' },
            { label: 'Credenciales (admin)', slug: 'api-reference/credenciales' },
            { label: 'Roles (admin)', slug: 'api-reference/roles' },
            { label: 'Permisos (admin)', slug: 'api-reference/permisos' },
            { label: 'Asignaciones (admin)', slug: 'api-reference/asignaciones' },
            { label: 'Sesiones (admin)', slug: 'api-reference/sesiones' },
            { label: 'Clientes de servicio (admin)', slug: 'api-reference/service-clients' },
            { label: 'Auditoría (admin)', slug: 'api-reference/audit' },
            { label: 'Endpoints internos', slug: 'api-reference/interno' },
            { label: 'JWKS y health', slug: 'api-reference/jwks-health' },
          ],
        },
        {
          label: 'Arquitectura',
          items: [
            { label: 'Visión general', slug: 'arquitectura/vision-general' },
            { label: 'Bounded contexts', slug: 'arquitectura/bounded-contexts' },
            { label: 'Capas (DDD)', slug: 'arquitectura/capas' },
            { label: 'Patrones', slug: 'arquitectura/patrones' },
            { label: 'Modelo de datos', slug: 'arquitectura/modelo-datos' },
            { label: 'Seguridad', slug: 'arquitectura/seguridad' },
          ],
        },
        {
          label: 'Operaciones',
          items: [
            { label: 'Setup de GCP', slug: 'operaciones/setup-gcp' },
            { label: 'Secretos y claves', slug: 'operaciones/secretos' },
            { label: 'Publicar auth-guard', slug: 'operaciones/publicar-libreria' },
            { label: 'Migrations', slug: 'operaciones/migrations' },
            { label: 'Deploy a Cloud Run', slug: 'operaciones/deploy-cloud-run' },
            { label: 'Monitoring', slug: 'operaciones/monitoring' },
            { label: 'Troubleshooting', slug: 'operaciones/troubleshooting' },
            { label: 'Runbooks', slug: 'operaciones/runbooks' },
          ],
        },
      ],
    }),
  ],
});
