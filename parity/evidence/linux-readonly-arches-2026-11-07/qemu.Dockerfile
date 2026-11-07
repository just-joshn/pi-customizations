FROM debian:trixie-20261104-slim
RUN apt-get update && apt-get install -y --no-install-recommends qemu-system-arm qemu-system-ppc qemu-system-s390x e2fsprogs && rm -rf /var/lib/apt/lists/*
