"""Exercise the report collector against complete and corrupted boundary evidence."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
LEGACY_ACCEPTED = ['logo-only', 'photo-only', 'no-images', 'short-content', 'oriented-photo', 'long-title-link', 'oversized-entry', 'oversized-paragraph', 'heading-boundary']
LEGACY_REJECTED = ['over-two-pages', 'oversized-header']


class QaReportChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Read the actual producer's current six-theme case catalogue without
        # exporting PDFs or installing third-party Node dependencies.
        script = """
          import { themeBoundaryCases } from './scripts/theme-boundary-cases.mjs';
          const baseline = {layout: {page: {}, images: {portrait: {enabled: true}, schoolLogo: {enabled: true}}},
            document: {person: {}, sections: [{id: 'projects', entries: [{blocks: []}]}, {id: 'additional', blocks: []}]}};
          const matrix = themeBoundaryCases(baseline);
          console.log(JSON.stringify([
            ...matrix.cases.map(row => ({case: row.stem, result: 'passed'})),
            ...matrix.rejections.map(row => ({case: row.stem, result: 'rejected-as-expected'}))
          ]));
        """
        cls.matrix = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=ROOT))
        cls.rows = [{'case': name, 'result': 'passed'} for name in LEGACY_ACCEPTED]
        cls.rows += [{'case': name, 'result': 'rejected-as-expected'} for name in LEGACY_REJECTED]
        cls.rows += cls.matrix

    def collect(self, rows):
        scratch = ROOT / 'tmp'
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='qa-report-test-', dir=scratch) as temporary:
            root = Path(temporary).resolve()
            self.assertEqual(root.parent, scratch.resolve())
            (root / 'scripts').mkdir()
            (root / 'scripts/collect-qa-report.py').write_bytes((ROOT / 'scripts/collect-qa-report.py').read_bytes())
            (root / 'package.json').write_text('{"version":"0.12.0"}', encoding='utf-8')
            (root / 'docs').mkdir()

            def evidence(directory, stem, pages=1):
                directory.mkdir(parents=True, exist_ok=True)
                (directory / f'{stem}.pdf').write_bytes(b'%PDF-collector-fixture')
                report = {'pages': pages, 'contentFieldsChecked': 1, 'headingsChecked': 1,
                          'imageCount': 0, 'links': [], 'fonts': ['fixture'], 'pageDetails': []}
                (directory / f'{stem}.verification.json').write_text(json.dumps(report), encoding='utf-8')
                (directory / f'{stem}.metrics.json').write_text(json.dumps({'pageCount': pages}), encoding='utf-8')
                for page in range(1, pages + 1):
                    (directory / f'{stem}{"" if pages == 1 else "-" + str(page)}.png').write_bytes(b'collector-fixture')

            for stem, pages in [('campus-ink-blue', 1), ('ai-intern-ink-blue', 1), ('experienced-ink-blue', 2)]:
                evidence(root / 'output/pdf', stem, pages)
            boundary = root / 'tmp/pdfs/boundary'
            boundary.mkdir(parents=True)
            (boundary / 'summary.json').write_text(json.dumps(rows), encoding='utf-8')
            for row in rows:
                if row['result'] == 'passed':
                    evidence(boundary, row['case'])
            process = subprocess.run([sys.executable, str(root / 'scripts/collect-qa-report.py')], capture_output=True, text=True)
            output = root / 'docs/phase-c-evidence.json'
            return process, json.loads(output.read_text(encoding='utf-8')) if output.exists() else None

    def test_current_producer_matrix_collects_all_45_pdfs_and_14_rejections(self):
        process, report = self.collect(self.rows)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(report['counts']['boundarySamples'], 45)
        self.assertEqual(report['counts']['rejectedAsExpected'], 14)

    def test_legacy_only_matrix_is_incomplete(self):
        process, report = self.collect(self.rows[:11])
        self.assertNotEqual(process.returncode, 0)
        self.assertIsNone(report)

    def test_missing_accepted_or_rejected_case_cannot_produce_a_report(self):
        for omitted in ['forest-rail-logo-only', 'warm-labels-over-two-pages']:
            with self.subTest(case=omitted):
                process, report = self.collect([row for row in self.rows if row['case'] != omitted])
                self.assertNotEqual(process.returncode, 0)
                self.assertIsNone(report)

    def test_duplicate_case_with_unchanged_counts_is_rejected(self):
        rows = [dict(row) for row in self.rows]
        rows[1] = dict(rows[0])
        process, report = self.collect(rows)
        self.assertNotEqual(process.returncode, 0)
        self.assertIsNone(report)

    def test_unknown_case_with_unchanged_counts_is_rejected(self):
        rows = [dict(row) for row in self.rows]
        rows[-1]['case'] = 'graphite-grid-unreviewed-case'
        process, report = self.collect(rows)
        self.assertNotEqual(process.returncode, 0)
        self.assertIsNone(report)

    def test_unknown_or_wrong_outcome_is_rejected(self):
        for outcome in ['warning', 'rejected-as-expected']:
            with self.subTest(outcome=outcome):
                rows = [dict(row) for row in self.rows]
                rows[0]['result'] = outcome
                process, report = self.collect(rows)
                self.assertNotEqual(process.returncode, 0)
                self.assertIsNone(report)


if __name__ == '__main__':
    unittest.main()
