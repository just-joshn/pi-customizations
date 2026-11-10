import struct
def run(prog, endian, nr, arch, args):
    e = '>' if endian=='BE' else '<'
    data = struct.pack(e+'IIQ6Q', nr, arch, 0, *args)
    ins = [struct.unpack(e+'HBBI', prog[i:i+8]) for i in range(0, len(prog), 8)]
    pc = 0; A = 0
    while True:
        code, jt, jf, k = ins[pc]
        if code == 0x20: A = struct.unpack(e+'I', data[k:k+4])[0]; pc += 1
        elif code == 0x15: pc += 1 + (jt if A == k else jf)
        elif code == 0x35: pc += 1 + (jt if A >= k else jf)
        elif code == 0x06: return {0x7fff0000:'ALLOW',0x00050001:'EPERM',0x80000000:'KILL'}.get(k, hex(k))
        else: raise Exception(hex(code))
prog = open('/tmp/s390x.bpf','rb').read(); AUD=0x80000016
NAMES={1:'SYS_SOCKET',2:'SYS_BIND',3:'SYS_CONNECT',5:'SYS_ACCEPT',8:'SYS_SOCKETPAIR',11:'SYS_SENDTO',16:'SYS_SENDMSG',20:'SYS_SENDMMSG'}
print('s390x filter, independent BPF interpreter (nr=102 socketcall, arg0=call):')
for c,n in NAMES.items(): print(f'  socketcall({n}={c}):', run(prog,'BE',102,AUD,[c,0,0,0,0,0]))
print('  socketcall(call=0x100000001 -> kernel int 1):', run(prog,'BE',102,AUD,[0x100000001,0,0,0,0,0]))
print('  direct socket(359, AF_UNIX=1):', run(prog,'BE',359,AUD,[1,0,0,0,0,0]))
print('  direct socket(359, AF_INET=2):', run(prog,'BE',359,AUD,[2,0,0,0,0,0]))
print('  direct socketpair(360, AF_UNIX=1):', run(prog,'BE',360,AUD,[1,0,0,0,0,0]))
print('  connect(362):', run(prog,'BE',362,AUD,[3,0,0,0,0,0]))
