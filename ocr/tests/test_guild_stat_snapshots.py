import unittest

from archero_guild.storage.guild_stats import normalize_snapshot_edit


class GuildStatSnapshotTests(unittest.TestCase):
    def test_normalizes_an_expedition_snapshot_edit(self):
        self.assertEqual(normalize_snapshot_edit({
            "date": "2026-08-19", "reason": "Verified from original capture",
            "level": 7, "memberCount": 41, "memberCapacity": 42, "totalPower": 89760000,
            "xpCurrent": 13700, "xpRequired": 800000, "expeditionPoints": 825, "expeditionName": "Firebound Soul", "expeditionRank": "ii",
        }), {
            "date": "2026-08-19", "reason": "Verified from original capture",
            "level": 7, "memberCount": 41, "memberCapacity": 42, "totalPower": 89760000,
            "xpCurrent": 13700, "xpRequired": 800000, "expeditionPoints": 825, "expeditionName": "Firebound Soul", "expeditionRank": "II",
        })

    def test_rejects_an_unsafe_or_ambiguous_edit(self):
        with self.assertRaisesRegex(ValueError, "memberCount"):
            normalize_snapshot_edit({"date": "2026-08-19", "level": 7, "memberCount": 43, "memberCapacity": 42, "totalPower": 89760000, "xpCurrent": 13700, "xpRequired": 800000, "expeditionPoints": 825, "expeditionName": "Firebound Soul", "expeditionRank": "II"})
        with self.assertRaisesRegex(ValueError, "date"):
            normalize_snapshot_edit({"date": "2026-02-30", "reason": "x", "level": 7, "memberCount": 41, "memberCapacity": 42, "totalPower": 89760000, "xpCurrent": 13700, "xpRequired": 800000, "expeditionPoints": 825, "expeditionName": "Firebound Soul", "expeditionRank": "II"})

    def test_adds_the_default_audit_reason_when_the_editor_omits_it(self):
        edit = normalize_snapshot_edit({
            "date": "2026-08-19", "level": 7, "memberCount": 41, "memberCapacity": 42,
            "totalPower": 89760000, "xpCurrent": 13700, "xpRequired": 800000,
            "expeditionPoints": 825, "expeditionName": "Firebound Soul", "expeditionRank": "II",
        })
        self.assertEqual(edit["reason"], "Manual daily editor correction")
