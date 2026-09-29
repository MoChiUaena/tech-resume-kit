"""Seal and inspect locally built app resources without certificates or accounts."""
from pathlib import Path
import subprocess

class BundleError(RuntimeError):
    pass

def run(arguments, operation):
    result = subprocess.run(arguments, capture_output=True, text=True)
    if result.returncode:
        raise BundleError(f'{operation} failed (exit {result.returncode}).')
    return result.stdout

def nested_code(app):
    root = app.resolve()
    files = []
    for file in app.rglob('*'):
        if file.is_symlink():
            if not file.resolve().is_relative_to(root):
                raise BundleError('App has a symlink outside its bundle.')
            continue
        if not file.is_file():
            continue
        with file.open('rb') as stream:
            magic = stream.read(4)
        if magic in [b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf']:
            if 'Mach-O' in run(['/usr/bin/file', '-b', str(file)], 'Executable inspection'):
                files.append(file)
    return sorted(files, key=lambda file: (-len(file.parts), str(file)))

def seal_children(app, entitlements):
    code = nested_code(app)
    if not code:
        raise BundleError('App contains no native executables.')
    for file in code:
        arguments = ['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none']
        if file.name in {'node', 'chrome-headless-shell'}:
            arguments += ['--entitlements', str(entitlements)]
        run(arguments + [str(file)], 'Native resource sealing')
    bundles = sorted((file for file in app.rglob('*') if file.is_dir() and not file.is_symlink() and file.suffix in {'.app', '.framework'}), key=lambda file: -len(file.parts))
    for bundle in bundles:
        run(['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none', str(bundle)], 'Nested resource sealing')
    return len(code)

def seal_app(app):
    run(['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none', str(app)], 'App resource sealing')
    run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], 'App resource integrity verification')
