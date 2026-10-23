"""Run one command once and append its wall time and peak memory as a JSON line.

Peak memory has two numbers:
- peak_tree_rss_mb: the largest sum of RSS over the process and all its
  descendants, sampled every 20 ms (a tool that starts workers uses them all). A run
  shorter than one sample can miss it: then use peak_single_rss_mb.
- peak_single_rss_mb: getrusage(RUSAGE_CHILDREN).ru_maxrss, the exact high-water
  mark of the largest single process that was waited for.

Usage: measure.py --out FILE --log FILE [--timeout SECONDS] --label key=value ... -- COMMAND
COMMAND is one shell string, run with bash -c. At the timeout the whole process
tree is killed and exit_code is "timeout", so a lower bound is still recorded.
"""

import argparse
import json
import platform
import resource
import subprocess
import sys
import threading
import time

import psutil


def tree_rss(proc):
    total = 0
    try:
        procs = [proc] + proc.children(recursive=True)
    except psutil.Error:
        return 0
    for p in procs:
        try:
            total += p.memory_info().rss
        except psutil.Error:
            pass
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--log", required=True)
    parser.add_argument("--timeout", type=float)
    parser.add_argument("--label", action="append", default=[])
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = " ".join(args.command[1:] if args.command[:1] == ["--"] else args.command)

    peak = 0
    done = threading.Event()
    with open(args.log, "ab") as log:
        log.write(f"\n$ {command}\n".encode())
        log.flush()
        start = time.perf_counter()
        child = subprocess.Popen(["bash", "-c", command], stdout=log, stderr=subprocess.STDOUT)
        proc = psutil.Process(child.pid)

        def sample():
            nonlocal peak
            while not done.is_set():
                peak = max(peak, tree_rss(proc))
                done.wait(0.02)

        sampler = threading.Thread(target=sample)
        sampler.start()
        try:
            code = child.wait(timeout=args.timeout)
        except subprocess.TimeoutExpired:
            for p in [proc] + proc.children(recursive=True):
                try:
                    p.kill()
                except psutil.Error:
                    pass
            child.wait()
            code = "timeout"
        wall = time.perf_counter() - start
        done.set()
        sampler.join()

    maxrss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    # Linux reports kilobytes, macOS reports bytes.
    single_mb = maxrss / 1024 if sys.platform.startswith("linux") else maxrss / (1024 * 1024)
    row = dict(label.split("=", 1) for label in args.label)
    row.update(
        {
            "command": command,
            "exit_code": code,
            "wall_s": round(wall, 3),
            "peak_tree_rss_mb": round(peak / (1024 * 1024), 1),
            "peak_single_rss_mb": round(single_mb, 1),
            "os": platform.system(),
            "arch": platform.machine(),
            "cpus": psutil.cpu_count(),
            "mem_total_gb": round(psutil.virtual_memory().total / 1024**3, 1),
        }
    )
    with open(args.out, "a") as out:
        out.write(json.dumps(row) + "\n")
    print(json.dumps(row))


if __name__ == "__main__":
    main()
