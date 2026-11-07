FROM debian:trixie-20261104-slim
ARG KERNEL
ARG NODE_ARCH
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap git python3 curl libatomic1 ca-certificates xz-utils iproute2 util-linux initramfs-tools ${KERNEL} \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-${NODE_ARCH}.tar.xz" | tar -xJ -C /opt \
  && ln -s "/opt/node-v22.23.4-linux-${NODE_ARCH}" /opt/node
RUN useradd -m -u 1000 pi
