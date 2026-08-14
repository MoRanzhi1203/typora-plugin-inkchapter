#Requires -Version 5.1
# forensic-file-collector.ps1 — file-backed JSONL audit collector (external black-box).
#
# Replaces CDP console collection. Read-only: it NEVER truncates a session log.
#
# Capabilities:
#   Get-R58AuditDir
#   Get-R58AuditFiles
#   Get-R58AuditByteLength
#   Read-R58AuditDeltaRaw
#   Wait-R58AuditFileLengthStable
#   Wait-R58AuditEvent
#   ConvertFrom-R58JsonLines
#   Test-R58JsonLinesValid
#   Get-R58AuditSessionIdentity
#   Resolve-R58CurrentAuditFile
#
# The heavy JSONL verdict parsing lives in trial-parser.js; this module only
# does file resolution, byte-offset windows, stability waits, and lightweight
# session-authority probing.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:R58Root = 'D:\TyporaPluginProjects\typora-plugin-inkchapter'
$script:R58Vault = Join-Path $script:R58Root 'test\vault'
$script:AuditDir = Join-Path $script:R58Vault '.typora\inkchapter\audit'

function Get-R58AuditDir {
    return $script:AuditDir
}

# List runtime-*.log files, newest first. Never picks by LastWriteTime alone for verdicts.
function Get-R58AuditFiles {
    if (-not (Test-Path -LiteralPath $script:AuditDir)) { return @() }
    return @(Get-ChildItem -LiteralPath $script:AuditDir -Filter 'runtime-*.log' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
}

# Current byte length of the audit file (the "byte offset" the runner records).
function Get-R58AuditByteLength {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    return (Get-Item -LiteralPath $Path).Length
}

# Read raw UTF-8 bytes in the half-open window [OffsetBefore, OffsetAfter).
function Read-R58AuditDeltaRaw {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [long]$OffsetBefore = 0,
        [long]$OffsetAfter = -1
    )
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $len = (Get-Item -LiteralPath $Path).Length
    if ($OffsetAfter -lt 0) { $OffsetAfter = $len }
    $start = [Math]::Max([long]0, $OffsetBefore)
    $end = [Math]::Min($OffsetAfter, $len)
    if ($end -le $start) { return '' }
    $count = [int]($end - $start)
    $bytes = New-Object byte[] $count
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        $null = $fs.Seek($start, [System.IO.SeekOrigin]::Begin)
        $null = $fs.Read($bytes, 0, $count)
    } finally {
        $fs.Close()
    }
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

# Read UTF-8 (no-BOM) lines explicitly — PowerShell 5.1 Get-Content without
# -Encoding UTF8 mangles multibyte JSON. This is the single UTF-8 line reader
# for the JSONL collector; never assume a BOM.
function Read-R58Utf8Lines {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
    return @([System.IO.File]::ReadLines($Path, $utf8))
}

# Parse a raw JSONL string into event objects. Parse failures become
# { __parseError = $true; __line = ... } so callers can count them.
function ConvertFrom-R58JsonLines {
    param([Parameter(Mandatory = $true)][string]$Text)
    $events = @()
    if ([string]::IsNullOrWhiteSpace($Text)) { return $events }
    foreach ($rawLine in ($Text -split "`r?`n")) {
        $line = $rawLine.Trim()
        if ($line -eq '') { continue }
        try {
            $events += ($line | ConvertFrom-Json)
        } catch {
            $events += [pscustomobject]@{ __parseError = $true; __line = $line }
        }
    }
    return $events
}

# Read a field from an event: top-level first, then payload.
function Get-R58EventField {
    param($Event, [string]$Name)
    if ($null -eq $Event) { return $null }
    if ($Event.PSObject.Properties.Name -contains $Name) { return $Event.$Name }
    if ($Event.PSObject.Properties.Name -contains 'payload') {
        $p = $Event.payload
        if ($null -ne $p -and ($p.PSObject.Properties.Name -contains $Name)) { return $p.$Name }
    }
    return $null
}

# Validate that every non-empty line parses. Returns structured audit.
function Test-R58JsonLinesValid {
    param([Parameter(Mandatory = $true)][string]$Path)
    $lineCount = 0
    $parseSuccess = 0
    $parseFailure = 0
    $buildIds = @{}
    $sessionIds = @{}
    $uniqueEvents = @{}
    $hasAny = $false

    if (Test-Path -LiteralPath $Path) {
        foreach ($rawLine in (Read-R58Utf8Lines -Path $Path)) {
            $line = $rawLine.Trim()
            if ($line -eq '') { continue }
            $lineCount++
            $hasAny = $true
            try {
                $ev = $line | ConvertFrom-Json
                $parseSuccess++
                if ($null -ne $ev.event) { $uniqueEvents[$ev.event] = $true }
                if ($null -ne $ev.buildId) { $buildIds[$ev.buildId] = $true }
                if ($null -ne $ev.sessionId) { $sessionIds[$ev.sessionId] = $true }
            } catch {
                $parseFailure++
            }
        }
    }

    return [pscustomobject]@{
        path = $Path
        lineCount = $lineCount
        parseSuccessCount = $parseSuccess
        parseFailureCount = $parseFailure
        uniqueEvents = @($uniqueEvents.Keys | Sort-Object)
        buildIds = @($buildIds.Keys | Sort-Object)
        sessionIds = @($sessionIds.Keys | Sort-Object)
        hasAnyLine = $hasAny
        overall = ($parseFailure -eq 0 -and $lineCount -gt 0)
    }
}

