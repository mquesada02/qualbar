"""Turn downloaded results.jsonl artifacts into Markdown tables.

Static, changed and CRAP rows: median wall time over the runs (min-max), and
peak memory = the largest of peak_tree_rss_mb and peak_single_rss_mb over the
runs. Mutation rows: the sum of shard wall times (runner time), the slowest
shard (wall time with one job per shard), and the count of timed-out shards.

Usage: summarize.py ARTIFACT_DIR > tables.md
"""

import collections
import glob
import json
import statistics
import sys

OS_NAMES = {"Linux": "Linux x64 (ubuntu-24.04)", "Darwin": "macOS arm64 (macos-15)"}


def load(directory):
    rows = []
    for path in sorted(glob.glob(f"{directory}/*/results.jsonl")):
        with open(path) as file:
            rows += [json.loads(line) for line in file if line.strip()]
    return rows


def memory(row):
    return max(row["peak_tree_rss_mb"], row["peak_single_rss_mb"])


def codes(rows):
    return ",".join(sorted({str(row["exit_code"]) for row in rows}))


def static_table(rows):
    groups = collections.defaultdict(list)
    for row in rows:
        groups[(row["repo"], row["tool"], row["mode"], row["category"])].append(row)
    lines = ["| Repo | Tool | Mode | Category | Wall s, median (min-max) | Peak MB | Exit |", "|---|---|---|---|---|---|---|"]
    for (repo, tool, mode, category), group in sorted(groups.items()):
        walls = [row["wall_s"] for row in group]
        lines.append(
            f"| {repo} | {tool} | {mode} | {category} | {statistics.median(walls):.2f} "
            f"({min(walls):.2f}-{max(walls):.2f}) | {max(map(memory, group)):.0f} | {codes(group)} |"
        )
    return lines


def mutation_table(rows):
    groups = collections.defaultdict(list)
    for row in rows:
        groups[(row["repo"], row["tool"])].append(row)
    lines = ["| Repo | Tool | Shards run | Sum h | Slowest shard h | Timeouts | Peak MB | Exit |", "|---|---|---|---|---|---|---|---|"]
    for (repo, tool), group in sorted(groups.items()):
        walls = [row["wall_s"] / 3600 for row in group]
        timeouts = sum(row["exit_code"] == "timeout" for row in group)
        total = group[0]["category"].rsplit("-", 1)[1]
        lines.append(
            f"| {repo} | {tool} | {len(group)} of {total} | {sum(walls):.2f} | {max(walls):.2f} | {timeouts} "
            f"| {max(map(memory, group)):.0f} | {codes(group)} |"
        )
    return lines


def main():
    rows = load(sys.argv[1])
    for os_name in sorted({row["os"] for row in rows}):
        here = [row for row in rows if row["os"] == os_name]
        static = [row for row in here if row["mode"] != "mutation"]
        mutation = [row for row in here if row["mode"] == "mutation"]
        print(f"### {OS_NAMES.get(os_name, os_name)}\n")
        if static:
            print("\n".join(static_table(static)) + "\n")
        if mutation:
            print("Mutation:\n")
            print("\n".join(mutation_table(mutation)) + "\n")


if __name__ == "__main__":
    main()
