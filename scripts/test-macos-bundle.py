from pathlib import Path
import tempfile
import unittest
from macos_bundle import BundleError, nested_code, seal_children

class BundleChecks(unittest.TestCase):
    def test_external_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='tech-resume-bundle-') as directory:
            root = Path(directory); app = root / 'App.app'; app.mkdir()
            (root / 'outside').write_text('outside')
            try:
                (app / 'link').symlink_to(root / 'outside')
            except OSError:
                self.skipTest('Host does not permit symlink creation.')
            with self.assertRaisesRegex(BundleError, 'outside its bundle'):
                nested_code(app)

    def test_missing_native_files_cannot_produce_an_app(self):
        with tempfile.TemporaryDirectory(prefix='tech-resume-bundle-') as directory:
            app = Path(directory) / 'App.app'; app.mkdir()
            (app / 'readme.txt').write_text('not an executable')
            with self.assertRaisesRegex(BundleError, 'no native executables'):
                seal_children(app, Path('entitlements.plist'))

if __name__ == '__main__':
    unittest.main()
