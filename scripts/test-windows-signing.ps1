$ErrorActionPreference = 'Stop'
$taskRoot = Join-Path ([IO.Path]::GetTempPath()) ('tech-resume-signing-' + [Guid]::NewGuid().ToString('N'))
$createdCertificate = $null
$previousThumbprint = $env:TECH_RESUME_WIN_CERT_THUMBPRINT
$previousPath = $env:TECH_RESUME_WIN_CERT_PATH
$previousTool = $env:TECH_RESUME_SIGNTOOL
function Expect-Rejection([string[]]$Arguments) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Get-Command pwsh).Source
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEnd(); $stderr = $process.StandardError.ReadToEnd(); $process.WaitForExit()
    if ($process.ExitCode -eq 0 -or $stdout -match '"state"\s*:\s*"verified"') { throw 'Untrusted or missing credentials were accepted.' }
}
try {
    $null = New-Item -ItemType Directory -Path $taskRoot
    $source = Join-Path $taskRoot 'probe.cs'; $executable = Join-Path $taskRoot 'probe.exe'
    [IO.File]::WriteAllText($source, 'class Probe { static void Main() {} }')
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $null = & $compiler /nologo /target:exe "/out:$executable" $source
    if ($LASTEXITCODE -ne 0) { throw 'Signing test compile failed.' }
    $signer = Join-Path $PSScriptRoot 'sign-windows.ps1'
    $original = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash
    $env:TECH_RESUME_WIN_CERT_PATH = ''
    $env:TECH_RESUME_WIN_CERT_THUMBPRINT = ''
    Expect-Rejection @('-NoProfile', '-File', $signer, '-File', $executable)
    $env:TECH_RESUME_WIN_CERT_THUMBPRINT = '0000000000000000000000000000000000000000'
    Expect-Rejection @('-NoProfile', '-File', $signer, '-File', $executable, '-VerifyOnly')
    if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ne $original) { throw 'Rejected signing changed the executable.' }
    if ($env:GITHUB_ACTIONS -eq 'true') {
        $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
        $tool = Get-ChildItem -LiteralPath $sdk -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'x64/signtool.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $tool -or (Get-AuthenticodeSignature -LiteralPath $tool).Status -ne 'Valid') { throw 'Native signing tests require trusted Windows SDK SignTool.' }
        $env:TECH_RESUME_SIGNTOOL = $tool
        $createdCertificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject ('CN=TechResumeKit-CI-' + [Guid]::NewGuid().ToString('N')) -CertStoreLocation 'Cert:\CurrentUser\My'
        $createdCertificate = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $createdCertificate.Thumbprint)
        $null = Set-AuthenticodeSignature -LiteralPath $executable -Certificate $createdCertificate -HashAlgorithm SHA256
        $env:TECH_RESUME_WIN_CERT_THUMBPRINT = $createdCertificate.Thumbprint
        Expect-Rejection @('-NoProfile', '-File', $signer, '-File', $executable, '-VerifyOnly')
        $bytes = [IO.File]::ReadAllBytes($executable); $bytes[80] = $bytes[80] -bxor 1; [IO.File]::WriteAllBytes($executable, $bytes)
        Expect-Rejection @('-NoProfile', '-File', $signer, '-File', $executable, '-VerifyOnly')
    }
    Write-Output 'Windows signing: missing credentials and unsigned output are rejected; the original file is preserved.'
    if ($env:GITHUB_ACTIONS -eq 'true') { Write-Output 'Native SDK verification also rejects self-signed certificates and tampered EXEs.' }
} finally {
    $env:TECH_RESUME_WIN_CERT_THUMBPRINT = $previousThumbprint; $env:TECH_RESUME_WIN_CERT_PATH = $previousPath
    $env:TECH_RESUME_SIGNTOOL = $previousTool
    if ($createdCertificate) { Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $createdCertificate.Thumbprint) -DeleteKey -Force }
    if (Test-Path -LiteralPath $taskRoot) {
        $resolved = (Resolve-Path -LiteralPath $taskRoot).Path
        if (-not $resolved.Equals([IO.Path]::GetFullPath($taskRoot), [StringComparison]::OrdinalIgnoreCase) -or -not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe signing test cleanup path.' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
