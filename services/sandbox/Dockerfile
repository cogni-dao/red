# OpenSandbox release-1.1.1: digest from its authoritative release BOM.
FROM opensandbox/execd@sha256:cda2bc35409bbf57561599b316cafb899598f7dce671332e7ceda14eb1cfeded AS execd
FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587

ARG BUILD_SHA=unknown
LABEL org.opencontainers.image.source="https://github.com/cogni-dao/red" \
      org.opencontainers.image.revision="${BUILD_SHA}" \
      org.opencontainers.image.description="Red trusted-session toolbox; separate operator-managed sandbox lease"

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl python3 python3-pwntools gdb binutils file \
    nmap netcat-openbsd socat jq \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home --shell /bin/bash sandboxer \
    && install -d -m 0700 -o sandboxer -g sandboxer /workspace
COPY --from=execd /execd /usr/local/bin/execd
COPY entrypoint.sh /usr/local/bin/sandbox-entrypoint
COPY LICENSE.execd /usr/share/doc/opensandbox/LICENSE
RUN chmod 0755 /usr/local/bin/execd /usr/local/bin/sandbox-entrypoint
USER 1000:1000
WORKDIR /workspace
ENV HOME=/home/sandboxer
EXPOSE 44772
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s \
  CMD curl --fail --silent http://127.0.0.1:44772/ready || exit 1
ENTRYPOINT ["/usr/local/bin/sandbox-entrypoint"]
