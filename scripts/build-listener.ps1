param(
    [switch]$Install,
    [switch]$Debug,
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$AndroidHome = $env:ANDROID_HOME
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repo 'apps\listener'

function Find-Jdk {
    param([string]$Preferred)
    if ($Preferred -and (Test-Path (Join-Path $Preferred 'bin\java.exe'))) { return $Preferred }
    $candidates = @("$env:ProgramFiles\Android\Android Studio\jbr")
    foreach ($base in @("$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Microsoft", "$env:ProgramFiles\Java", "$env:ProgramFiles\Amazon Corretto", "$env:ProgramFiles\Zulu", "$env:LOCALAPPDATA\Programs\Eclipse Adoptium")) {
        if (Test-Path $base) {
            $candidates += Get-ChildItem $base -Directory | Where-Object { $_.Name -match 'jdk' } | ForEach-Object { $_.FullName }
        }
    }
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c 'bin\java.exe')) { return $c }
    }
    return $null
}

function Find-Sdk {
    param([string]$Preferred)
    if ($Preferred -and (Test-Path $Preferred)) { return $Preferred }
    foreach ($c in @($env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk")) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

$jdk = Find-Jdk -Preferred $JavaHome
if (-not $jdk) {
    Write-Error "No JDK found. Install Android Studio or a JDK 17+ and pass -JavaHome."
}
$sdk = Find-Sdk -Preferred $AndroidHome
if (-not $sdk) {
    Write-Error "No Android SDK found. Install Android Studio or pass -AndroidHome."
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:PATH = "$jdk\bin;$env:PATH"

Write-Host "JDK        : $jdk"
Write-Host "Android SDK: $sdk"
Write-Host "Project    : $project"

$localProps = Join-Path $project 'local.properties'
$sdkForProps = $sdk -replace '\\', '\\' -replace ':', '\:'
Set-Content -Path $localProps -Value "sdk.dir=$sdkForProps" -Encoding ascii

$task = if ($Debug) { 'assembleDebug' } else { 'assembleRelease' }
$started = Get-Date
Push-Location $project
try {
    & .\gradlew.bat --no-daemon $task
    if ($LASTEXITCODE -ne 0) { throw "gradle $task failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
$elapsed = (Get-Date) - $started

$variant = if ($Debug) { 'debug' } else { 'release' }
$apk = Get-ChildItem (Join-Path $project "app\build\outputs\apk\$variant") -Filter '*.apk' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) { throw "APK not found under app\build\outputs\apk\$variant" }
Write-Host ""
Write-Host "APK: $($apk.FullName)" -ForegroundColor Green
Write-Host ("Build took {0:mm\:ss}" -f $elapsed)

if ($Install) {
    $adb = Join-Path $sdk 'platform-tools\adb.exe'
    if (-not (Test-Path $adb)) { $adb = 'adb' }
    & $adb install -r $apk.FullName
    if ($LASTEXITCODE -ne 0) { throw "adb install failed" }
    Write-Host "Installed on the connected device." -ForegroundColor Green
}
