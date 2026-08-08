import unittest

from observer.ocr.evaluate import compare_rows


class OcrEvaluationTests(unittest.TestCase):
    def test_reports_row_recall_and_accuracy_per_field(self) -> None:
        expected = [
            {"rank": 1, "name": "Alpha", "damage": 1200},
            {"rank": 2, "name": "Beta", "damage": 900},
        ]
        actual = [
            {"rank": 1, "name": "alpha", "damage": 1200},
            {"rank": 3, "name": "Gamma", "damage": 500},
        ]

        report = compare_rows(expected, actual, identity_field="rank", fields=("name", "damage"))

        self.assertEqual(report["rowRecall"], 0.5)
        self.assertEqual(report["missingIdentities"], ["2"])
        self.assertEqual(report["unexpectedIdentities"], ["3"])
        self.assertEqual(report["fields"]["name"]["accuracy"], 1.0)


if __name__ == "__main__":
    unittest.main()
