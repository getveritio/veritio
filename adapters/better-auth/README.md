# `@veritio/better-auth`

Better Auth adapter for emitting Veritio events for auth lifecycle activity.

Initial event targets:

- sign-in success and failure
- sign-up
- password reset request and completion
- session revoke
- organization/member changes when used by the host app

This adapter must receive a configured Veritio recorder from the host application. It must not read secrets or storage credentials directly.
