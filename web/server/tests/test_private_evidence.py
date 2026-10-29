import base64
import unittest
from archero_guild.storage.private_evidence import image_bytes, target, MAX_BYTES

# Synthetic single-pixel PNG, never a real screenshot.
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC')


class EvidenceValidationTests(unittest.TestCase):
    def test_png_and_target_contract(self):
        self.assertEqual(image_bytes(base64.b64encode(PNG).decode()), (PNG, 'image/png'))
        self.assertEqual(target({'kind': 'import', 'id': '123'}), ('import', 123))
        self.assertEqual(target({'kind': 'correction', 'id': '5'}), ('correction', 5))

    def test_rejects_unsafe_identifiers_and_image_types(self):
        for value in [None, {}, {'kind': '../public', 'id': '1'}, {'kind': 'import', 'id': '../1'}, {'kind': 'import', 'id': 0}]:
            with self.assertRaises(ValueError):
                target(value)
        for value in ['', '<svg/>', base64.b64encode(b'<script>alert(1)</script>').decode(), base64.b64encode(PNG[:-1]).decode(), base64.b64encode(b'x' * (MAX_BYTES + 1)).decode()]:
            with self.assertRaises(ValueError):
                image_bytes(value)
