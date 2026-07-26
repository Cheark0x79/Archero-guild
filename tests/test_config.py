import unittest
from pathlib import Path

from observer.config import ObserverConfig


class ConfigTests(unittest.TestCase):
    def test_loads_valid_config(self) -> None:
        config = ObserverConfig.from_mapping(
            {
                "run_id_prefix": "archero",
                "dry_run": True,
                "adb": {
                    "serial": None,
                    "screenshot_dir": "screenshots/raw",
                    "tap_timeout_seconds": 3,
                },
                "screens": {
                    "home": {
                        "template": "templates/home.png",
                        "threshold": 0.85,
                    }
                },
                "regions": {
                    "ranking_rows": {
                        "x": 100,
                        "y": 350,
                        "width": 900,
                        "height": 1300,
                    }
                },
                "ocr": {
                    "min_auto_confidence": 95,
                    "min_history_confidence": 80,
                },
            }
        )

        self.assertTrue(config.dry_run)
        self.assertEqual(config.adb.normalized_screenshot_dir, Path("screenshots/normalized"))
        self.assertEqual(config.regions["ranking_rows"].width, 900)

    def test_rejects_invalid_confidence_order(self) -> None:
        with self.assertRaises(ValueError):
            ObserverConfig.from_mapping(
                {
                    "run_id_prefix": "archero",
                    "dry_run": True,
                    "adb": {
                        "serial": None,
                        "screenshot_dir": "screenshots/raw",
                        "tap_timeout_seconds": 3,
                    },
                    "screens": {},
                    "regions": {},
                    "ocr": {
                        "min_auto_confidence": 70,
                        "min_history_confidence": 80,
                    },
                }
            )

    def test_rejects_boolean_integer_fields(self) -> None:
        with self.assertRaises(ValueError):
            ObserverConfig.from_mapping(
                {
                    "run_id_prefix": "archero",
                    "dry_run": True,
                    "adb": {
                        "serial": None,
                        "screenshot_dir": "screenshots/raw",
                        "tap_timeout_seconds": True,
                    },
                    "screens": {},
                    "regions": {},
                    "ocr": {
                        "min_auto_confidence": 95,
                        "min_history_confidence": 80,
                    },
                }
            )


if __name__ == "__main__":
    unittest.main()
