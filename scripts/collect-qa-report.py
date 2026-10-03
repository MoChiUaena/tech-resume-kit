"""Collect PDF and image inspection evidence after verify-pdf.py and Poppler.

Pass --reviewed only after a person has visually checked every rendered page.
"""
import argparse
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--reviewed', action='store_true')
args = parser.parse_args()

def gather(directory, stem):
    pdf = directory / f'{stem}.pdf'
    report = directory / f'{stem}.verification.json'
    metrics = directory / f'{stem}.metrics.json'
    assert pdf.exists() and report.exists() and metrics.exists(), f'Incomplete PDF evidence: {stem}'
    assert report.stat().st_mtime >= pdf.stat().st_mtime, f'PDF verification is stale: {stem}'
    verification = json.loads(report.read_text(encoding='utf8'))
    build = json.loads(metrics.read_text(encoding='utf8'))
    pages = verification['pages']
    images = [directory / f'{stem}{"" if pages == 1 else f"-{page}"}.png' for page in range(1, pages + 1)]
    assert all(image.exists() and image.stat().st_mtime >= pdf.stat().st_mtime for image in images), f'Missing/stale rendered page: {stem}'
    assert build['pageCount'] == pages, f'Browser count disagrees with PDF: {stem}'
    return {
        'name': stem, 'pages': pages,
        'pdf': str(pdf.relative_to(root)).replace('\\', '/'),
        'renderedPages': [str(image.relative_to(root)).replace('\\', '/') for image in images],
        'textFieldsChecked': verification['contentFieldsChecked'],
        'headingsChecked': verification['headingsChecked'],
        'imageCount': verification['imageCount'],
        'linkCount': len(verification['links']),
        'fontCount': len(verification['fonts']),
        'pageDetails': verification['pageDetails'],
        'warnings': build.get('warnings', []),
    }

public = [gather(root / 'output/pdf', stem) for stem in ['campus-ink-blue', 'ai-intern-ink-blue', 'experienced-ink-blue']]
boundary_directory = root / 'tmp/pdfs/boundary'
boundary_summary = json.loads((boundary_directory / 'summary.json').read_text(encoding='utf8'))
themes = ['ink-blue', 'minimal-mono', 'slate-banner', 'forest-rail', 'warm-labels', 'graphite-grid']
theme_cases = ['portrait-only', 'logo-only', 'neither-image', 'long-header-contact', 'long-project-chapter', 'body-eleven-margin-seventeen']
expected_accepted = {'logo-only', 'photo-only', 'no-images', 'short-content', 'oriented-photo', 'long-title-link', 'oversized-entry', 'oversized-paragraph', 'heading-boundary'}
expected_accepted.update(f'{theme}-{case}' for theme in themes for case in theme_cases)
expected_rejected = {'over-two-pages', 'oversized-header'}
expected_rejected.update(f'{theme}-{case}' for theme in themes for case in ['over-two-pages', 'oversized-header'])
assert isinstance(boundary_summary, list) and all(isinstance(row, dict) and isinstance(row.get('case'), str) and row.get('result') in {'passed', 'rejected-as-expected'} for row in boundary_summary), 'Invalid boundary summary row or outcome'
assert len({row['case'] for row in boundary_summary}) == len(boundary_summary), 'Duplicate boundary case'
accepted = [row['case'] for row in boundary_summary if row['result'] == 'passed']
rejected = [row['case'] for row in boundary_summary if row['result'] == 'rejected-as-expected']
assert set(accepted) == expected_accepted, f'Accepted boundary cases differ: missing {sorted(expected_accepted - set(accepted))}; unknown {sorted(set(accepted) - expected_accepted)}'
assert set(rejected) == expected_rejected, f'Rejected boundary cases differ: missing {sorted(expected_rejected - set(rejected))}; unknown {sorted(set(rejected) - expected_rejected)}'
boundary = [gather(boundary_directory, stem) for stem in accepted]
report = {
    'scope': 'Stage C: one- and two-page output with boundary cases',
    'modelSchemaVersion': '0.2.0',
    'applicationVersion': json.loads((root / 'package.json').read_text(encoding='utf8'))['version'],
    'visualReviewConfirmed': args.reviewed,
    'counts': {
        'publicSamples': len(public),
        'publicPages': sum(item['pages'] for item in public),
        'boundarySamples': len(boundary),
        'boundaryPages': sum(item['pages'] for item in boundary),
        'rejectedAsExpected': len(rejected),
        'totalTextFieldsChecked': sum(item['textFieldsChecked'] for item in public + boundary),
        'totalHeadingsChecked': sum(item['headingsChecked'] for item in public + boundary),
    },
    'publicSamples': public,
    'boundarySamples': boundary,
    'rejectedCases': rejected,
    'limits': ['Only A4 with one or two pages is accepted', 'Blank starter contains prompts, not a real resume', 'The sparse-last-page warning estimates density and asks for visual review'],
}
destination = root / 'docs/phase-c-evidence.json'
destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps(report['counts'], ensure_ascii=False, indent=2))
