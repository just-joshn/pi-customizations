package main

import (
	"fmt"
	"net"
	"os"
	"syscall"
)

func main() {
	path := os.Args[1]
	fds, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_DGRAM, 0)
	if err != nil {
		fmt.Println("socketpair dgram:", err)
	} else {
		sa := &syscall.SockaddrUnix{Name: path}
		fmt.Println("socketpair dgram sendto:", syscall.Sendto(fds[0], []byte("GO"), 0, sa))
	}
	if sp, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0); err == nil {
		fmt.Println("socketpair stream: ok", sp[0] > 0)
	} else {
		fmt.Println("socketpair stream:", err)
	}
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	go func() { c, _ := l.Accept(); if c != nil { c.Close() } }()
	c, err := net.Dial("tcp", l.Addr().String())
	fmt.Println("tcp loopback:", err == nil)
	if c != nil { c.Close() }
}
