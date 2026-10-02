import argparse
import json
from pathlib import Path
from release_proofs import verify_user_journey, sha, verify_upgrade, verify_macos_app

parser = argparse.ArgumentParser()
parser.add_argument('--version', required=True)
parser.add_argument('--directory', type=Path, default=Path('tmp/packages'))
parser.add_argument('--arch', choices=['x64', 'arm64'])
args = parser.parse_args()
if args.arch:
    report = verify_macos_app(args.directory, args.version, args.arch)
    print(f'MacOS {args.arch}: native app archive and launch evidence verified.')
else:
    report = json.loads((args.directory / 'upgrade-smoke.json').read_text(encoding='utf-8'))
    archive = args.directory / f'tech-resume-windows-x64-{args.version}.zip'
    verify_upgrade(report, args.version, sha(archive))
    verify_user_journey(json.loads((args.directory / 'user-journey-smoke.json').read_text(encoding='utf-8')), args.version, sha(archive))
    print(f'Upgrade {report["from"]} -> {args.version}: {report["checkedFiles"]} original files, user journey and candidate archive verified.')
