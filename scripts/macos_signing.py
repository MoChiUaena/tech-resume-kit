"""Sign an owned staged app; production mode also requires accepted notarization."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile

class SigningError(RuntimeError):
    pass

def run(arguments, operation):
    result = subprocess.run(arguments, capture_output=True, text=True)
    if result.returncode:
        # security import accepts a password argument; never expose subprocess arguments.
        raise SigningError(f'{operation} failed (exit {result.returncode}).')
    return result.stdout

def required_environment():
    names = ['TECH_RESUME_MAC_CERT_PATH', 'TECH_RESUME_MAC_CERT_PASSWORD', 'TECH_RESUME_MAC_CERT_SHA1',
             'APPLE_TEAM_ID', 'APPLE_API_KEY_PATH', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID']
    missing = [name for name in names if not os.environ.get(name)]
    if missing:
        raise SigningError('Missing signing configuration: ' + ', '.join(missing))
    if not re.fullmatch(r'[0-9A-Fa-f]{40}', os.environ['TECH_RESUME_MAC_CERT_SHA1']):
        raise SigningError('TECH_RESUME_MAC_CERT_SHA1 must be a certificate SHA-1 fingerprint.')
    if not re.fullmatch(r'[A-Z0-9]{10}', os.environ['APPLE_TEAM_ID']):
        raise SigningError('APPLE_TEAM_ID must contain ten letters/digits.')
    for name in ['TECH_RESUME_MAC_CERT_PATH', 'APPLE_API_KEY_PATH']:
        if not Path(os.environ[name]).is_file():
            raise SigningError(name + ' is not a readable file.')

@contextmanager
def identity(mode, staging):
    if mode == 'adhoc':
        yield '-', None
        return
    required_environment()
    with tempfile.TemporaryDirectory(prefix='signing-keychain-', dir=staging) as private:
        keychain = str(Path(private) / 'build.keychain-db')
        password = secrets.token_urlsafe(32)
        created = False
        try:
            run(['/usr/bin/security', 'create-keychain', '-p', password, keychain], 'Temporary keychain creation')
            created = True
            run(['/usr/bin/security', 'set-keychain-settings', '-lut', '21600', keychain], 'Keychain settings')
            run(['/usr/bin/security', 'unlock-keychain', '-p', password, keychain], 'Keychain unlock')
            run(['/usr/bin/security', 'import', os.environ['TECH_RESUME_MAC_CERT_PATH'], '-k', keychain,
                 '-P', os.environ['TECH_RESUME_MAC_CERT_PASSWORD'], '-T', '/usr/bin/codesign'], 'Certificate import')
            run(['/usr/bin/security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain], 'Key access configuration')
            identities = run(['/usr/bin/security', 'find-identity', '-v', '-p', 'codesigning', keychain], 'Certificate lookup')
            fingerprint = os.environ['TECH_RESUME_MAC_CERT_SHA1'].upper()
            if not any(fingerprint in line.upper() and 'Developer ID Application:' in line and '(' + os.environ['APPLE_TEAM_ID'] + ')' in line for line in identities.splitlines()):
                raise SigningError('Expected Developer ID Application certificate and team were not found.')
            yield fingerprint, keychain
        finally:
            if created:
                run(['/usr/bin/security', 'delete-keychain', keychain], 'Temporary keychain removal')

def nested_code(app):
    root = app.resolve()
    files = []
    for file in app.rglob('*'):
        if file.is_symlink():
            if not file.resolve().is_relative_to(root):
                raise SigningError('App has a symlink outside its bundle.')
            continue
        if not file.is_file():
            continue
        with file.open('rb') as stream:
            magic = stream.read(4)
        if magic in [b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf']:
            if 'Mach-O' in run(['/usr/bin/file', '-b', str(file)], 'Executable inspection'):
                files.append(file)
    return sorted(files, key=lambda file: (-len(file.parts), str(file)))

def sign_children(app, signing_identity, keychain, entitlements, mode):
    code = nested_code(app)
    if not code:
        raise SigningError('App contains no native executables.')
    for file in code:
        arguments = ['/usr/bin/codesign', '--force', '--sign', signing_identity]
        if keychain:
            arguments += ['--keychain', keychain, '--timestamp', '--options', 'runtime']
        else:
            arguments += ['--timestamp=none']
        if file.name in {'node', 'chrome-headless-shell'}:
            arguments += ['--entitlements', str(entitlements)]
        run(arguments + [str(file)], 'Nested code signing')
    bundles = sorted((file for file in app.rglob('*') if file.is_dir() and not file.is_symlink() and file.suffix in {'.app', '.framework'}), key=lambda file: -len(file.parts))
    for bundle in bundles:
        arguments = ['/usr/bin/codesign', '--force', '--sign', signing_identity]
        arguments += ['--keychain', keychain, '--timestamp', '--options', 'runtime'] if keychain else ['--timestamp=none']
        run(arguments + [str(bundle)], 'Nested bundle signing')
    return len(code)

def sign_app(app, signing_identity, keychain):
    arguments = ['/usr/bin/codesign', '--force', '--sign', signing_identity]
    arguments += ['--keychain', keychain, '--timestamp', '--options', 'runtime'] if keychain else ['--timestamp=none']
    run(arguments + [str(app)], 'App signing')
    verify_app(app)
    if keychain:
        details = subprocess.run(['/usr/bin/codesign', '-dv', '--verbose=4', str(app)], capture_output=True, text=True)
        if details.returncode or 'TeamIdentifier=' + os.environ['APPLE_TEAM_ID'] not in details.stderr:
            raise SigningError('Signed app team does not match the configured team.')

def verify_app(app):
    run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], 'App signature verification')

def notarize(app, staging):
    upload = Path(staging) / 'notarization.zip'
    run(['/usr/bin/ditto', '-c', '-k', '--keepParent', str(app), str(upload)], 'Notarization archive creation')
    state = json.loads(run(['/usr/bin/xcrun', 'notarytool', 'submit', str(upload), '--key', os.environ['APPLE_API_KEY_PATH'],
                      '--key-id', os.environ['APPLE_API_KEY_ID'], '--issuer', os.environ['APPLE_API_ISSUER_ID'],
                      '--wait', '--timeout', '20m', '--output-format', 'json'], 'Apple notarization'))
    if state.get('status') != 'Accepted' or not state.get('id'):
        raise SigningError('Apple did not accept the notarization submission; no distributable archive was created.')
    run(['/usr/bin/xcrun', 'stapler', 'staple', str(app)], 'Notarization ticket stapling')
    run(['/usr/bin/xcrun', 'stapler', 'validate', str(app)], 'Notarization ticket verification')
    verify_app(app)
    run(['/usr/sbin/spctl', '--assess', '--type', 'execute', '--verbose=2', str(app)], 'Gatekeeper assessment')
    return state['id']
