#!/bin/sh
# PID 1 in the emulated guest: mount what checks.sh needs, run it, power off.
mount -t proc proc /proc 2>/dev/null
mount -t sysfs sysfs /sys 2>/dev/null
mount -t devtmpfs devtmpfs /dev 2>/dev/null
mount -t tmpfs tmpfs /tmp
mount -t tmpfs tmpfs /run 2>/dev/null
ip link set lo up
/ro-check/checks.sh
echo o > /proc/sysrq-trigger
