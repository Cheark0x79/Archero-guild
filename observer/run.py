from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from observer.automation.state_machine import DryRunVerifier, Workflow
from observer.config import load_config


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Archero observer pipeline")
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    config = load_config(args.config)
    run_id = f"{config.run_id_prefix}-{datetime.now(ZoneInfo('Europe/Paris')).strftime('%Y%m%d-%H%M%S')}"

    if not config.dry_run:
        raise SystemExit("non-dry-run automation is not wired yet; configure the ADB/Appium worker first")

    workflow = Workflow(DryRunVerifier())
    states = [state.value for state in workflow.run()]
    result = {
        "run_id": run_id,
        "status": "dry_run_success",
        "states": states,
        "ocr_review_required": 0,
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

