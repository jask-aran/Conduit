#define _GNU_SOURCE
#include <errno.h>
#include <stddef.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sys/socket.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>
#if defined(__has_include)
# if __has_include(<linux/landlock.h>)
#  include <linux/landlock.h>
# endif
#endif
#ifndef LANDLOCK_CREATE_RULESET_VERSION
struct landlock_ruleset_attr { uint64_t handled_access_fs; };
struct landlock_path_beneath_attr { uint64_t allowed_access; int32_t parent_fd; } __attribute__((packed));
#define LANDLOCK_CREATE_RULESET_VERSION 1
#define LANDLOCK_RULE_PATH_BENEATH 1
#endif
#ifndef LANDLOCK_ACCESS_FS_EXECUTE
#define LANDLOCK_ACCESS_FS_EXECUTE (1ULL << 0)
#define LANDLOCK_ACCESS_FS_WRITE_FILE (1ULL << 1)
#define LANDLOCK_ACCESS_FS_READ_FILE (1ULL << 2)
#define LANDLOCK_ACCESS_FS_READ_DIR (1ULL << 3)
#define LANDLOCK_ACCESS_FS_REMOVE_DIR (1ULL << 4)
#define LANDLOCK_ACCESS_FS_REMOVE_FILE (1ULL << 5)
#define LANDLOCK_ACCESS_FS_MAKE_CHAR (1ULL << 6)
#define LANDLOCK_ACCESS_FS_MAKE_DIR (1ULL << 7)
#define LANDLOCK_ACCESS_FS_MAKE_REG (1ULL << 8)
#define LANDLOCK_ACCESS_FS_MAKE_SOCK (1ULL << 9)
#define LANDLOCK_ACCESS_FS_MAKE_FIFO (1ULL << 10)
#define LANDLOCK_ACCESS_FS_MAKE_BLOCK (1ULL << 11)
#define LANDLOCK_ACCESS_FS_MAKE_SYM (1ULL << 12)
#endif
#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
#ifndef LANDLOCK_ACCESS_FS_IOCTL_DEV
#define LANDLOCK_ACCESS_FS_IOCTL_DEV (1ULL << 15)
#endif
/*
 * Landlock governs files, not connecting to a unix socket by its path: through the session bus (`systemd-run --user`)
 * or a tmux server a command could reach past the sandbox. A seccomp filter refuses creating unix-domain sockets
 * (socketpair, which pipes and subprocesses use, still works), io_uring (which could make one), and any syscall of
 * another ABI on this machine (x32, i386), which a filter keyed on this ABI's numbers would not see.
 */
#if defined(__x86_64__)
# define NATIVE_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
# define NATIVE_ARCH AUDIT_ARCH_AARCH64
#endif
static int no_unix_sockets(void) {
#if !defined(NATIVE_ARCH)
    errno = ENOSYS; return -1;
#else
    struct sock_filter filter[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, NATIVE_ARCH, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
# if defined(__x86_64__)
        BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
# endif
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_io_uring_setup, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_socket, 0, 3),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_UNIX, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog program = { .len = sizeof(filter) / sizeof(filter[0]), .filter = filter };
    return prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program);
#endif
}
static int fail(const char *what) { fprintf(stderr, "conduit-landlock: %s: %s\n", what, strerror(errno)); return 125; }
int main(int argc, char **argv) {
#if !defined(SYS_landlock_create_ruleset) || !defined(SYS_landlock_add_rule) || !defined(SYS_landlock_restrict_self)
    errno = ENOSYS; return fail("Landlock unavailable");
#else
    int abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 1) return fail("Landlock unavailable");
    uint64_t rights = (1ULL << 13) - 1;
    if (abi >= 2) rights |= LANDLOCK_ACCESS_FS_REFER;
    if (abi >= 3) rights |= LANDLOCK_ACCESS_FS_TRUNCATE;
    if (abi >= 5) rights |= LANDLOCK_ACCESS_FS_IOCTL_DEV;
    struct landlock_ruleset_attr rules = { .handled_access_fs = rights };
    int ruleset = syscall(SYS_landlock_create_ruleset, &rules, sizeof(rules), 0);
    if (ruleset < 0) return fail("create ruleset");
    int i = 1;
    for (; i < argc && strcmp(argv[i], "--") != 0; i += 2) {
        if (i + 1 >= argc || (strcmp(argv[i], "--ro") && strcmp(argv[i], "--rw"))) { errno = EINVAL; return fail("arguments"); }
        int fd = open(argv[i + 1], O_PATH | O_CLOEXEC);
        if (fd < 0) { if (errno == ENOENT) continue; return fail("open path"); }
        struct stat st;
        if (fstat(fd, &st)) return fail("stat path");
        uint64_t allowed = !strcmp(argv[i], "--rw") ? rights : LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
        if (!S_ISDIR(st.st_mode)) allowed &= LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE | LANDLOCK_ACCESS_FS_IOCTL_DEV;
        struct landlock_path_beneath_attr rule = { .allowed_access = allowed, .parent_fd = fd };
        if (syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0)) return fail("add rule");
        close(fd);
    }
    if (i + 1 >= argc) { errno = EINVAL; return fail("missing program"); }
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) return fail("no new privileges");
    if (syscall(SYS_landlock_restrict_self, ruleset, 0)) return fail("restrict");
    if (no_unix_sockets()) return fail("seccomp");
    close(ruleset);
    execvp(argv[i + 1], &argv[i + 1]);
    return fail("exec");
#endif
}
