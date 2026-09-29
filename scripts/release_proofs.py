"""Validate the build evidence consumed by release assembly."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import plistlib
import posixpath
import stat
import zipfile

def require(condition, message):
    if not condition:
        raise ValueError(message)

def sha(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def verified_draft_assets(expected, existing):
    planned = {asset['name']: asset for asset in expected}
    require(len(planned) == len(expected), 'Duplicate planned release asset.')
    found = set()
    for asset in existing:
        name = asset.get('name')
        require(name in planned and name not in found, 'Unknown or duplicate draft asset.')
        wanted = planned[name]
        require(asset.get('state') == 'uploaded' and asset.get('size') == wanted['size'] and asset.get('digest') == 'sha256:' + wanted['sha256'], 'Draft asset differs from the verified candidate: ' + name)
        found.add(name)
    return found

def verify_upgrade(report, version, candidate_sha256):
    baseline = json.loads(Path(__file__).with_name('upgrade-baseline.json').read_text(encoding='utf-8'))
    require(report.get('schemaVersion') == 1, 'Upgrade report schema does not match.')
    require(report.get('from') == baseline['version'] and report.get('to') == version, 'Upgrade versions do not match the published baseline and candidate.')
    require(report.get('baselineArchiveSha256') == baseline['sha256'], 'Upgrade did not use the exact published download.')
    require(report.get('candidateArchiveSha256') == candidate_sha256, 'Upgrade used a different candidate archive.')
    for field in ['checkedFiles', 'untouchedFilesAfterEditing', 'resumeCount', 'trashCount']:
        require(type(report.get(field)) is int and report[field] > 0, 'Upgrade evidence is missing: ' + field)
    require(report['resumeCount'] >= 3 and report['trashCount'] >= 1, 'Upgrade must cover multiple resumes and existing trash.')
    for field in ['publishedOldPackage', 'sameDataDirectory', 'originalFilesVerified', 'oldVersionCanReopen',
                  'recycleBinSurvivesRollback', 'multipleResumes', 'selectedResumePreserved', 'imagesAndHistoryPreserved',
                  'existingLibrarySkipsWelcome', 'formChangesPreserved', 'singleBackupRestored', 'wholeLibraryRestored',
                  'offlinePdfViewer', 'restartPersistence']:
        require(report.get(field) is True, 'Upgrade check did not pass: ' + field)
    require(report.get('pdfPages') == [1, 2, 2], 'Upgrade PDF evidence is incomplete.')
    return report

def verify_macos_app(folder, version, arch):
    require(arch in ['x64', 'arm64'], 'Unsupported macOS architecture.')
    folder = Path(folder)
    name = f'tech-resume-macos-app-{arch}-{version}'
    archive = folder / (name + '.zip')
    build = json.loads((folder / (name + '.validation.json')).read_text(encoding='utf-8'))
    smoke = json.loads((folder / (name + '.smoke.json')).read_text(encoding='utf-8'))
    require(build.get('version') == version and build.get('arch') == arch and build.get('archive') == archive.name, 'macOS build identity does not match.')
    require(build.get('bundleIntegrityVerified') is True and type(build.get('nativeFiles')) is int and build['nativeFiles'] > 0, 'macOS resource verification is missing.')
    require(build.get('sha256') == sha(archive), 'macOS app archive checksum does not match.')
    require(smoke.get('version') == version and smoke.get('arch') == arch, 'macOS smoke identity does not match.')
    for field in ['nativeApp', 'packageRuntimes', 'singleton', 'offlinePdf', 'restartPersistence', 'bundleUnchangedByEditing', 'tamperingRejected']:
        require(smoke.get(field) is True, 'macOS launch check did not pass: ' + field)
    prefix = 'TechResumeKit.app/'
    resources = prefix + 'Contents/Resources/'
    with zipfile.ZipFile(archive) as bundle:
        names = bundle.namelist()
        require(len(names) == len(set(names)), 'Duplicate macOS archive path.')
        for info in bundle.infolist():
            parts = PurePosixPath(info.filename).parts
            require(parts and not info.filename.startswith('/') and '..' not in parts and '\\' not in info.filename, 'Invalid macOS archive path.')
            metadata = parts[:2] in [('__MACOSX', 'TechResumeKit.app'), ('__MACOSX', '._TechResumeKit.app')] or parts == ('__MACOSX',) and info.is_dir()
            require(parts[0] == 'TechResumeKit.app' or metadata, 'Unknown macOS archive root.')
            if stat.S_ISLNK(info.external_attr >> 16):
                target = bundle.read(info).decode('utf-8')
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(info.filename), target))
                require(not target.startswith('/') and resolved.startswith(prefix), 'macOS archive link leaves the app.')
        manifest = json.loads(bundle.read(resources + 'runtime/versions.json'))
        package = json.loads(bundle.read(resources + 'toolkit/package.json'))
        plist = plistlib.loads(bundle.read(prefix + 'Contents/Info.plist'))
        require(manifest.get('kit') == version and package.get('version') == version, 'macOS app package version does not match.')
        require(manifest.get('platform') == 'darwin' and manifest.get('arch') == arch, 'macOS app runtime architecture does not match.')
        require(manifest.get('node') == '24.18.0' and manifest.get('playwright') == '1.63.0' and manifest.get('chromiumHeadlessRevision') == '1243', 'macOS app runtime versions do not match.')
        require(plist.get('CFBundleExecutable') == 'TechResumeLauncher' and plist.get('CFBundleShortVersionString') == version.split('-')[0], 'macOS app launcher metadata does not match.')
        browser = f'runtime/browsers/chromium_headless_shell-1243/chrome-headless-shell-mac-{arch}/chrome-headless-shell'
        require(manifest.get('chromiumExecutable') == browser.removeprefix('runtime/'), 'macOS app browser path does not match.')
        for file, expected in [('runtime/bin/node', manifest.get('nodeBinarySha256')), (browser, manifest.get('chromiumBinarySha256'))]:
            with bundle.open(resources + file) as stream:
                require(hashlib.file_digest(stream, 'sha256').hexdigest() == expected, 'macOS app runtime checksum does not match.')
            require(bundle.getinfo(resources + file).external_attr >> 16 & 0o111, 'macOS app runtime is not executable.')
        require(bundle.getinfo(prefix + 'Contents/MacOS/TechResumeLauncher').external_attr >> 16 & 0o111, 'macOS app launcher is not executable.')
    return {'archive': archive.name, 'sha256': build['sha256'], 'build': build, 'smoke': smoke}
