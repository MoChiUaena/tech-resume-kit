"""Inspect actual PDF text, pagination, fonts, links, images and page boundaries.

Requires pypdf and pdfplumber. Poppler visual review is still independent.
Use --directory tmp/pdfs/boundary to verify the generated boundary fixtures.
"""
import argparse
import json
from pathlib import Path
import re

import pdfplumber
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
# PDF text extraction may retain standard Latin ligature code points (e.g. fi in Retrofit).
# Expand only these presentation glyphs; all other characters remain exact.
latin_ligatures = str.maketrans({'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st'})
compact = lambda text: re.sub(r'\s+', '', text.translate(latin_ligatures))


def verify(directory, stem):
    if not re.fullmatch(r'[a-z][a-z0-9-]*', stem):
        raise ValueError(f'Invalid sample stem: {stem}')
    pdf_file = directory / f'{stem}.pdf'
    expected = json.loads((directory / f'{stem}.expected.json').read_text(encoding='utf8'))
    reader = PdfReader(pdf_file)
    assert len(reader.pages) == expected['pages'], f'{stem}: expected {expected["pages"]} pages, got {len(reader.pages)}'
    margin_x = expected.get('marginHorizontalMm', expected['marginMm']) * 72 / 25.4
    margin_top = expected.get('marginTopMm', expected['marginMm']) * 72 / 25.4
    margin_bottom = expected.get('marginBottomMm', expected['marginMm']) * 72 / 25.4
    page_number_visible = expected.get('pageNumberVisible', True)
    bodies, fonts, links, image_count, page_reports = [], {}, [], 0, []
    with pdfplumber.open(pdf_file) as visual:
        for index, page in enumerate(reader.pages):
            width, height = float(page.mediabox.width), float(page.mediabox.height)
            assert abs(width - 595.28) < 1 and abs(height - 841.89) < 1, 'Not A4'
            full_text = page.extract_text()
            # This pinned Chromium writes page-margin boxes before body text.
            # Remove exactly that verified prefix; visitor coordinates for
            # delayed inline-text flushes on page 2 are not reliable in pypdf.
            prefix = (r'个人简历\s*·\s*续页\s*' if index else '')
            if page_number_visible:
                prefix += rf'{index + 1}\s*/\s*{len(reader.pages)}\s*'
            match = re.match(prefix, full_text)
            assert match, f'{stem}: unexpected margin-text order on page {index + 1}'
            body = full_text[match.end():]
            assert compact(body), f'{stem}: empty body on page {index + 1}'
            if page_number_visible:
                assert f'{index + 1}/{len(reader.pages)}' in compact(full_text), 'Missing/wrong page number'
            else:
                assert f'{index + 1}/{len(reader.pages)}' not in compact(full_text), 'Unexpected page number'
            if index:
                assert '个人简历·续页' in compact(full_text), 'Missing continuation header'
            bodies.append(body)
            for ref in page['/Resources']['/Font'].values():
                font = ref.get_object()
                assert font['/Subtype'] != '/Type3', 'Unexpected Type3 font'
                descendant = font.get('/DescendantFonts', [font])[0].get_object()
                descriptor = descendant['/FontDescriptor'].get_object()
                name = str(font['/BaseFont'])
                family = 'ResumeSerifSC-' if expected.get('fontFamily') == 'serif' else 'ResumeSansSC-'
                assert family in name, f'Unexpected fallback font: {name}'
                fonts[name] = {'name': name, 'embedded': any(key in descriptor for key in ['/FontFile', '/FontFile2', '/FontFile3']), 'toUnicode': '/ToUnicode' in font}
            links.extend(str(annotation.get_object()['/A']['/URI']) for annotation in page.get('/Annots', []) if '/A' in annotation.get_object() and '/URI' in annotation.get_object()['/A'])
            vp = visual.pages[index]
            # Margin labels are expected; check body geometry independently.
            content = vp.crop((0, margin_top - 2, width, height - margin_bottom + 2))
            chars = content.chars
            assert chars, f'{stem}: visually empty body on page {index + 1}'
            assert all(c['x0'] >= margin_x - 2 and c['x1'] <= width - margin_x + 2 for c in chars), f'{stem}: horizontal overflow on page {index + 1}'
            assert all(c['x0'] >= 8 and c['x1'] <= width - 8 and c['top'] >= 8 and c['bottom'] <= height - 8 for c in vp.chars), f'{stem}: text outside paper safe area'
            assert not any(margin_top + 2 < c['bottom'] and c['top'] < margin_top - 2 or height - margin_bottom - 2 < c['bottom'] and c['top'] < height - margin_bottom - 2 for c in vp.chars), f'{stem}: text crosses a content boundary'
            image_count += len(vp.images)
            for image in vp.images:
                assert image['x0'] >= margin_x - 2 and image['x1'] <= width - margin_x + 2 and image['top'] >= margin_top - 2 and image['bottom'] <= height - margin_bottom + 2, 'Image outside body'
            page_reports.append({'page': index + 1, 'bodyCharacters': len(body), 'bodyBoundsPt': {'left': min(c['x0'] for c in chars), 'right': max(c['x1'] for c in chars), 'top': min(c['top'] for c in chars), 'bottom': max(c['bottom'] for c in chars)}, 'imageCount': len(vp.images)})

    text = '\n'.join(bodies)
    whole = compact(text)
    assert '\ufffd' not in text, 'Replacement character found'
    for field in expected['fields']:
        assert compact(field) in whole, f'{stem}: missing or changed text: {field[:120]}'
    positions = [whole.index(compact(title)) for title in expected['sectionOrder']]
    assert positions == sorted(positions), f'{stem}: unexpected reading order'
    for heading in expected['headings']:
        title, following = compact(heading['title']), compact(heading['next'])
        assert any(title in compact(body) and following in compact(body).split(title, 1)[1] for body in bodies), f'{stem}: orphaned heading: {heading["title"]}'
    assert fonts and all(font['embedded'] and font['toUnicode'] for font in fonts.values())
    assert set(links) == set(expected['links']), f'{stem}: unexpected links'
    assert image_count == expected['imageCount'], f'{stem}: unexpected image count {image_count}'
    for fragment in expected.get('mustSpanPages', []):
        assert not any(compact(fragment) in compact(body) for body in bodies), f'{stem}: expected paragraph to span pages'
    if expected.get('firstPageMinimumBottomPt'):
        assert page_reports[0]['bodyBoundsPt']['bottom'] >= expected['firstPageMinimumBottomPt'], f'{stem}: excessive blank space on first page'
    report = {'pages': len(reader.pages), 'tagged': bool(reader.trailer['/Root'].get('/MarkInfo', {}).get('/Marked')), 'fonts': list(fonts.values()), 'links': sorted(set(links)), 'linkAnnotationCount': len(links), 'imageCount': image_count, 'contentFieldsChecked': len(expected['fields']), 'headingsChecked': len(expected['headings']), 'sectionOrder': expected['sectionOrder'], 'pageDetails': page_reports, 'visualReview': 'See docs/phase-c-review.md; visual review is separate.'}
    (directory / f'{stem}.verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    (directory / f'{stem}.txt').write_text(text, encoding='utf8')
    print(f'{stem}: {len(reader.pages)} pages, {len(expected["fields"])} fields, {len(expected["headings"])} headings, {len(fonts)} embedded fonts, {image_count} images, {len(set(links))} links verified.')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, default=ROOT / 'output/pdf')
    parser.add_argument('samples', nargs='*')
    args = parser.parse_args()
    samples = args.samples or (['campus-ink-blue', 'ai-intern-ink-blue', 'experienced-ink-blue'] if args.directory.resolve() == (ROOT / 'output/pdf').resolve() else [file.name.removesuffix('.expected.json') for file in sorted(args.directory.glob('*.expected.json'))])
    for sample in samples:
        verify(args.directory, sample)
