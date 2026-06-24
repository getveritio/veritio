# Veritio Documentation

This directory contains public OSS documentation for the Veritio protocol,
SDKs, adapters, local tooling, split-repo ownership, and release process.

Veritio supports evidence collection and verification workflows. It is not legal
advice and does not make an application automatically compliant with any
regulation or framework.

## Start Here

- `../README.md`: root product and developer overview.
- `architecture.md`: protocol, SDK, storage, server, Workbench, MCP, and export
  architecture.
- `ai-integration.md`: guidance for AI agents, provenance capture, privacy, and
  MCP usage.
- `repo-map.md`: ownership map for `veritio`, `veritio-website`, and
  `veritio-cloud`.
- `repository-spec.md`: what this OSS repository owns and does not own.
- `split-orchestration.md`: how to coordinate split-repo work from this control
  repo.
- `release-checklist.md`: package, docs, protocol, verification, and publishing
  checks.

## Design Artifacts

- `agent-audit-canvas.html`
- `agent-audit-visualization.html`

Those HTML files are visual/design artifacts for the local evidence and agent
audit direction. Treat them as explanatory design references, not protocol
sources of truth.

## Private Material

Internal execution specs, prompts, roadmap details, and private orchestration
notes must stay in ignored local paths or private repositories. Do not copy
private material into this public `docs/` directory.
