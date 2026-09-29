import hashlib
import os
import re
import json
from pathlib import Path, PurePosixPath
import posixpath
import shutil
import tarfile
import zipfile
from pypdf import PdfReader
from PIL import Image

root = Path(__file__).resolve().parents[1]
version = os.environ['RELEASE_VERSION']
assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version)
base = root / 'tmp' / ('release-v' + version)
inputs = base / 'artifacts'
output = base / 'assets'
output.mkdir(parents=True, exist_ok=True)
head = os.environ['CANDIDATE_SHA']
assert re.fullmatch(r'[0-9a-f]{40}', head)
run_id = int(os.environ['CANDIDATE_RUN'])
run = json.loads((base / 'ci.json').read_text(encoding='utf-8-sig'))
assert run['headSha'] == head and run['status'] == 'completed' and run['conclusion'] == 'success'
assert len(run['jobs']) == 6 and all(job['conclusion'] == 'success' for job in run['jobs'])
def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
def copy(source):
    target = output / source.name
    if target.exists():
        assert sha(target) == sha(source), 'A prepared file must not be overwritten with different bytes'
    else:
        shutil.copy2(source, target)
    return target

source = inputs / 'source'
test_report = json.loads((source / 'tmp/source-tests.json').read_text())
assert test_report['failures'] == 0 and test_report['passed'] > 0 and test_report['tests'] >= test_report['passed']
copy(source / 'tmp/packages' / f'tech-resume-kit-{version}.tgz')
copy(source / 'tmp/packages' / f'tech-resume-starter-{version}.zip')
for stem, pages in [('campus-ink-blue', 1), ('ai-intern-ink-blue', 1), ('experienced-ink-blue', 2)]:
    pdf = copy(source / 'output/pdf' / f'{stem}.pdf')
    assert len(PdfReader(pdf).pages) == pages
avatar = copy(source / 'assets/images/nailong-avatar.jpg')
with Image.open(avatar) as image:
    assert image.width / image.height == 23 / 31
with tarfile.open(output / f'tech-resume-kit-{version}.tgz') as archive:
    assert json.load(archive.extractfile('package/package.json'))['version'] == version
with zipfile.ZipFile(output / f'tech-resume-starter-{version}.zip') as archive:
    assert json.loads(archive.read(f'tech-resume-starter-{version}/toolkit/package.json'))['version'] == version

windows = inputs / 'windows/packages'
file = copy(windows / f'tech-resume-windows-x64-{version}.zip')
with zipfile.ZipFile(file) as archive:
    prefix = f'tech-resume-windows-x64-{version}/'
    assert all(name.startswith(prefix) and '..' not in PurePosixPath(name).parts for name in archive.namelist())
    manifest = json.loads(archive.read(prefix + 'runtime/versions.json'))
    assert manifest.get('signing', {}).get('state', 'unsigned') == 'unsigned', 'Signed distributions require the separately verified signing workflow outputs'
    assert manifest['kit'] == version and manifest['node'] == '24.18.0' and manifest['chromiumHeadlessRevision'] == '1243'
    assert json.loads(archive.read(prefix + 'toolkit/package.json'))['version'] == version
    with archive.open(prefix + 'runtime/node.exe') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == manifest['nodeExeSha256']
upgrade = json.loads((windows / 'upgrade-smoke.json').read_text())
assert upgrade['from'] == '0.7.0' and upgrade['to'] == version and upgrade['checkedFiles'] == 23
assert upgrade['oldVersionCanReopen'] and upgrade['recycleBinSurvivesRollback']
platforms = {}
for label in ['linux-x64', 'linux-arm64', 'macos-x64', 'macos-arm64']:
    folder = inputs / label / 'packages'
    package = copy(folder / f'tech-resume-{label}-{version}.tar.gz')
    expected = (folder / f'{label}-SHA256SUMS.txt').read_text().split()[0]
    assert sha(package) == expected
    prefix = package.name.removesuffix('.tar.gz')
    with tarfile.open(package) as archive:
        for member in archive.getmembers():
            assert member.name.split('/')[0] == prefix and '..' not in PurePosixPath(member.name).parts
            if member.issym():
                target = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), member.linkname))
                assert not member.linkname.startswith('/') and target.startswith(prefix + '/')
            if member.islnk():
                assert member.linkname.startswith(prefix + '/') and '..' not in PurePosixPath(member.linkname).parts
        manifest = json.load(archive.extractfile(prefix + '/runtime/versions.json'))
        assert manifest['kit'] == version and manifest['node'] == '24.18.0' and manifest['chromiumHeadlessRevision'] == '1243'
        assert manifest['arch'] == label.split('-')[1]
        assert manifest['platform'] == ('darwin' if label.startswith('macos') else 'linux')
        assert json.load(archive.extractfile(prefix + '/toolkit/package.json'))['version'] == version
        for name, digest in [('runtime/bin/node', manifest['nodeBinarySha256']), ('runtime/' + manifest['chromiumExecutable'], manifest['chromiumBinarySha256'])]:
            with archive.extractfile(prefix + '/' + name) as stream:
                assert hashlib.file_digest(stream, 'sha256').hexdigest() == digest
        extension = 'command' if label.startswith('macos') else 'sh'
        assert archive.getmember(prefix + f'/启动简历.{extension}').mode & 0o111
    proof = json.loads((folder / f'{label}-smoke.json').read_text())
    assert proof['version'] == version and proof['wholeLibraryRestore'] and proof['offlineCanvasPreview'] and proof['restartPersistence']
    platforms[label] = proof

assets = [{'name': file.name, 'size': file.stat().st_size, 'sha256': sha(file)} for file in sorted(output.iterdir()) if file.name not in {'release-validation.json', 'SHA256SUMS.txt'}]
assert len(assets) == 11
report = {'version': version, 'commit': head, 'ciRun': run_id, 'ciUrl': f'https://github.com/MoChiUaena/tech-resume-kit/actions/runs/{run_id}', 'tests': test_report['tests'], 'testResults': test_report, 'jobs': [{'name': job['name'], 'conclusion': job['conclusion']} for job in run['jobs']], 'windowsUpgrade': upgrade, 'platforms': platforms, 'publicPdfPages': [1, 1, 2], 'signing': {'windows': False, 'macosNotarized': False}, 'assets': assets}
(output / 'release-validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
files = sorted(file for file in output.iterdir() if file.name != 'SHA256SUMS.txt')
(output / 'SHA256SUMS.txt').write_text(''.join(f'{sha(file)}  {file.name}\n' for file in files), encoding='utf-8')
print(json.dumps({'version': version, 'assets': len(files) + 1, 'allArchiveVersionsMatch': True, 'allRuntimeHashesMatch': True, 'output': str(output)}, ensure_ascii=False))