# Extract session identity from a single audit file.
function Get-R58AuditSessionIdentity {
    param([Parameter(Mandatory = $true)][string]$Path)
    $ready = $null
    $identity = $null
    $events = @()
    $parseFail = 0

    if (Test-Path -LiteralPath $Path) {
        foreach ($rawLine in (Read-R58Utf8Lines -Path $Path)) {
            $line = $rawLine.Trim()
            if ($line -eq '') { continue }
            try {
                $ev = $line | ConvertFrom-Json
            } catch {
                $parseFail++
                continue
            }
            $events += $ev.event
            if ($ev.event -eq 'FORENSIC-SINK-READY') { $ready = $ev }
            if ($ev.event -eq 'RUNTIME-IDENTITY-FINAL' -and $null -eq $identity) { $identity = $ev }
        }
    }

    return [pscustomobject]@{
        auditPath = $Path
        auditSessionId = if ($ready) { $ready.sessionId } else { $null }
        buildId = if ($ready) { $ready.buildId } else { $null }
        readyFound = ($null -ne $ready)
        identityFound = ($null -ne $identity)
        initializationCount = if ($identity) { Get-R58EventField -Event $identity -Name 'initializationCount' } else { $null }
        activeDoc = if ($identity) { Get-R58EventField -Event $identity -Name 'activeDoc' } else { $null }
        vaultRoot = if ($identity) { Get-R58EventField -Event $identity -Name 'vaultRoot' } else { $null }
        parseFailureCount = $parseFail
        uniqueEvents = @($events | Sort-Object -Unique)
    }
}

# Resolve the current-session audit file with full authority (never guess).
function Resolve-R58CurrentAuditFile {
    param(
        [Parameter(Mandatory = $true)][datetime]$SinceTime,
        [string]$BuildId = 'inkchapter-r58-7-file-backed-audit-sink-fbas8k3q',
        [string]$TargetDoc = ''
    )
    $results = @()
    foreach ($f in (Get-R58AuditFiles)) {
        if ($f.LastWriteTime -lt $SinceTime) { continue }

        $id = Get-R58AuditSessionIdentity -Path $f.FullName
        $readyFound = $id.readyFound
        $identityFound = $id.identityFound
        $buildOk = $readyFound -and ($id.buildId -eq $BuildId)
        $initOk = $identityFound -and ($id.initializationCount -eq 1)

        $docOk = $true
        if ($TargetDoc -ne '') {
            $docOk = ($null -ne $id.activeDoc) -and ([string]$id.activeDoc -like "*$TargetDoc*")
        }

        $decision = if ($readyFound -and $buildOk -and $identityFound -and $initOk -and $docOk -and $id.parseFailureCount -eq 0) { 'ACCEPT' } else { 'REJECT' }

        $results += [pscustomobject]@{
            auditPath = $f.FullName
            auditSessionId = $id.auditSessionId
            buildId = $id.buildId
            targetDoc = $TargetDoc
            newTyporaStartTime = $SinceTime
            fileLastWriteTime = $f.LastWriteTime
            readyFound = $readyFound
            identityFound = $identityFound
            initializationCount = $id.initializationCount
            activeDoc = $id.activeDoc
            parseFailureCount = $id.parseFailureCount
            decision = $decision
        }
    }
    return $results
}

# Wait until the audit file length stays unchanged for StableCount consecutive reads.
function Wait-R58AuditFileLengthStable {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$StableCount = 3,
        [int]$IntervalMs = 400,
        [int]$TimeoutMs = 15000
    )
    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    $stable = 0
    $last = -1
    do {
        Start-Sleep -Milliseconds $IntervalMs
        $len = if (Test-Path -LiteralPath $Path) { (Get-Item -LiteralPath $Path).Length } else { -1 }
        if ($len -eq $last) {
            $stable++
        } else {
            $stable = 1
            $last = $len
        }
        if ($stable -ge $StableCount) { return $true }
    } while ((Get-Date) -lt $deadline)
    return $false
}

# Wait until one of the target events appears in the delta after OffsetBefore.
function Wait-R58AuditEvent {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [long]$OffsetBefore = 0,
        [Parameter(Mandatory = $true)][string[]]$EventNames,
        [int]$TimeoutMs = 20000,
        [int]$IntervalMs = 400
    )
    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    do {
        Start-Sleep -Milliseconds $IntervalMs
        if (-not (Test-Path -LiteralPath $Path)) { continue }
        $len = (Get-Item -LiteralPath $Path).Length
        if ($len -le $OffsetBefore) { continue }
        $delta = Read-R58AuditDeltaRaw -Path $Path -OffsetBefore $OffsetBefore -OffsetAfter $len
        foreach ($ev in (ConvertFrom-R58JsonLines -Text $delta)) {
            if (($ev.PSObject.Properties.Name -contains 'event') -and ($EventNames -contains $ev.event)) { return $ev }
        }
    } while ((Get-Date) -lt $deadline)
    return $null
}
