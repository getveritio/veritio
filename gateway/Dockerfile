# Single-container self-host image for @veritio/gateway.
# Build context is the repo root after `bun run build` (dist/ must exist):
#   docker build -f gateway/Dockerfile -t veritio-gateway .
# Run with config + evidence volume mounted; prompts and provider keys never
# leave this container's network boundary:
#   docker run -p 8790:8790 \
#     -v $PWD/veritio-gateway.json:/app/veritio-gateway.json:ro \
#     -v veritio-evidence:/var/lib/veritio-gateway \
#     veritio-gateway
FROM oven/bun:1.3-slim

WORKDIR /app

COPY gateway/dist ./dist
COPY gateway/pricing ./pricing
COPY gateway/package.json ./package.json
COPY node_modules/@veritio/core/dist ./node_modules/@veritio/core/dist
COPY node_modules/@veritio/core/package.json ./node_modules/@veritio/core/package.json
COPY node_modules/@veritio/storage/dist ./node_modules/@veritio/storage/dist
COPY node_modules/@veritio/storage/package.json ./node_modules/@veritio/storage/package.json

ENV VERITIO_GATEWAY_CONFIG=/app/veritio-gateway.json
ENV VERITIO_GATEWAY_PORT=8790

USER bun
EXPOSE 8790
CMD ["bun", "dist/server.js"]
