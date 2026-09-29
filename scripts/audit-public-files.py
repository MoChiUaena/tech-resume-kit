"""Fail if the public Git index contains personal drafts or unknown sample PDFs."""
import json
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]
tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode('utf-8').rstrip('\0').split('\0'))
for filename in sorted(tracked):
    parts = Path(filename).parts
    if not parts or parts[0] in {'personal', 'private', 'my-resume', 'tmp', 'node_modules'}:
        raise SystemExit(f'Private or generated path is tracked: {filename}')
    if any(part.startswith('.env') or '.local.' in part for part in parts):
        raise SystemExit(f'Local-only file is tracked: {filename}')
    if Path(filename).suffix.lower() in {'.pfx', '.p12', '.p8', '.keychain', '.keychain-db'}:
        raise SystemExit(f'Signing credentials are tracked: {filename}')
    if filename.startswith('output/pdf/'):
        basename = Path(filename).name
        stems = ('campus-ink-blue', 'ai-intern-ink-blue', 'experienced-ink-blue')
        allowed = {f'{stem}.{suffix}' for stem in stems for suffix in ('pdf', 'expected.json', 'metrics.json', 'verification.json', 'txt')}
        allowed.update({'campus-ink-blue.png', 'ai-intern-ink-blue.png', 'experienced-ink-blue-1.png', 'experienced-ink-blue-2.png'})
        if basename not in allowed:
            raise SystemExit(f'Unexpected public PDF output: {filename}')

source_files = [root / 'resume.md', root / 'examples/ai-intern/resume.md', root / 'examples/experienced/resume.md', root / 'templates/blank/resume.md']
for source in source_files:
    text = source.read_text(encoding='utf-8')
    if 'example.com' not in text:
        raise SystemExit(f'Anonymous example-domain contact is missing: {source.relative_to(root)}')
    if source.relative_to(root).as_posix() not in tracked:
        raise SystemExit(f'Anonymous source is not tracked: {source.relative_to(root)}')

for stem in ('campus-ink-blue', 'ai-intern-ink-blue', 'experienced-ink-blue'):
    directory = root / 'output/pdf'
    expected = json.loads((directory / f'{stem}.expected.json').read_text(encoding='utf-8'))
    emails = [match.group(0) for field in expected['fields'] for match in re.finditer(r'[A-Z0-9._%+-]+@(?:[A-Z0-9-]+\.)+[A-Z]{2,}', field, re.IGNORECASE)]
    if any(not email.lower().endswith('@example.com') for email in emails):
        raise SystemExit(f'Unexpected email in published sample: {stem}')
    if any(link.startswith(('http:', 'https:', 'mailto:')) and 'example.com' not in link for link in expected['links']):
        raise SystemExit(f'Unexpected link in published sample: {stem}')
    if any(link.startswith('tel:') and link != 'tel:13800000000' for link in expected['links']):
        raise SystemExit(f'Unexpected phone number in published sample: {stem}')
    if not (directory / f'{stem}.pdf').exists():
        raise SystemExit(f'Missing reviewed anonymous PDF: {stem}')
print(f'Public-file audit passed: {len(tracked)} tracked paths, three anonymous sources and PDFs.')
