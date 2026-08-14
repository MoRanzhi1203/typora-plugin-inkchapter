#Requires -Version 5.1
# fixture-manager.ps1 — fixture reset / detection / B1 seed fixtures (external black-box)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:Root = 'D:\TyporaPluginProjects\typora-plugin-inkchapter'
$script:Vault = Join-Path $script:Root 'test\vault'
$script:DotTypora = Join-Path $script:Vault '.typora'
$script:SidecarDir = Join-Path $script:DotTypora 'inkchapter\paragraph-layout'

function Get-R58FixturePath {
    param([Parameter(Mandatory = $true)][string]$FixtureName)
    return Join-Path $script:Vault $FixtureName
}

function Get-R58SidecarPath {
    param([Parameter(Mandatory = $true)][string]$FixtureName)
    return Join-Path $script:SidecarDir ($FixtureName + '.json')
}

function Get-R58FixtureState {
    param([Parameter(Mandatory = $true)][string]$FixtureName)
    $f = Get-R58FixturePath -FixtureName $FixtureName
    $s = Get-R58SidecarPath -FixtureName $FixtureName
    $fixtureExists = Test-Path -LiteralPath $f
    $sidecarExists = Test-Path -LiteralPath $s
    $recordCount = 0
    if ($sidecarExists) {
        try {
            $j = Get-Content -LiteralPath $s -Raw | ConvertFrom-Json
            if ($null -ne $j.paragraphOverrides) { $recordCount = $j.paragraphOverrides.Count }
            elseif ($null -ne $j.records) { $recordCount = $j.records.Count }
            else { $recordCount = -1 }
        } catch { $recordCount = -1 }
    }
    return [pscustomobject]@{
        fixtureName = $FixtureName
        fixturePath = $f
        fixtureExists = $fixtureExists
        sidecarPath = $s
        sidecarExists = $sidecarExists
        recordCount = $recordCount
    }
}

# Create a minimal empty fixture (refuse if sidecar already exists).
function New-R58EmptyFixture {
    param([Parameter(Mandatory = $true)][string]$FixtureName)
    $f = Get-R58FixturePath -FixtureName $FixtureName
    $s = Get-R58SidecarPath -FixtureName $FixtureName
    if (Test-Path -LiteralPath $s) {
        throw "Refusing to create fixture with existing sidecar: $s"
    }
    Set-Content -LiteralPath $f -Value "" -Encoding UTF8
    return $f
}

# Reset the named A1 fixtures (delete fixture + sidecar, then recreate empty).
# Only deletes r58-caret-a1-fresh-XX files; never touches app-*.log / runtime-load / dist.
function Reset-R58A1Fixtures {
    param([string[]]$FixtureNames)
    $results = @()
    foreach ($n in $FixtureNames) {
        $f = Get-R58FixturePath -FixtureName $n
        $s = Get-R58SidecarPath -FixtureName $n
        if (-not $n.StartsWith('r58-caret-a1-fresh-')) {
            $results += [pscustomobject]@{ fixture = $n; action = 'SKIP_NOT_FRESH'; ok = $false }
            continue
        }
        if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }
        if (Test-Path -LiteralPath $s) { Remove-Item -LiteralPath $s -Force }
        Set-Content -LiteralPath $f -Value "" -Encoding UTF8
        $results += [pscustomobject]@{ fixture = $n; action = 'RESET'; ok = $true }
    }
    return $results
}

# Reset the disposable smoke fixture (delete fixture + sidecar, recreate empty).
# Only touches the named smoke fixture + its sidecar; never touches audit logs.
function Reset-R58SmokeFixture {
    param([string]$FixtureName = 'r58-automation-input-smoke.md')
    $f = Get-R58FixturePath -FixtureName $FixtureName
    $s = Get-R58SidecarPath -FixtureName $FixtureName
    if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }
    if (Test-Path -LiteralPath $s) { Remove-Item -LiteralPath $s -Force }
    Set-Content -LiteralPath $f -Value "" -Encoding UTF8
    return [pscustomobject]@{ fixture = $FixtureName; action = 'RESET'; ok = $true }
}

# Seed a legal physical sidecar for a B1 historical fixture.
# Creates the fixture (if missing) + one PERSISTED_HISTORICAL-compatible record.
function Invoke-R58B1Seed {
    param([Parameter(Mandatory = $true)][string]$FixtureName)
    $f = Get-R58FixturePath -FixtureName $FixtureName
    $s = Get-R58SidecarPath -FixtureName $FixtureName

    if (-not (Test-Path -LiteralPath $f)) {
        Set-Content -LiteralPath $f -Value "历史段落" -Encoding UTF8
    }

    if (Test-Path -LiteralPath $s) {
        $existing = Get-R58FixtureState -FixtureName $FixtureName
        return [pscustomobject]@{ fixture = $FixtureName; sidecarExists = $true; recordCount = $existing.recordCount; action = 'ALREADY_SEEDED' }
    }

    $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $doc = [pscustomobject]@{
        schemaVersion = 1
        documentPath = $f
        updatedAt = $now
        paragraphOverrides = @(
            [pscustomobject]@{
                id = ("indent-$now-0")
                mode = 'force-indent'
                anchor = [pscustomobject]@{ lastKnownOrdinal = 0 }
                temporary = $true
            }
        )
    }
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $s) -Force
    $doc | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $s -Encoding UTF8

    return [pscustomobject]@{ fixture = $FixtureName; sidecarExists = $true; recordCount = 1; action = 'SEEDED' }
}
