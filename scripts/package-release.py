"""Build audited GitHub download artifacts without npm registry publication."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
output = root / 'tmp/packages'
output.mkdir(parents=True, exist_ok=True)
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
version = package['version']
packed = json.loads(subprocess.check_output([shutil.which('npm'), 'pack', '--json', '--pack-destination', str(output)], cwd=root, text=True, encoding='utf-8'))[0]
paths = {entry['path'] for entry in packed['files']}
required = {'src/index.mjs', 'src/index.d.mts', 'src/resume.css', 'src/cli.mjs', 'assets/fonts/OFL.txt', 'assets/fonts/ResumeSansSC-Regular.ttf', 'templates/blank/resume.md', 'examples/json/resume.json'}
assert required <= paths, f'Missing package resources: {required - paths}'
for name in paths:
    parts = PurePosixPath(name).parts
    assert parts[0] in {'src', 'app', 'assets', 'templates', 'examples', 'docs', 'starter'} or name in {'package.json', 'README.md', 'LICENSE', 'resume.md', 'layout.yaml'}, name
    assert not any(part.startswith('.env') or part in {'personal', 'private', 'tmp', 'node_modules', '.git'} or '.local.' in part for part in parts), name
archive = output / packed['filename']
starter_name = f'tech-resume-starter-{version}'
starter_zip = output / f'{starter_name}.zip'
with tempfile.TemporaryDirectory(prefix='release-', dir=output) as staging:
    stage = Path(staging) / starter_name
    stage.mkdir()
    toolkit = stage / 'toolkit'
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar.getmembers():
            parts = PurePosixPath(member.name).parts
            assert parts[0] == 'package' and '..' not in parts and not member.issym() and not member.islnk(), member.name
        tar.extractall(Path(staging) / 'unpack', filter='data')
    shutil.move(str(Path(staging) / 'unpack/package'), toolkit)
    shutil.copy2(root / 'package-lock.json', toolkit / 'package-lock.json')
    for name in ('resume.md', 'layout.yaml'):
        shutil.copy2(root / 'templates/blank' / name, stage / name)
    for source in sorted((root / 'starter').rglob('*')):
        if not source.is_file() or source.name == 'runner.mjs':
            continue
        destination = stage / source.relative_to(root / 'starter')
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    (stage / '.gitignore').write_text('output/\ntoolkit/node_modules/\n', encoding='utf-8')
    with zipfile.ZipFile(starter_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zip:
        for source in sorted(stage.rglob('*')):
            if source.is_file():
                info = zipfile.ZipInfo.from_file(source, source.relative_to(stage.parent).as_posix())
                info.create_system = 3
                info.external_attr = (0o100755 if source.suffix == '.sh' else 0o100644) << 16
                payload = source.read_bytes()
                if source.suffix == '.cmd':
                    payload = payload.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
                zip.writestr(info, payload, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
checksums = []
assets = [archive, starter_zip, *(root / 'output/pdf').glob('*.pdf'), root / 'assets/images/nailong-avatar.jpg']
for asset in sorted(assets):
    checksums.append(f'{hashlib.sha256(asset.read_bytes()).hexdigest()}  {asset.name}')
(output / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n', encoding='utf-8')
print(json.dumps({'version': version, 'packageFiles': len(paths), 'archives': [archive.name, starter_zip.name]}, ensure_ascii=False))
