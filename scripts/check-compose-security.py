#!/usr/bin/env python3
"""Validate rendered shipped/test Compose resource and isolation contracts."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def validate(config):
    failures = []
    for name, service in config["services"].items():
        for limit in ("cpus", "mem_limit", "pids_limit"):
            if float(service.get(limit, 0)) <= 0:
                failures.append(f"{name}: missing positive {limit}")
        if "no-new-privileges:true" not in service.get("security_opt", []):
            failures.append(f"{name}: no-new-privileges is required")
        if service.get("privileged") or service.get("network_mode") == "host":
            failures.append(f"{name}: privileged/host networking is forbidden")
        if name in {"app", "ui"} and "ALL" not in service.get("cap_drop", []):
            failures.append(f"{name}: application capabilities must be dropped")
        for port in service.get("ports", []):
            if port.get("host_ip") != "127.0.0.1":
                failures.append(f"{name}: example ports must bind to loopback")
        if name == "postgres":
            if service.get("ports"):
                failures.append("postgres: must not publish a host port")
            for network in service.get("networks", {}):
                if not config["networks"][network].get("internal"):
                    failures.append("postgres: backend network must be internal")
    return failures


def main():
    failures = []
    for compose, example in (
        ("web/compose.yml", "web/.env.prod.example"),
        ("ocr/compose.yml", "ocr/.env.example"),
        ("web/compose.test.yml", None),
    ):
        command = ["docker", "compose"]
        if example:
            command += ["--env-file", example]
        command += ["-f", compose, "--profile", "*", "config", "--format", "json"]
        config = json.loads(subprocess.check_output(command, cwd=ROOT))
        failures.extend(f"{compose}: {error}" for error in validate(config))
    if failures:
        raise SystemExit("\n".join(failures))
    print("Compose security check passed: limits, privileges, ports and database isolation.")


if __name__ == "__main__":
    main()
