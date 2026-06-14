# Veritio Examples

These directories are reference project skeletons. They are not included in the
root `bun run verify` workspace gate, so install and verify each example from
inside its own directory when you turn it into an application.

The examples keep Veritio setup on the server side, use stable IDs instead of
personal data, and require host applications to provide tenant scope before
recording. They are evidence-support examples for audit trails and data subject
workflows; they do not provide legal advice or automatic regulatory coverage.

## Framework Skeletons

- `nextjs-better-auth`
- `tanstack-start-better-auth`
- `react-better-auth`
- `vue-better-auth`
- `sveltekit-better-auth`

## Storage Skeletons

- `storage-postgres-neon`
- `storage-mysql-mariadb`
- `storage-mongodb`
- `storage-redis`
