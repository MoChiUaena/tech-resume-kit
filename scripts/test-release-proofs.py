import hashlib
import json
from pathlib import Path
import plistlib
import stat
import tempfile
import subprocess
import sys
import unittest
import zipfile
import release_proofs
from release_proofs import sha, verify_upgrade, verify_macos_app, verified_draft_assets

class ReleaseProofChecks(unittest.TestCase):
    def test_draft_resume_skips_identical_assets_and_rejects_unverified_or_unknown_files(self):
        expected = [{'name': 'kit.zip', 'size': 12, 'sha256': 'a' * 64}]
        good = {'name': 'kit.zip', 'size': 12, 'digest': 'sha256:' + 'a' * 64, 'state': 'uploaded'}
        self.assertEqual(verified_draft_assets(expected, []), set())
        self.assertEqual(verified_draft_assets(expected, [good]), {'kit.zip'})
        for field, value in [('name', 'other.zip'), ('size', 11), ('digest', 'sha256:' + 'b' * 64), ('state', 'new')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                verified_draft_assets(expected, [{**good, field: value}])
        with self.assertRaises(ValueError):
            verified_draft_assets(expected, [good, good])

    def upgrade(self):
        baseline = json.loads(Path(__file__).with_name('upgrade-baseline.json').read_text())
        report = {'schemaVersion': 1, 'from': baseline['version'], 'to': '0.10.0', 'baselineArchiveSha256': baseline['sha256'], 'candidateArchiveSha256': 'a' * 64,
                  'checkedFiles': 55, 'untouchedFilesAfterEditing': 42, 'resumeCount': 3, 'trashCount': 1, 'pdfPages': [1, 2, 2]}
        for field in ['publishedOldPackage', 'sameDataDirectory', 'originalFilesVerified', 'oldVersionCanReopen', 'recycleBinSurvivesRollback',
                      'multipleResumes', 'selectedResumePreserved', 'imagesAndHistoryPreserved', 'existingLibrarySkipsWelcome',
                      'formChangesPreserved', 'sectionOrderPersisted', 'sectionTitlePersisted', 'singleBackupRestored', 'wholeLibraryRestored', 'offlinePdfViewer', 'restartPersistence']:
            report[field] = True
        return report

    def test_upgrade_uses_actual_counts_instead_of_an_old_fixture_size(self):
        report = self.upgrade()
        self.assertEqual(verify_upgrade(report, '0.10.0', 'a' * 64)['checkedFiles'], 55)
        report['checkedFiles'] = 72
        self.assertEqual(verify_upgrade(report, '0.10.0', 'a' * 64)['checkedFiles'], 72)

    def test_upgrade_rejects_wrong_archives_missing_checks_and_incomplete_pdfs(self):
        for field, value in [('from', '0.8.0'), ('to', '0.9.0'), ('baselineArchiveSha256', 'b' * 64), ('candidateArchiveSha256', 'b' * 64),
                             ('checkedFiles', 0), ('checkedFiles', True), ('resumeCount', 1), ('formChangesPreserved', False), ('sectionOrderPersisted', False), ('sectionTitlePersisted', False), ('wholeLibraryRestored', None), ('pdfPages', [1])]:
            with self.subTest(field=field, value=value):
                report = self.upgrade(); report[field] = value
                with self.assertRaises(ValueError):
                    verify_upgrade(report, '0.10.0', 'a' * 64)

    def journey(self):
        report = {'schemaVersion': 1, 'version': '0.11.0', 'archiveSha256': 'a' * 64,
                  'portraitRatio': '23:31', 'pdfDownloads': 3,
                  'steps': [{'screenshot': f'{index:02d}-step.png', 'description': 'Completed user action', 'passed': True} for index in range(1, 11)]}
        for field in ['firstLaunch', 'starterChosen', 'formValidationLocated', 'independentLogo', 'singleBackupRestored',
                      'conflictPreserved', 'draftZipRestored', 'draftSurvivedRestart', 'wholeLibraryRestored',
                      'restartPersistence', 'smallScreen', 'noNodeInPath', 'offlineProxy', 'noRemoteRequests']:
            report[field] = True
        return report

    def test_user_journey_evidence_is_bound_to_the_candidate_archive(self):
        report = self.journey()
        self.assertIs(release_proofs.verify_user_journey(report, '0.11.0', 'a' * 64), report)
        for field, value in [('version', '0.11.0-dev.3'), ('archiveSha256', 'b' * 64)]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                release_proofs.verify_user_journey({**report, field: value}, '0.11.0', 'a' * 64)

    def test_user_journey_rejects_incomplete_recovery_and_offline_evidence(self):
        for field, value in [('conflictPreserved', False), ('draftSurvivedRestart', None), ('noRemoteRequests', 'true'),
                             ('portraitRatio', '1:1'), ('pdfDownloads', 2), ('steps', self.journey()['steps'][:-1])]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                release_proofs.verify_user_journey({**self.journey(), field: value}, '0.11.0', 'a' * 64)
        report = self.journey(); report['steps'][-1]['passed'] = False
        with self.assertRaises(ValueError):
            release_proofs.verify_user_journey(report, '0.11.0', 'a' * 64)

    def test_windows_cli_reads_chinese_reports_with_a_non_utf8_default(self):
        with tempfile.TemporaryDirectory(prefix='release-chinese-proof-') as directory:
            folder = Path(directory); archive = folder / 'tech-resume-windows-x64-0.11.0.zip'
            archive.write_bytes(b'candidate archive fixture')
            digest = sha(archive)
            upgrade = self.upgrade(); upgrade.update(to='0.11.0', candidateArchiveSha256=digest)
            journey = self.journey(); journey['archiveSha256'] = digest; journey['steps'][0]['description'] = '第'
            for name, report in [('upgrade-smoke.json', upgrade), ('user-journey-smoke.json', journey)]:
                (folder / name).write_text(json.dumps(report, ensure_ascii=False), encoding='utf-8')
            script = Path(__file__).with_name('check-release-proofs.py').resolve()
            probe = """import io,runpy,sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
original=io.open
def default_gbk(file,mode='r',buffering=-1,encoding=None,*args,**kwargs):
    if 'b' not in mode and encoding in (None,'locale'): encoding='gbk'
    return original(file,mode,buffering,encoding,*args,**kwargs)
io.open=default_gbk
script=sys.argv.pop(1);sys.argv[0]=script;sys.path.insert(0,str(Path(script).parent))
runpy.run_path(script,run_name='__main__')
"""
            result = subprocess.run([sys.executable, '-X', 'utf8=0', '-c', probe, str(script), '--version', '0.11.0', '--directory', str(folder)], capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('user journey', result.stdout)

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
