package main

import (
	"fmt"
	"os"
	"strings"
)

const banner = "rea-parity-fixture"

type greeting struct {
	Name string
}

func greet(g greeting) string {
	return strings.ToUpper(fmt.Sprintf("hello %s", g.Name))
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "-v" {
		fmt.Println("verbose", banner)
		return
	}
	fmt.Println(greet(greeting{Name: banner}))
}
