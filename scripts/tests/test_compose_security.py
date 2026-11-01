import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "compose_security", Path(__file__).resolve().parents[1] / "check-compose-security.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ComposeSecurityTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "services": {"postgres": {
                "cpus": 1, "mem_limit": 512000000, "pids_limit": 128,
                "security_opt": ["no-new-privileges:true"],
                "networks": {"backend": None},
            }},
            "networks": {"backend": {"internal": True}},
        }

    def test_bounded_private_database_passes(self):
        self.assertEqual(module.validate(self.config), [])

    def test_missing_limits_and_escalation_fail(self):
        for field in ("cpus", "mem_limit", "pids_limit", "security_opt"):
            with self.subTest(field=field):
                config = copy.deepcopy(self.config)
                del config["services"]["postgres"][field]
                self.assertTrue(module.validate(config))
        for field, value in (("privileged", True), ("network_mode", "host")):
            with self.subTest(field=field):
                config = copy.deepcopy(self.config)
                config["services"]["postgres"][field] = value
                self.assertTrue(module.validate(config))

    def test_database_exposure_fails(self):
        self.config["services"]["postgres"]["ports"] = [{"host_ip": "0.0.0.0"}]
        self.config["networks"]["backend"]["internal"] = False
        self.assertEqual(len(module.validate(self.config)), 3)

    def test_application_requires_capability_drop_and_loopback(self):
        service = self.config["services"].pop("postgres")
        self.config["services"]["app"] = service
        service["ports"] = [{"host_ip": "0.0.0.0"}]
        self.assertEqual(len(module.validate(self.config)), 2)
        service["cap_drop"] = ["ALL"]
        service["ports"] = [{"host_ip": "127.0.0.1"}]
        self.assertEqual(module.validate(self.config), [])
