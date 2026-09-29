"""Upload verified files to a resumable draft, without publishing it."""
import json
import os
from pathlib import Path
import subprocess
from release_proofs import sha, require, verified_draft_assets

repo = 'MoChiUaena/tech-resume-kit'
version, head = os.environ['RELEASE_VERSION'], os.environ['CANDIDATE_SHA']
tag, title = 'v' + version, 'v' + version + ' - ' + os.environ['RELEASE_TOPIC']
base = Path('tmp') / ('release-v' + version)
assets = base / 'assets'
data = json.loads((assets / 'release-validation.json').read_text(encoding='utf-8'))
require(data['commit'] == head and data['version'] == version, 'Release candidate identity does not match.')
files = sorted(assets.iterdir())
require(all(file.is_file() for file in files), 'Unexpected prepared release directory.')
expected = [{'name': file.name, 'size': file.stat().st_size, 'sha256': sha(file)} for file in files]
notes = base / 'notes.md'
notes.write_text(os.environ['RELEASE_NOTES'].strip() + '\n\n' + str(data['tests']) + ' 项 Node.js 测试与六项 CI 通过。完整验收与文件摘要见 release-validation.json 和 SHA256SUMS.txt。\n', encoding='utf-8')

def run(*args):
    subprocess.run(['gh', *args, '--repo', repo], check=True)

def view():
    return subprocess.run(['gh', 'release', 'view', tag, '--repo', repo, '--json', 'isDraft,targetCommitish,assets'], capture_output=True, text=True)

result = view()
if result.returncode:
    require('not found' in result.stderr.lower(), 'Cannot inspect the existing release; refusing to create or overwrite it.')
    run('release', 'create', tag, '--target', head, '--title', title, '--notes-file', str(notes), '--draft')
    result = view()
require(result.returncode == 0, 'Draft was not readable after creation.')
existing = json.loads(result.stdout)
require(existing['isDraft'] and existing['targetCommitish'] == head, 'Only the same unpublished candidate can be resumed.')
present = verified_draft_assets(expected, existing['assets'])
run('release', 'edit', tag, '--title', title, '--notes-file', str(notes))
for file in files:
    if file.name not in present:
        run('release', 'upload', tag, str(file))
final = view()
require(final.returncode == 0, 'Cannot verify the uploaded draft.')
draft = json.loads(final.stdout)
require(draft['isDraft'] and draft['targetCommitish'] == head, 'Draft identity changed during upload.')
require(verified_draft_assets(expected, draft['assets']) == {file.name for file in files}, 'Draft asset list is incomplete.')
print(json.dumps({'tag': tag, 'commit': head, 'draft': True, 'assets': len(files), 'allRemoteDigestsMatch': True}))
