"""Synthetic captures exercise extraction with the external OCR engine stubbed.

Real trained-data/image recognition is checked separately in local evidence;
these deterministic tests cover matching, fallback and review-row preservation.
"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from archero_guild.pipeline.guild_member_ocr import RosterEntry, extract_member_metrics_from_screenshots
from archero_guild.pipeline.guild_boss import extract_boss_rankings_from_screenshots


class MultilingualExtractionTests(unittest.TestCase):
    def _capture(self, path: Path, *, boss: bool) -> None:
        image = Image.new("RGB", (1080, 1920), "black")
        ImageDraw.Draw(image).rectangle((40, 800, 1039, 939), fill=(130, 40, 70) if boss else (240, 210, 150))
        image.save(path)

    def _extract(self, *, boss: bool, recognized: str, language: str, installed: bool = True, podium: bool = False, roster=None):
        roster = roster if roster is not None else [RosterEntry("synthetic-cn", "測試玩家"), RosterEntry("synthetic-kr", "한글전사"), RosterEntry("synthetic-latin", "NovaPilot")]
        available = ["eng", "chi_tra", "chi_sim", "kor", "rus"] if installed else ["eng"]
        calls = []

        def recognize(image, *, config, lang=None):
            calls.append(lang)
            if "whitelist" in config:
                return ""
            if lang and language in lang.split("+"):
                return recognized
            return "UnrelatedNoise"

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.png"
            self._capture(path, boss=boss)
            with (
                patch("pytesseract.get_languages", return_value=available),
                patch("pytesseract.image_to_string", side_effect=recognize),
            ):
                if boss:
                    result = extract_boss_rankings_from_screenshots([path], roster, include_podium=podium)
                else:
                    result = extract_member_metrics_from_screenshots([path], roster)
        return result, calls

    def test_member_fallback_matches_chinese_and_korean_canonical_identity(self):
        for name, language, player_id in [("測試玩家", "chi_tra", "synthetic-cn"), ("한글전사", "kor", "synthetic-kr")]:
            with self.subTest(language=language):
                rows, calls = self._extract(boss=False, recognized=name, language=language)
                self.assertEqual(len(rows), 1)
                self.assertEqual((rows[0].player_id, rows[0].name, rows[0].raw_name), (player_id, name, name))
                self.assertIn(language, calls)

    def test_member_unknown_unicode_name_remains_reviewable_without_false_match(self):
        for name, language in [("未登錄", "chi_tra"), ("한국이름", "kor")]:
            with self.subTest(language=language):
                rows, _ = self._extract(boss=False, recognized=name, language=language)
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0].player_id, "")
                self.assertIn(name, rows[0].raw_name)
                self.assertEqual(rows[0].match_score, 0.0)

    def test_member_skips_uninstalled_optional_languages(self):
        rows, calls = self._extract(boss=False, recognized="한글전사", language="kor", installed=False)
        self.assertEqual(rows[0].player_id, "")
        self.assertTrue(all(language in (None, "eng") for language in calls))

    def test_boss_list_and_podium_match_chinese_and_korean(self):
        for name, language, player_id in [("測試玩家", "chi_tra", "synthetic-cn"), ("한글전사", "kor", "synthetic-kr")]:
            with self.subTest(language=language):
                rows, calls = self._extract(boss=True, recognized=name, language=language, podium=True)
                self.assertEqual({row.area for row in rows}, {"list", "podium"})
                self.assertTrue(all((row.player_id, row.name) == (player_id, name) for row in rows))
                self.assertIn(language, calls)

    def test_boss_list_and_podium_reject_unknown_unicode_names(self):
        for name, language in [("未登錄", "chi_tra"), ("한국이름", "kor")]:
            with self.subTest(language=language):
                rows, _ = self._extract(boss=True, recognized=name, language=language, podium=True)
                self.assertTrue(rows)
                self.assertTrue(all(row.player_id is None for row in rows))
                self.assertTrue(all(name in (row.raw_name or "") for row in rows))

    def test_boss_skips_uninstalled_optional_languages(self):
        rows, calls = self._extract(boss=True, recognized="한글전사", language="kor", installed=False, podium=True)
        self.assertTrue(rows)
        self.assertTrue(all(row.player_id is None for row in rows))
        self.assertEqual(set(calls), {"eng"})

    def test_boss_multilingual_call_budget_for_exact_and_unknown_names(self):
        for recognized in ("한글전사", "한국이름"):
            with self.subTest(recognized=recognized):
                rows, calls = self._extract(boss=True, recognized=recognized, language="kor", podium=True)
                multilingual_calls = [lang for lang in calls if lang != "eng"]
                # Three podium regions (five crops) plus three list crops,
                # at most the roster's two Chinese packs and Korean pack.
                self.assertLessEqual(len(multilingual_calls), 18 if recognized == "한글전사" else 24)
                self.assertEqual(len(rows), 4)
                self.assertTrue(all(row.player_id == "synthetic-kr" for row in rows) if recognized == "한글전사" else all(row.player_id is None for row in rows))

    def test_boss_latin_roster_does_not_launch_multilingual_fallback(self):
        rows, calls = self._extract(boss=True, recognized="한글전사", language="kor", podium=True, roster=[RosterEntry("synthetic-latin", "NovaPilot")])
        self.assertTrue(all(row.player_id is None for row in rows))
        self.assertEqual(set(calls), {"eng"})
