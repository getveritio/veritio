# Veritio CLI

Local CLI for the OSS Veritio Workbench and MCP development loop.

```sh
veritio dev --mcp
```

Options:

- `--host <host>`: bind host, default `127.0.0.1`.
- `--port <port>`: bind port, default `4983`.
- `--allow-write-tools`: exposes MCP write tools for local development.
- `--scenario`: seeds the local integration scenario.

MCP write tools are disabled by default. The CLI does not require a hosted
Veritio account, hosted project id, hosted API key, or hosted region.
