"""Collect the actual JUnit results emitted by Node's test runner."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
cases = list(ET.parse(root / 'tmp/source-tests.xml').getroot().iter('testcase'))
if not cases:
    raise SystemExit('No test cases were reported.')
failures = sum(case.find('failure') is not None or case.find('error') is not None for case in cases)
skipped = sum(case.find('skipped') is not None for case in cases)
if failures:
    raise SystemExit('Cannot prepare a successful test report from failed tests.')
report = {'tests': len(cases), 'passed': len(cases) - skipped, 'failures': failures, 'skipped': skipped}
(root / 'tmp/source-tests.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
