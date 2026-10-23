"""Print the files of fallow mutation shard I of N, one per line.

Reads a `fallow mutation --plan --all --format json` report and splits its
files into N lists with about the same count of planned mutants (largest file
first, each to the lightest list). The split is deterministic.

Usage: shard.py PLAN.json I N
"""

import collections
import json
import sys


def main():
    plan, index, count = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    weights = collections.Counter(
        m["file"] for m in json.load(open(plan))["mutants"] if m["disposition"] == "planned"
    )
    shards = [[0, []] for _ in range(count)]
    for file, weight in sorted(weights.items(), key=lambda item: (-item[1], item[0])):
        lightest = min(shards, key=lambda shard: shard[0])
        lightest[0] += weight
        lightest[1].append(file)
    print("\n".join(sorted(shards[index - 1][1])))


if __name__ == "__main__":
    main()
