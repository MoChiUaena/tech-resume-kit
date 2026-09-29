"""Prepare an immutable native .app; adhoc test output is separate from notarized output."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from macos_signing import SigningError, identity, sign_children, sign_app, notarize, required_environment

def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def build(mode):
    if platform.system() != 'Darwin':
        raise SigningError('Build native macOS apps on a macOS host.')
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / 'package.json').read_text())['version']
    arch = {'x86_64': 'x64', 'arm64': 'arm64'}.get(platform.machine())
    if not arch:
        raise SigningError('Only macOS Intel and Apple Silicon are supported.')
    if mode == 'notarized':
        if not re.fullmatch(r'\d+\.\d+\.\d+', version):
            raise SigningError('Production signing requires a stable package version.')
        required_environment()
    output = root / 'tmp/packages'
    source_name = f'tech-resume-macos-{arch}-{version}'
    source = output / f'{source_name}.tar.gz'
    if not source.is_file():
        raise SigningError('Build package:release and package:posix before package:macos-app.')
    name = f'tech-resume-macos-app-{arch}-{version}' + ('-adhoc' if mode == 'adhoc' else '')
    destination = output / (name + '.zip')
    with tempfile.TemporaryDirectory(prefix='macos-app-', dir=output) as staging_name:
        staging = Path(staging_name)
        with tarfile.open(source) as archive:
            if any(member.name.split('/')[0] != source_name or '..' in PurePosixPath(member.name).parts for member in archive.getmembers()):
                raise SigningError('Source archive has an invalid path.')
            archive.extractall(staging, filter='data')
        app = staging / 'TechResumeKit.app'
        contents = app / 'Contents'
        (contents / 'MacOS').mkdir(parents=True)
        resources = contents / 'Resources'
        shutil.move(str(staging / source_name), resources)
        manifest_file = resources / 'runtime/versions.json'
        manifest = json.loads(manifest_file.read_text())
        if manifest['kit'] != version or manifest['platform'] != 'darwin' or manifest['arch'] != arch:
            raise SigningError('Source package version or platform does not match.')
        expected_browser = f'browsers/chromium_headless_shell-1243/chrome-headless-shell-mac-{arch}/chrome-headless-shell'
        if manifest.get('chromiumExecutable') != expected_browser or manifest.get('node') != '24.18.0' or manifest.get('playwright') != '1.63.0' or manifest.get('chromiumHeadlessRevision') != '1243':
            raise SigningError('Source runtime versions or paths do not match the pinned components.')
        node = resources / 'runtime/bin/node'
        browser = resources / 'runtime' / manifest['chromiumExecutable']
        if sha(node) != manifest['nodeBinarySha256'] or sha(browser) != manifest['chromiumBinarySha256']:
            raise SigningError('Source runtimes do not match their recorded hashes.')
        cpu = 'x86_64' if arch == 'x64' else 'arm64'
        subprocess.run(['/usr/bin/xcrun', 'swiftc', '-swift-version', '5', '-O', '-target', cpu + '-apple-macosx14.0',
                        str(root / 'desktop/MacLauncher.swift'), '-o', str(contents / 'MacOS/TechResumeLauncher')], check=True)
        numeric_version = version.split('-')[0]
        (contents / 'Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': 'io.github.MoChiUaena.TechResumeKit', 'CFBundleName': 'Tech Resume Kit',
            'CFBundleDisplayName': '技术简历', 'CFBundleExecutable': 'TechResumeLauncher', 'CFBundlePackageType': 'APPL',
            'CFBundleShortVersionString': numeric_version, 'CFBundleVersion': numeric_version,
            'LSMinimumSystemVersion': '14.0', 'LSUIElement': True, 'NSHighResolutionCapable': True,
        }))
        with identity(mode, staging) as (signing_identity, keychain):
            count = sign_children(app, signing_identity, keychain, root / 'desktop/macos-entitlements.plist', mode)
            manifest['nodeBinarySha256'] = sha(node)
            manifest['chromiumBinarySha256'] = sha(browser)
            manifest_file.write_text(json.dumps(manifest, indent=2) + '\n')
            sign_app(app, signing_identity, keychain)
            request_id = notarize(app, staging) if mode == 'notarized' else None
        pending = staging / (name + '.zip')
        subprocess.run(['/usr/bin/ditto', '-c', '-k', '--keepParent', str(app), str(pending)], check=True)
        proof = {'version': version, 'arch': arch, 'mode': mode, 'bundleSignatureVerified': True, 'signedNativeFiles': count,
                 'developerId': mode == 'notarized', 'notarized': mode == 'notarized', 'notaryRequestId': request_id,
                 'gatekeeperAccepted': mode == 'notarized', 'archive': destination.name, 'sha256': sha(pending)}
        pending.replace(destination)
        (output / (name + '.signing.json')).write_text(json.dumps(proof, indent=2) + '\n')
        (output / (name + '.sha256')).write_text(proof['sha256'] + '  ' + destination.name + '\n')
        print(json.dumps(proof))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['adhoc', 'notarized'], default='adhoc')
    args = parser.parse_args()
    try:
        build(args.mode)
    except (SigningError, OSError, subprocess.CalledProcessError, ValueError, KeyError) as error:
        print('macOS app build failed: ' + (str(error) if not isinstance(error, subprocess.CalledProcessError) else 'Native build command failed.'), file=sys.stderr)
        sys.exit(1)
