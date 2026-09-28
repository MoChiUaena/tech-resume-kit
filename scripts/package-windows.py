"""Bundle the local editor, verified Node runtime and pinned PDF browser."""
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile

assert os.name == 'nt', 'Build this Windows package on Windows.'
root = Path(__file__).resolve().parents[1]
output = root / 'tmp/packages'
output.mkdir(parents=True, exist_ok=True)
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
node_version = '24.18.0'
node_sha = '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'
node_name = f'node-v{node_version}-win-x64'
node_zip = output / f'{node_name}.zip'
if not node_zip.exists() or hashlib.sha256(node_zip.read_bytes()).hexdigest() != node_sha:
    temporary = node_zip.with_suffix('.download')
    endpoint = f'https://nodejs.org/dist/v{node_version}/{node_name}.zip'
    total = int(urllib.request.urlopen(urllib.request.Request(endpoint, method='HEAD'), timeout=30).headers['Content-Length'])
    for attempt in range(5):
        offset = temporary.stat().st_size if temporary.exists() else 0
        if offset == total: break
        assert 0 <= offset < total < 100_000_000, 'Unexpected runtime archive size'
        request = urllib.request.Request(endpoint, headers={'Range': f'bytes={offset}-'})
        with urllib.request.urlopen(request, timeout=45) as response:
            if response.status == 206:
                match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers['Content-Range'])
                assert match and int(match[1]) == offset and int(match[3]) == total, 'Runtime download range mismatch'
            else:
                assert offset == 0, 'Server did not honor download resume'
            with temporary.open('ab') as stream:
                shutil.copyfileobj(response, stream)
        print(f'Node archive: {temporary.stat().st_size}/{total} bytes received.', flush=True)
    assert temporary.stat().st_size == total, 'Runtime download was incomplete'
    assert hashlib.sha256(temporary.read_bytes()).hexdigest() == node_sha, 'Node download checksum mismatch'
    temporary.replace(node_zip)
print('Verified official Node runtime checksum.', flush=True)
browser_specs = json.loads((root / 'node_modules/playwright-core/browsers.json').read_text())['browsers']
revisions = {b['name']: b['revision'] for b in browser_specs}
assert revisions['chromium-headless-shell'] == '1243', 'Review the new browser before packaging'
cache = Path(os.environ.get('PLAYWRIGHT_BROWSERS_PATH', Path(os.environ['LOCALAPPDATA']) / 'ms-playwright'))
browser_folders = [f"chromium_headless_shell-{revisions['chromium-headless-shell']}", f"winldd-{revisions['winldd']}"]
for folder in browser_folders:
    assert (cache / folder).is_dir(), f'Install the pinned browser first: {folder}'
archive_name = f'tech-resume-windows-x64-{version}'
portable_zip = output / f'{archive_name}.zip'
compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
assert compiler.is_file(), 'Windows .NET Framework compiler is unavailable'
with tempfile.TemporaryDirectory(prefix='windows-', dir=output) as staging:
    stage = Path(staging) / archive_name
    stage.mkdir()
    toolkit = stage / 'toolkit'
    with tarfile.open(output / f'tech-resume-kit-{version}.tgz', 'r:gz') as tar:
        assert all(m.name.startswith('package/') and '..' not in PurePosixPath(m.name).parts and m.isfile() for m in tar.getmembers())
        tar.extractall(Path(staging) / 'unpack', filter='data')
    shutil.move(str(Path(staging) / 'unpack/package'), toolkit)
    shutil.copy2(root / 'package-lock.json', toolkit / 'package-lock.json')
    subprocess.run([shutil.which('npm'), 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=toolkit, check=True)
    runtime = stage / 'runtime'
    runtime.mkdir()
    with zipfile.ZipFile(node_zip) as source:
        for filename in ('node.exe', 'LICENSE'):
            (runtime / ('NODE-LICENSE.txt' if filename == 'LICENSE' else filename)).write_bytes(source.read(f'{node_name}/{filename}'))
    for folder in browser_folders:
        shutil.copytree(cache / folder, runtime / 'browsers' / folder)
    subprocess.run([str(compiler), '/nologo', '/target:winexe', '/platform:x64', '/codepage:65001', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', f'/out:{stage / "启动简历.exe"}', str(root / 'desktop/Launcher.cs')], check=True)
    shutil.copy2(root / 'desktop/README.md', stage / '使用说明.md')
    shutil.copy2(root / 'LICENSE', stage / 'LICENSE')
    (stage / '.gitignore').write_text('my-resume/\n*.local.*\nruntime/\ntoolkit/node_modules/\n', encoding='utf-8')
    manifest = {'kit': version, 'node': node_version, 'nodeSource': f'https://nodejs.org/dist/v{node_version}/{node_name}.zip', 'nodeArchiveSha256': node_sha, 'nodeExeSha256': hashlib.sha256((runtime / 'node.exe').read_bytes()).hexdigest(), 'playwright': '1.63.0', 'chromiumHeadlessRevision': revisions['chromium-headless-shell']}
    (runtime / 'versions.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('Writing Windows portable ZIP with runtime and browser resources.', flush=True)
    with zipfile.ZipFile(portable_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for source in sorted(stage.rglob('*')):
            if source.is_file(): archive.write(source, source.relative_to(stage.parent).as_posix())
checksum = hashlib.sha256(portable_zip.read_bytes()).hexdigest()
checksums = output / 'SHA256SUMS.txt'
lines = [line for line in checksums.read_text().splitlines() if not line.endswith(portable_zip.name)]
checksums.write_text('\n'.join(lines + [f'{checksum}  {portable_zip.name}']) + '\n', encoding='utf-8')
print(json.dumps({'archive': portable_zip.name, 'sizeMB': round(portable_zip.stat().st_size / 1_000_000, 1), 'sha256': checksum}), flush=True)
