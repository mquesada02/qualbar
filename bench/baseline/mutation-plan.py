"""Print the mutation job matrix as JSON for GitHub Actions.

Linux runs every shard (the full run). macOS runs shard 1 only, to give a
macOS/Linux ratio. Shard counts keep each job under the 6 h runner limit, from
the fallow mutant counts and the Stryker spike (qualbar#17: about 41 h for the
quality-ts repo at concurrency 1).
quality-ts refuses date-fns (TypeScript 7, Vitest 5); fallow mutation is
Vitest-only, so it skips ts-pattern (Jest), and fallow 3.35.0 cannot load
zod's Vitest workspace (file-based projects, also from packages/zod).

Usage: mutation-plan.py [smoke]
"""

import json
import sys

SHARDS = {
    "quality-ts": {"quality-ts": 8, "zustand": 1, "ts-pattern": 1, "zod": 24},
    "fallow": {"quality-ts": 8, "zustand": 1, "date-fns": 16},
}


def main():
    smoke = sys.argv[1:] == ["smoke"]
    include = []
    for tool, repos in SHARDS.items():
        for repo, shards in repos.items():
            if smoke and repo != "zustand":
                continue
            for shard in range(1, shards + 1):
                include.append({"os": "ubuntu-24.04", "tool": tool, "repo": repo, "shard": shard, "shards": shards})
            include.append({"os": "macos-15", "tool": tool, "repo": repo, "shard": 1, "shards": shards})
    print(json.dumps({"include": include}))


if __name__ == "__main__":
    main()
