import hashlib
import json
from pathlib import Path
import plistlib
import stat
import tempfile
import unittest
import zipfile
from release_proofs import sha, verify_upgrade, verify_macos_app

class ReleaseProofChecks(unittest.TestCase):
    def upgrade(self):
        baseline = json.loads(Path(__file__).with_name('upgrade-baseline.json').read_text())
        report = {'schemaVersion': 1, 'from': baseline['version'], 'to': '0.9.0', 'baselineArchiveSha256': baseline['sha256'], 'candidateArchiveSha256': 'a' * 64,
                  'checkedFiles': 55, 'untouchedFilesAfterEditing': 42, 'resumeCount': 3, 'trashCount': 1, 'pdfPages': [1, 2, 2]}
        for field in ['publishedOldPackage', 'sameDataDirectory', 'originalFilesVerified', 'oldVersionCanReopen', 'recycleBinSurvivesRollback',
                      'multipleResumes', 'selectedResumePreserved', 'imagesAndHistoryPreserved', 'existingLibrarySkipsWelcome',
                      'formChangesPreserved', 'singleBackupRestored', 'wholeLibraryRestored', 'offlinePdfViewer', 'restartPersistence']:
            report[field] = True
        return report

    def test_upgrade_uses_actual_counts_instead_of_an_old_fixture_size(self):
        report = self.upgrade()
        self.assertEqual(verify_upgrade(report, '0.9.0', 'a' * 64)['checkedFiles'], 55)
        report['checkedFiles'] = 72
        self.assertEqual(verify_upgrade(report, '0.9.0', 'a' * 64)['checkedFiles'], 72)

    def test_upgrade_rejects_wrong_archives_missing_checks_and_incomplete_pdfs(self):
        for field, value in [('from', '0.7.0'), ('to', '0.8.0'), ('baselineArchiveSha256', 'b' * 64), ('candidateArchiveSha256', 'b' * 64),
                             ('checkedFiles', 0), ('checkedFiles', True), ('resumeCount', 1), ('formChangesPreserved', False), ('wholeLibraryRestored', None), ('pdfPages', [1])]:
            with self.subTest(field=field, value=value):
                report = self.upgrade(); report[field] = value
                with self.assertRaises(ValueError):
                    verify_upgrade(report, '0.9.0', 'a' * 64)

    def bundle(self, folder, arch='x64', change=None, smoke_change=None):
        version = '0.9.0'; name = f'tech-resume-macos-app-{arch}-{version}'
        prefix = 'TechResumeKit.app/'; resources = prefix + 'Contents/Resources/'
        browser = f'runtime/browsers/chromium_headless_shell-1243/chrome-headless-shell-mac-{arch}/chrome-headless-shell'
        digest = lambda value: hashlib.sha256(value).hexdigest()
        manifest = {'kit': version, 'platform': 'darwin', 'arch': arch, 'node': '24.18.0', 'playwright': '1.63.0', 'chromiumHeadlessRevision': '1243',
                    'chromiumExecutable': browser.removeprefix('runtime/'), 'nodeBinarySha256': digest(b'node'), 'chromiumBinarySha256': digest(b'browser')}
        files = {prefix + 'Contents/Info.plist': (plistlib.dumps({'CFBundleExecutable': 'TechResumeLauncher', 'CFBundleShortVersionString': version}), 0o644),
                 prefix + 'Contents/MacOS/TechResumeLauncher': (b'launcher', 0o755), resources + 'toolkit/package.json': (json.dumps({'version': version}).encode(), 0o644),
                 resources + 'runtime/versions.json': (json.dumps(manifest).encode(), 0o644), resources + 'runtime/bin/node': (b'node', 0o755), resources + browser: (b'browser', 0o755)}
        if change:
            change(files, resources)
        archive = folder / (name + '.zip')
        with zipfile.ZipFile(archive, 'w') as bundle:
            for path, (content, mode) in files.items():
                info = zipfile.ZipInfo(path); info.create_system = 3; info.external_attr = (stat.S_IFREG | mode) << 16
                bundle.writestr(info, content)
        build = {'version': version, 'arch': arch, 'archive': archive.name, 'bundleIntegrityVerified': True, 'nativeFiles': 3, 'sha256': sha(archive)}
        smoke = {'version': version, 'arch': arch, 'nativeApp': True, 'packageRuntimes': True, 'singleton': True, 'offlinePdf': True, 'restartPersistence': True, 'bundleUnchangedByEditing': True, 'tamperingRejected': True}
        smoke.update(smoke_change or {})
        (folder / (name + '.validation.json')).write_text(json.dumps(build))
        (folder / (name + '.smoke.json')).write_text(json.dumps(smoke))
        return archive

    def test_both_native_mac_downloads_require_build_and_launch_proof(self):
        with tempfile.TemporaryDirectory(prefix='tech-resume-release-proof-') as directory:
            folder = Path(directory)
            for arch in ['x64', 'arm64']:
                self.bundle(folder, arch, change=lambda files, base: files.update({'__MACOSX/': (b'', 0o755), '__MACOSX/._TechResumeKit.app': (b'fork metadata', 0o644)}))
                self.assertEqual(verify_macos_app(folder, '0.9.0', arch)['archive'], f'tech-resume-macos-app-{arch}-0.9.0.zip')

    def test_mac_archive_rejects_changed_runtime_even_with_a_matching_outer_hash(self):
        with tempfile.TemporaryDirectory(prefix='tech-resume-release-proof-') as directory:
            folder = Path(directory)
            self.bundle(folder, change=lambda files, base: files.update({base + 'runtime/bin/node': (b'changed node', 0o755)}))
            with self.assertRaisesRegex(ValueError, 'runtime checksum'):
                verify_macos_app(folder, '0.9.0', 'x64')

    def test_mac_archive_rejects_unsafe_paths_wrong_versions_and_missing_execute_mode(self):
        changes = [lambda files, base: files.update({'TechResumeKit.app/../outside': (b'outside', 0o644)}),
                   lambda files, base: files.update({base + 'toolkit/package.json': (b'{"version":"0.8.0"}', 0o644)}),
                   lambda files, base: files.update({'TechResumeKit.app/Contents/MacOS/TechResumeLauncher': (b'launcher', 0o644)})]
        for index, change in enumerate(changes):
            with self.subTest(index=index), tempfile.TemporaryDirectory(prefix='tech-resume-release-proof-') as directory:
                folder = Path(directory); self.bundle(folder, change=change)
                with self.assertRaises(ValueError):
                    verify_macos_app(folder, '0.9.0', 'x64')

    def test_mac_app_requires_successful_native_launch_and_offline_preview(self):
        with tempfile.TemporaryDirectory(prefix='tech-resume-release-proof-') as directory:
            folder = Path(directory); self.bundle(folder, smoke_change={'offlinePdf': False})
            with self.assertRaisesRegex(ValueError, 'offlinePdf'):
                verify_macos_app(folder, '0.9.0', 'x64')

if __name__ == '__main__':
    unittest.main()
