# `veritio-fastapi`

FastAPI adapter for Python applications.

The adapter should integrate with the Python SDK and expose dependency/middleware helpers for actor, request, and tenant scope.

For governed create/update/delete routes today, call
`create_governed_action_draft` from the Python SDK inside the FastAPI route or
service method that owns authorization, tenant scope, before/after rows, and the
database mutation. See `../../docs/integrations.md` and
`../../examples/fastapi-governed-crud`.
