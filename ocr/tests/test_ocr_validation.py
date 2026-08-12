import unittest

from archero_guild.ocr.validation import OcrDecision, OcrResult, clean_integer, decide_ocr_result, validate_user_id


class OcrValidationTests(unittest.TestCase):
    def test_validate_user_id_keeps_digits_only_when_valid(self) -> None:
        self.assertEqual(validate_user_id("ID 123456789"), "123456789")

    def test_validate_user_id_rejects_short_value(self) -> None:
        with self.assertRaises(ValueError):
            validate_user_id("123")

    def test_clean_integer(self) -> None:
        self.assertEqual(clean_integer("481,000,000"), 481000000)

    def test_decision_thresholds(self) -> None:
        self.assertEqual(
            decide_ocr_result(
                OcrResult("123", 96),
                min_auto_confidence=95,
                min_history_confidence=80,
            ),
            OcrDecision.ACCEPTED,
        )
        self.assertEqual(
            decide_ocr_result(
                OcrResult("123", 85),
                min_auto_confidence=95,
                min_history_confidence=80,
            ),
            OcrDecision.COMPARE_WITH_HISTORY,
        )
        self.assertEqual(
            decide_ocr_result(
                OcrResult("123", 50),
                min_auto_confidence=95,
                min_history_confidence=80,
            ),
            OcrDecision.REVIEW_REQUIRED,
        )


if __name__ == "__main__":
    unittest.main()

