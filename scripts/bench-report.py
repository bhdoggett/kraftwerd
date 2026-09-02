"""Summarise a `convex logs --jsonl` stream for one bench-bot.sh run.

Reads the THINK lines the bot logs before its pause, plus the platform's own
executionTime per function, and prints mean/p95/worst for each.
"""

import collections
import json
import sys

path, since = sys.argv[1], float(sys.argv[2])

think: list[int] = []
rows: dict[str, list[float]] = collections.defaultdict(list)
overruns = errors = 0

for line in open(path):
    line = line.strip()
    if not line:
        continue
    try:
        record = json.loads(line)
    except ValueError:
        continue
    stamp = max(record.get("executionTimestamp") or 0, record.get("timestamp") or 0)
    if stamp < since:
        continue

    if record.get("kind") == "Progress":
        for entry in record.get("logLines") or []:
            for message in entry.get("messages") or []:
                if message.startswith("'THINK "):
                    think.append(int(message.split()[1].rstrip("'")))
                elif "past the" in message:
                    overruns += 1
        continue

    if record.get("kind") != "Completion":
        continue
    if record.get("error"):
        errors += 1
    rows[record["identifier"]].append((record.get("executionTime") or 0) * 1000)


def pct(values: list[float], p: int) -> float:
    values = sorted(values)
    if not values:
        return 0
    return values[max(0, min(len(values) - 1, round(p / 100 * (len(values) - 1))))]


if think:
    print(
        f"THINK  n={len(think):<4} mean={sum(think) / len(think):6.0f}ms"
        f"  p50={pct(think, 50):5.0f}  p95={pct(think, 95):5.0f}"
        f"  worst={max(think):5.0f}  over1600={overruns}"
    )
else:
    print("THINK  (no THINK lines -- the instrumentation in bots.ts is commented out)")

for name in sorted(rows):
    v = rows[name]
    print(
        f"{name:22} n={len(v):<4} mean={sum(v) / len(v):6.0f}ms"
        f"  p95={pct(v, 95):6.0f}  worst={max(v):6.0f}"
    )
print("errors:", errors)
