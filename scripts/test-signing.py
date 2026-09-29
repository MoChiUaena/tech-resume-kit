import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from macos_signing import SigningError, required_environment, nested_code

class SigningChecks(unittest.TestCase):
    def test_missing_credentials_fail_before_any_command(self):
        with patch.dict(os.environ, {}, clear=True), patch('macos_signing.subprocess.run') as command:
            with self.assertRaisesRegex(SigningError, 'Missing signing configuration'):
                required_environment()
            command.assert_not_called()

    def test_external_symlink_cannot_be_signed(self):
        with tempfile.TemporaryDirectory(prefix='tech-resume-signing-') as directory:
            root = Path(directory); app = root / 'App.app'; app.mkdir()
            (root / 'outside').write_text('outside')
            try:
                (app / 'link').symlink_to(root / 'outside')
            except OSError:
                self.skipTest('Host does not permit symlink creation.')
            with self.assertRaisesRegex(SigningError, 'outside its bundle'):
                nested_code(app)

    def test_failure_does_not_disclose_tool_arguments(self):
        from macos_signing import run
        with patch('macos_signing.subprocess.run') as command:
            command.return_value.returncode = 1
            with self.assertRaises(SigningError) as caught:
                run(['security', '-p', 'private-password'], 'Import')
            self.assertNotIn('private-password', str(caught.exception))

    def test_rejected_notarization_does_not_staple_or_assess(self):
        from macos_signing import notarize
        with patch.dict(os.environ, {'APPLE_API_KEY_PATH': 'key.p8', 'APPLE_API_KEY_ID': 'key', 'APPLE_API_ISSUER_ID': 'issuer'}):
            with patch('macos_signing.run', side_effect=['', '{"status":"Invalid","id":"request"}']) as command:
                with self.assertRaisesRegex(SigningError, 'did not accept'):
                    notarize(Path('App.app'), Path('staging'))
                self.assertEqual(command.call_count, 2)

    def test_failed_certificate_import_cleans_up_only_its_temporary_keychain(self):
        from macos_signing import identity
        with tempfile.TemporaryDirectory(prefix='tech-resume-signing-') as directory:
            with patch('macos_signing.required_environment'), patch.dict(os.environ, {'TECH_RESUME_MAC_CERT_PATH': 'certificate.p12', 'TECH_RESUME_MAC_CERT_PASSWORD': 'private-password'}):
                with patch('macos_signing.run', side_effect=['', '', '', SigningError('Import failed'), '']) as command:
                    with self.assertRaisesRegex(SigningError, 'Import failed'):
                        with identity('notarized', directory):
                            self.fail('A failed import yielded a usable identity.')
                    final = command.call_args.args[0]
                    self.assertEqual(final[:2], ['/usr/bin/security', 'delete-keychain'])
                    self.assertTrue(Path(final[2]).is_relative_to(Path(directory)))

if __name__ == '__main__':
    unittest.main()
