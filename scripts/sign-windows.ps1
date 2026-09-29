[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$File, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$importedThumbprints = @()
try {
    $target = (Resolve-Path -LiteralPath $File).Path
    if ([IO.Path]::GetExtension($target) -ne '.exe') { throw 'Signing accepts an EXE file only.' }
    $expected = ($env:TECH_RESUME_WIN_CERT_THUMBPRINT -replace '\s', '').ToUpperInvariant()
    if ($expected -notmatch '^[0-9A-F]{40}$') { throw 'Set TECH_RESUME_WIN_CERT_THUMBPRINT to the expected signing certificate.' }
    $signtool = $env:TECH_RESUME_SIGNTOOL
    if (-not $signtool) {
        $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
        if ($command) { $signtool = $command.Source }
        else {
            $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
            if (Test-Path -LiteralPath $sdk) {
                $candidate = Get-ChildItem -LiteralPath $sdk -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'x64/signtool.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
                if ($candidate) { $signtool = $candidate }
            }
        }
    }
    if (-not $signtool -or -not (Test-Path -LiteralPath $signtool -PathType Leaf)) { throw 'Install Windows SDK SignTool, or set TECH_RESUME_SIGNTOOL.' }
    if ((Get-AuthenticodeSignature -LiteralPath $signtool).Status -ne 'Valid') { throw 'SignTool itself must have a valid trusted signature.' }
    if (-not $VerifyOnly) {
        $certificatePath = 'Cert:\CurrentUser\My\' + $expected
        if ($env:TECH_RESUME_WIN_CERT_PATH) {
            if (Test-Path -LiteralPath $certificatePath) { throw 'Certificate is already installed; omit TECH_RESUME_WIN_CERT_PATH to use it without importing.' }
            $password = ConvertTo-SecureString -String $env:TECH_RESUME_WIN_CERT_PASSWORD -AsPlainText -Force
            $pfx = Get-PfxData -FilePath $env:TECH_RESUME_WIN_CERT_PATH -Password $password
            $leaf = @($pfx.EndEntityCertificates | Where-Object { $_.Thumbprint -eq $expected })
            if ($leaf.Count -ne 1) { throw 'PFX signing certificate does not match the configured thumbprint.' }
            $all = @((@($pfx.EndEntityCertificates) + @($pfx.OtherCertificates)) | Where-Object { $_ -and $_.Thumbprint })
            foreach ($cert in $all) {
                if (Test-Path -LiteralPath ('Cert:\CurrentUser\My\' + $cert.Thumbprint)) { throw 'PFX contains an existing certificate; use an installed signing certificate instead.' }
            }
            # Keep track before import so partial imports are also removed on failure.
            $importedThumbprints = @($all | ForEach-Object { $_.Thumbprint })
            $null = Import-PfxCertificate -FilePath $env:TECH_RESUME_WIN_CERT_PATH -Password $password -CertStoreLocation 'Cert:\CurrentUser\My'
        }
        if (-not (Test-Path -LiteralPath $certificatePath)) { throw 'Expected certificate is not installed in CurrentUser/My.' }
        $certificate = Get-Item -LiteralPath $certificatePath
        if (-not $certificate.HasPrivateKey) { throw 'Signing certificate has no accessible private key.' }
        if ($certificate.NotBefore -gt (Get-Date) -or $certificate.NotAfter -le (Get-Date)) { throw 'Signing certificate is outside its validity period.' }
        $usage = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' } | ForEach-Object { $_.EnhancedKeyUsages } | ForEach-Object { $_.Value })
        if ('1.3.6.1.5.5.7.3.3' -notin $usage) { throw 'Certificate does not allow code signing.' }
        $timestamp = $env:TECH_RESUME_WIN_TIMESTAMP
        if (-not $timestamp) { $timestamp = 'https://timestamp.digicert.com' }
        $uri = [Uri]$timestamp
        if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https') { throw 'Timestamp server must use HTTPS.' }
        $null = & $signtool sign /fd SHA256 /sha1 $expected /s My /tr $timestamp /td SHA256 /d 'Tech Resume Kit' $target 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'SignTool signing failed; no distributable package was created.' }
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $target
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $expected) { throw 'EXE signature is invalid, untrusted, or from a different certificate.' }
    if (-not $signature.TimeStamperCertificate) { throw 'EXE is missing a verified timestamp.' }
    $null = & $signtool verify /pa /all /tw $target 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'SignTool verification failed.' }
    [ordered]@{
        state = 'verified'; authenticode = $true; timestamped = $true
        signerThumbprint = $expected; timestampThumbprint = $signature.TimeStamperCertificate.Thumbprint
        launcherSha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    } | ConvertTo-Json -Compress
} catch {
    # Do not include native tool arguments, PFX details or passwords in build logs.
    Write-Error ('Windows signing failed: ' + $_.Exception.Message) -ErrorAction Continue
    exit 1
} finally {
    foreach ($thumbprint in $importedThumbprints) {
        $path = 'Cert:\CurrentUser\My\' + $thumbprint
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -DeleteKey -Force }
    }
}
