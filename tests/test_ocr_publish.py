import unittest
import json
from unittest.mock import patch

from observer.ocr.publish import (
    PublishError,
    _validated_target,
    check_target,
    cloudflare_access_headers,
    fetch_import_history,
    publish_batch,
)

class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit: int) -> bytes:
        return self.payload


class OcrPublishTests(unittest.TestCase):
    def test_requires_https_for_remote_targets(self) -> None:
        with self.assertRaises(PublishError):
            _validated_target("http://example.com")
        self.assertEqual(_validated_target("http://127.0.0.1:5181"), "http://127.0.0.1:5181")
        self.assertEqual(_validated_target("http://192.168.1.50:5181"), "http://192.168.1.50:5181")

    def test_rejects_dashboard_paths_in_target_origin(self) -> None:
        with self.assertRaisesRegex(PublishError, "server origin only"):
            _validated_target("http://127.0.0.1:5181/dashboard")
        with self.assertRaisesRegex(PublishError, "server origin only"):
            _validated_target("https://guild.example?environment=preprod")

    def test_validates_before_publishing(self) -> None:
        responses = [
            {"data": {"publishable": True}},
            {"data": {"id": 12, "status": "published", "replayed": False}},
        ]
        with patch("observer.ocr.publish._post_json", side_effect=responses) as post:
            result = publish_batch({}, target="https://guild.example", token="secret")

        self.assertTrue(result["published"])
        self.assertEqual(result["import"]["id"], 12)
        self.assertEqual(post.call_count, 2)
        self.assertEqual(post.call_args_list[0].kwargs["timeout"], 30)
        self.assertEqual(post.call_args_list[1].kwargs["timeout"], 120)

    def test_import_timeout_can_be_longer_than_validation_timeout(self) -> None:
        responses = [
            {"data": {"publishable": True}},
            {"data": {"status": "published", "replayed": False}},
        ]
        with patch("observer.ocr.publish._post_json", side_effect=responses) as post:
            publish_batch(
                {},
                target="https://guild.example",
                token="secret",
                timeout=15,
                import_timeout=180,
            )

        self.assertEqual(post.call_args_list[0].kwargs["timeout"], 15)
        self.assertEqual(post.call_args_list[1].kwargs["timeout"], 180)

    def test_stops_when_validation_refuses_batch(self) -> None:
        with patch(
            "observer.ocr.publish._post_json",
            return_value={"data": {"publishable": False}},
        ):
            with self.assertRaises(PublishError):
                publish_batch({}, target="https://guild.example", token="secret")

    def test_reports_destination_validation_errors(self) -> None:
        with patch(
            "observer.ocr.publish._post_json",
            return_value={"data": {"publishable": False, "errors": ["boss rank 4 is missing"]}},
        ):
            with self.assertRaisesRegex(PublishError, "boss rank 4 is missing"):
                publish_batch({}, target="https://guild.example", token="secret")

    def test_explains_a_destination_contract_version_mismatch(self) -> None:
        with patch(
            "observer.ocr.publish._post_json",
            return_value={"data": {"publishable": False, "errors": []}},
        ):
            with self.assertRaisesRegex(PublishError, "combined Members \\+ Boss import update"):
                publish_batch({}, target="https://guild.example", token="secret")

    def test_adds_cloudflare_service_token_headers(self) -> None:
        with patch(
            "observer.ocr.publish._post_json",
            return_value={"data": {"publishable": True}},
        ) as post:
            publish_batch(
                {},
                target="https://guild.example",
                token="secret",
                validate_only=True,
                access_client_id="client-id",
                access_client_secret="client-secret",
            )

        self.assertEqual(
            post.call_args.kwargs["extra_headers"],
            {
                "CF-Access-Client-Id": "client-id",
                "CF-Access-Client-Secret": "client-secret",
            },
        )

    def test_requires_both_cloudflare_service_token_values(self) -> None:
        with self.assertRaises(PublishError):
            cloudflare_access_headers("client-id", None)

    def test_target_check_requires_a_working_database_source(self) -> None:
        response = FakeResponse({
            "data": [{"playerId": "1", "name": "Player"}],
            "meta": {"source": "database"},
        })
        with patch("observer.ocr.publish.urllib.request.urlopen", return_value=response):
            result = check_target("http://127.0.0.1:5182", "secret")

        self.assertTrue(result["database"])
        self.assertEqual(result["rosterCount"], 1)

    def test_target_check_rejects_local_fallback_data(self) -> None:
        response = FakeResponse({
            "data": [{"playerId": "1", "name": "Player"}],
            "meta": {"source": "local"},
        })
        with patch("observer.ocr.publish.urllib.request.urlopen", return_value=response):
            with self.assertRaisesRegex(PublishError, "PostgreSQL database is unavailable"):
                check_target("http://127.0.0.1:5182", "secret")

    def test_reads_sanitized_import_history(self) -> None:
        response = FakeResponse({"data": [{"id": 12, "captureDate": "2026-08-07"}]})
        with patch("observer.ocr.publish.urllib.request.urlopen", return_value=response) as open_url:
            history = fetch_import_history("http://127.0.0.1:5182", "secret", limit=5)

        self.assertEqual(history[0]["id"], 12)
        self.assertIn("/api/v1/imports/history?limit=5", open_url.call_args.args[0].full_url)


if __name__ == "__main__":
    unittest.main()
