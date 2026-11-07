#!/bin/sh
# Prints the AUDIT_ARCH_* definitions and the syscall numbers the filter uses from the kernel's own sources, at the
# kernel versions RHEL 9 (5.14), Debian 12 (6.1), Ubuntu 24.04 (6.8), and Debian 13 (6.12) ship.
set -eu
raw=https://raw.githubusercontent.com/torvalds/linux
for tag in v5.14 v6.1 v6.8 v6.12; do
  echo "=== $tag"
  get() { curl -fsSL --max-time 60 "$raw/$tag/$1"; }
  get include/uapi/linux/audit.h | grep -E 'define (__AUDIT_ARCH_(64BIT|LE)|AUDIT_ARCH_(X86_64|I386|AARCH64|ARM|ARMEB|PPC|PPC64|PPC64LE|S390|S390X))\s' | tr -s '\t ' ' ' | sed 's/^/audit.h: /'
  get include/uapi/linux/elf-em.h | grep -E 'define EM_(386|ARM|PPC|PPC64|S390|X86_64|AARCH64)\s' | tr -s '\t ' ' ' | sed 's/^/elf-em.h: /'
  get arch/x86/entry/syscalls/syscall_64.tbl | grep -wE 'socket|io_uring_setup|openat' | tr -s '\t ' ' ' | sed 's/^/x86 syscall_64.tbl: /'
  get include/uapi/asm-generic/unistd.h | grep -E '__NR_(socket|io_uring_setup|openat) ' | sed 's/^/asm-generic unistd.h (arm64): /'
  get arch/arm/tools/syscall.tbl | grep -wE 'socket|socketcall|syscall|io_uring_setup|openat' | grep -v '^#' | tr -s '\t ' ' ' | sed 's/^/arm syscall.tbl: /'
  get arch/powerpc/kernel/syscalls/syscall.tbl | grep -wE 'socket|socketcall|io_uring_setup|openat' | tr -s '\t ' ' ' | sed 's/^/powerpc syscall.tbl: /'
  get arch/s390/kernel/syscalls/syscall.tbl | grep -wE 'socket|socketcall|io_uring_setup|openat' | tr -s '\t ' ' ' | sed 's/^/s390 syscall.tbl: /'
  get include/uapi/linux/net.h | grep -E 'define SYS_SOCKET\s' | tr -s '\t ' ' ' | sed 's/^/net.h: /'
done
echo "=== v6.12 struct seccomp_data (include/uapi/linux/seccomp.h)"
curl -fsSL --max-time 60 "$raw/v6.12/include/uapi/linux/seccomp.h" | sed -n '/^struct seccomp_data {/,/^};/p'
echo "=== v6.12 arch/arm/kernel/entry-common.S: OABI numbers and the indirect syscall"
curl -fsSL --max-time 60 "$raw/v6.12/arch/arm/kernel/entry-common.S" | grep -nE 'eorne\s+scno, r10, #__NR_OABI_SYSCALL_BASE|^sys_syscall:|ldrlo\s+pc, \[tbl, scno'
echo "=== glibc 2.41 sysdeps/unix/sysv/linux/s390/kernel-features.h"
curl -fsSL --max-time 60 https://raw.githubusercontent.com/bminor/glibc/glibc-2.41/sysdeps/unix/sysv/linux/s390/kernel-features.h | grep -nE 'Direct socketcalls|__LINUX_KERNEL_VERSION < 0x040300|undef __ASSUME_SOCKET_SYSCALL'
echo "=== qemu v10.0.0 linux-user/syscall.c: qemu-user refuses PR_SET_SECCOMP"
curl -fsSL --max-time 60 https://raw.githubusercontent.com/qemu/qemu/v10.0.0/linux-user/syscall.c | grep -nE 'case PR_SET_SECCOMP:|Disable to prevent the target disabling stuff we need'
