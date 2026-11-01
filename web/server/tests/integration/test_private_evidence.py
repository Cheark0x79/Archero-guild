import base64
import os
import unittest
import uuid
from archero_guild.storage.private_evidence import execute

DSN = os.environ.get('ARCHERO_INTEGRATION_DATABASE_URL')
PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'


@unittest.skipUnless(DSN, 'ARCHERO_INTEGRATION_DATABASE_URL is required')
class PrivateEvidenceContractTests(unittest.TestCase):
    def test_private_lifecycle_and_missing_targets(self):
        import psycopg
        # Independent synthetic schema avoids touching the suite's dashboard fixtures.
        name = 'evidence_test_' + uuid.uuid4().hex
        with psycopg.connect(DSN, autocommit=True) as db:
            db.execute(f'CREATE SCHEMA {name}')
        from psycopg.conninfo import make_conninfo
        dsn = make_conninfo(DSN, options=f'-c search_path={name}')
        try:
            with psycopg.connect(dsn) as db:
                db.execute('CREATE TABLE remote_import_batches (id BIGINT PRIMARY KEY)')
                db.execute('INSERT INTO remote_import_batches VALUES (1)')
            missing = execute(dsn, 'upload', {'target': {'kind': 'correction', 'id': '1'}, 'image': PNG})
            self.assertEqual(missing['status'], 409)
            for kind in ['import', 'correction']:
                if kind == 'correction':
                    with psycopg.connect(dsn) as db:
                        db.execute('CREATE TABLE guild_stat_snapshot_edits (id BIGINT PRIMARY KEY)')
                        db.execute('INSERT INTO guild_stat_snapshot_edits VALUES (1)')
                payload = {'target': {'kind': kind, 'id': '1'}, 'image': PNG}
                created = execute(dsn, 'upload', payload)
                self.assertEqual(created['status'], 201)
                identifier = created['evidence']['id']
                listing = execute(dsn, 'list', payload)
                self.assertNotIn('image', listing['evidence'][0])
                downloaded = execute(dsn, 'download', {'id': identifier})
                self.assertEqual(base64.b64decode(downloaded['image']), base64.b64decode(PNG))
                with self.assertRaises(ValueError):
                    execute(dsn, 'delete', {'id': identifier})
                self.assertEqual(execute(dsn, 'delete', {'id': identifier, 'reason': 'Synthetic privacy test'})['status'], 200)
                self.assertEqual(execute(dsn, 'download', {'id': identifier})['status'], 410)
                self.assertEqual(execute(dsn, 'list', payload)['evidence'][0]['status'], 'deleted')
                audit = execute(dsn, 'audit', {'id': identifier})['events']
                self.assertIn('upload', [e['action'] for e in audit])
                self.assertIn('download', [e['action'] for e in audit])
                self.assertEqual([e['reason'] for e in audit if e['action'] == 'delete'], ['Synthetic privacy test'])
            self.assertEqual(execute(dsn, 'download', {'id': str(uuid.uuid4())})['status'], 404)
        finally:
            with psycopg.connect(DSN, autocommit=True) as db:
                db.execute(f'DROP SCHEMA {name} CASCADE')

    def test_retained_history_paginates_and_active_limit_survives_deletions(self):
        import psycopg
        from psycopg.conninfo import make_conninfo
        name = 'evidence_pages_' + uuid.uuid4().hex
        with psycopg.connect(DSN, autocommit=True) as db:
            db.execute(f'CREATE SCHEMA {name}')
        dsn = make_conninfo(DSN, options=f'-c search_path={name}')
        try:
            with psycopg.connect(dsn) as db:
                db.execute('CREATE TABLE remote_import_batches (id BIGINT PRIMARY KEY)')
                db.execute('INSERT INTO remote_import_batches VALUES (1)')
            payload = {'target': {'kind': 'import', 'id': '1'}, 'image': PNG}
            retired = []
            for _ in range(100):
                created = execute(dsn, 'upload', payload)
                self.assertEqual(created['status'], 201)
                identifier = created['evidence']['id']
                retired.append(identifier)
                execute(dsn, 'delete', {'id': identifier, 'reason': 'Synthetic retention cycle'})
            created = execute(dsn, 'upload', payload)
            self.assertEqual(created['status'], 201)
            active_id = created['evidence']['id']
            page = execute(dsn, 'list', payload)
            self.assertEqual(len(page['evidence']), 100)
            self.assertTrue(page['nextCursor'])
            self.assertEqual({row['id'] for row in page['evidence']}, set(retired))
            intervening = execute(dsn, 'upload', payload)['evidence']['id']
            execute(dsn, 'delete', {'id': intervening, 'reason': 'Delete between page requests'})
            final = execute(dsn, 'list', {**payload, 'cursor': page['nextCursor']})
            self.assertEqual([row['id'] for row in final['evidence']], [active_id, intervening])
            self.assertEqual(final['evidence'][-1]['status'], 'deleted')
            self.assertIsNone(final['nextCursor'])
            self.assertEqual(execute(dsn, 'download', {'id': active_id})['image'], PNG)
            # Every returned tombstone is still auditable, including list access.
            self.assertIn('list', [event['action'] for event in execute(dsn, 'audit', {'id': retired[-1]})['events']])
            # Audit history itself must be bounded and traversable; pagination's
            # own audit-read entries must not move its captured upper boundary.
            for _ in range(105):
                self.assertEqual(execute(dsn, 'download', {'id': active_id})['status'], 200)
            audit = execute(dsn, 'audit', {'id': active_id})
            self.assertEqual(len(audit['events']), 100)
            self.assertTrue(audit['nextCursor'])
            events = audit['events']
            # Access after page one is outside that audit traversal's boundary.
            execute(dsn, 'download', {'id': active_id})
            while audit['nextCursor']:
                audit = execute(dsn, 'audit', {'id': active_id, 'cursor': audit['nextCursor']})
                self.assertLessEqual(len(audit['events']), 100)
                events += audit['events']
            self.assertEqual(len([e for e in events if e['action'] == 'download']), 106)
            self.assertEqual(len([e for e in events if e['action'] == 'audit-read']), 1)
            self.assertEqual(len({e['id'] for e in events}), len(events))
            # Tombstones do not count toward the active cap, and the cap still
            # rejects the 101st active upload until one is explicitly deleted.
            for _ in range(99):
                self.assertEqual(execute(dsn, 'upload', payload)['status'], 201)
            self.assertEqual(execute(dsn, 'upload', payload)['status'], 409)
            execute(dsn, 'delete', {'id': active_id, 'reason': 'Synthetic cap release'})
            self.assertEqual(execute(dsn, 'download', {'id': active_id})['status'], 410)
            self.assertEqual(execute(dsn, 'upload', payload)['status'], 201)
            with self.assertRaises(ValueError):
                execute(dsn, 'list', {**payload, 'cursor': '../unsafe'})
            with self.assertRaises(ValueError):
                execute(dsn, 'list', {**payload, 'cursor': str(uuid.uuid4())})
            for invalid in ['invalid', '0:1', '2:1', '1:9223372036854775808']:
                with self.assertRaises(ValueError):
                    execute(dsn, 'audit', {'id': active_id, 'cursor': invalid})
            with self.assertRaises(ValueError):
                execute(dsn, 'list', {'target': {'kind': 'import', 'id': '2'}, 'cursor': page['nextCursor']})
        finally:
            with psycopg.connect(DSN, autocommit=True) as db:
                db.execute(f'DROP SCHEMA {name} CASCADE')
