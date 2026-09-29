"""Build native macOS/Linux downloads with pinned Node and Chromium."""
import hashlib
import json
import os
import platform
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

root = Path(__file__).resolve().parents[1]
target = {'Darwin': 'darwin', 'Linux': 'linux'}.get(platform.system())
assert target, 'Build POSIX packages on their native macOS/Linux host.'
arch = {'x86_64': 'x64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(platform.machine())
assert arch, 'Only x64 and arm64 are supported.'
version = json.loads((root / 'package.json').read_text())['version']
node_version = '24.18.0'
node_sums = {
    ('darwin', 'arm64'): 'e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1',
    ('darwin', 'x64'): 'dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080',
    ('linux', 'arm64'): '6b4484c2190274175df9aa8f28e2d758a819cb1c1fe6ab481e2f95b463ab8508',
    ('linux', 'x64'): '783130984963db7ba9cbd01089eaf2c2efb055c7c1693c943174b967b3050cb8',
}
output = root / 'tmp/packages'
output.mkdir(parents=True, exist_ok=True)
node_name = f'node-v{node_version}-{target}-{arch}'
node_archive = output / f'{node_name}.tar.gz'
node_source = f'https://nodejs.org/dist/v{node_version}/{node_archive.name}'
def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
if not node_archive.exists() or sha(node_archive) != node_sums[(target, arch)]:
    pending = node_archive.with_suffix('.download')
    with urllib.request.urlopen(node_source, timeout=60) as response, pending.open('wb') as stream:
        shutil.copyfileobj(response, stream)
    assert sha(pending) == node_sums[(target, arch)], 'Official Node archive checksum mismatch.'
    pending.replace(node_archive)
specs = json.loads((root / 'node_modules/playwright-core/browsers.json').read_text())['browsers']
assert next(item['revision'] for item in specs if item['name'] == 'chromium-headless-shell') == '1243'
cache = Path(os.environ.get('PLAYWRIGHT_BROWSERS_PATH', Path.home() / ('Library/Caches/ms-playwright' if target == 'darwin' else '.cache/ms-playwright')))
browser_folder = 'chromium_headless_shell-1243'
browser_child = f'chrome-headless-shell-mac-{arch}' if target == 'darwin' else 'chrome-headless-shell-linux64' if arch == 'x64' else 'chrome-headless-shell-linux-arm64'
browser_relative = f'browsers/{browser_folder}/{browser_child}/chrome-headless-shell'
assert (cache / browser_folder / browser_child / 'chrome-headless-shell').is_file(), 'Install pinned Chromium with --only-shell first.'
label = 'macos' if target == 'darwin' else 'linux'
name = f'tech-resume-{label}-{arch}-{version}'
archive = output / f'{name}.tar.gz'
with tempfile.TemporaryDirectory(prefix=f'{label}-{arch}-', dir=output) as staging:
    stage = Path(staging) / name
    stage.mkdir()
    with tarfile.open(output / f'tech-resume-kit-{version}.tgz') as source:
        assert all(member.name.startswith('package/') and '..' not in PurePosixPath(member.name).parts and member.isfile() for member in source.getmembers())
        source.extractall(Path(staging) / 'unpack', filter='data')
    toolkit = stage / 'toolkit'
    shutil.move(str(Path(staging) / 'unpack/package'), toolkit)
    shutil.copy2(root / 'package-lock.json', toolkit / 'package-lock.json')
    subprocess.run([shutil.which('npm'), 'ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=toolkit, check=True)
    runtime = stage / 'runtime'
    (runtime / 'bin').mkdir(parents=True)
    with tarfile.open(node_archive) as source:
        for source_name, destination in [('bin/node', runtime / 'bin/node'), ('LICENSE', runtime / 'NODE-LICENSE.txt')]:
            with source.extractfile(f'{node_name}/{source_name}') as stream:
                destination.write_bytes(stream.read())
    (runtime / 'bin/node').chmod(0o755)
    shutil.copytree(cache / browser_folder, runtime / 'browsers' / browser_folder, symlinks=True)
    extension = 'command' if target == 'darwin' else 'sh'
    for source, destination in [('launch-posix.sh', f'启动简历.{extension}'), ('check-posix.sh', f'检查环境.{extension}')]:
        file = stage / destination
        file.write_bytes((root / 'desktop' / source).read_bytes().replace(b'\r\n', b'\n'))
        file.chmod(0o755)
    shutil.copy2(root / f'desktop/README-{label}.md', stage / '使用说明.md')
    shutil.copy2(root / 'LICENSE', stage / 'LICENSE')
    manifest = {'kit': version, 'platform': target, 'arch': arch, 'node': node_version, 'nodeSource': node_source, 'nodeArchiveSha256': node_sums[(target, arch)], 'nodeBinarySha256': sha(runtime / 'bin/node'), 'playwright': '1.63.0', 'chromiumHeadlessRevision': '1243', 'chromiumExecutable': browser_relative, 'chromiumBinarySha256': sha(runtime / browser_relative)}
    (runtime / 'versions.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (stage / '.gitignore').write_text('my-resume/\n*.local.*\nruntime/\ntoolkit/node_modules/\n')
    with tarfile.open(archive, 'w:gz', compresslevel=6) as package:
        package.add(stage, arcname=name)
checksum = sha(archive)
(output / f'{label}-{arch}-SHA256SUMS.txt').write_text(f'{checksum}  {archive.name}\n')
checksums = output / 'SHA256SUMS.txt'
lines = [line for line in checksums.read_text().splitlines() if not line.endswith(archive.name)]
checksums.write_text('\n'.join(lines + [f'{checksum}  {archive.name}']) + '\n')
print(json.dumps({'archive': archive.name, 'platform': target, 'arch': arch, 'sizeMB': round(archive.stat().st_size / 1_000_000, 1), 'sha256': checksum}), flush=True)
