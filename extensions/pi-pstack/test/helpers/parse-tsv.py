import csv
import json
import sys

sys.stdout.write(json.dumps(list(csv.reader(sys.stdin, delimiter="\t"))) + "\n")
