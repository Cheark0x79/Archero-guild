import unittest
from unittest.mock import patch

from observer.ocr.publish import PublishError, _validated_target, publish_batch


class OcrPublishTests(unittest.TestCase):
    def test_requires_https_for_remote_targets(self) -> None:
        with self.assertRaises(PublishError):
            _validated_target("http://example.com")
        self.assertEqual(_validated_target("http://127.0.0.1:5181"), "http://127.0.0.1:5181")

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

    def test_stops_when_validation_refuses_batch(self) -> None:
        with patch(
            "observer.ocr.publish._post_json",
            return_value={"data": {"publishable": False}},
        ):
            with self.assertRaises(PublishError):
                publish_batch({}, target="https://guild.example", token="secret")


if __name__ == "__main__":
    unittest.main()
