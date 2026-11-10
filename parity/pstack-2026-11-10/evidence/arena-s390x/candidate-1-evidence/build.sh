set -e
pip install -q ziglang 2>&1 | tail -1
for t in x86_64 aarch64 arm powerpc64le s390x; do
  tgt=$t-linux-musl; [ $t = arm ] && tgt=arm-linux-musleabihf
  python -m ziglang cc -target $tgt -Os -static -s -Wall -Wextra -o out/netbroker-$t netbroker.c 2>&1 | head -20
done
ls -l out; sha256sum out/*
