<#
.SYNOPSIS
  Create your own Ubuntu server VM on Windows with Multipass.

.DESCRIPTION
  Installs Multipass (and VirtualBox on Windows Home) if needed, then launches
  an Ubuntu 24.04 VM set up by cloud-init.yaml (git, Python, Node.js, Docker).
  Run from this folder in an Administrator PowerShell:

    powershell -ExecutionPolicy Bypass -File .\create-vm.ps1

.EXAMPLE
  .\create-vm.ps1 -Name devbox -Cpus 4 -Memory 8G -Disk 60G
#>
[CmdletBinding()]
param(
    [string]$Name = "devbox",
    [int]$Cpus = 2,
    [string]$Memory = "4G",
    [string]$Disk = "30G",
    [string]$Image = "24.04",
    [string]$ShareFolder = "$env:USERPROFILE\vm-share"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# --- 1. Admin check -----------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Please run this in PowerShell opened with 'Run as administrator'." -ForegroundColor Yellow
    exit 1
}

# --- 2. Virtualization check --------------------------------------------------
Write-Step "Checking that virtualization is turned on"
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$hypervisorRunning = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
if (-not $hypervisorRunning -and -not $cpu.VirtualizationFirmwareEnabled) {
    Write-Host "Virtualization is OFF in your BIOS/UEFI. Restart, open BIOS setup and enable" -ForegroundColor Red
    Write-Host "Intel VT-x / AMD-V (often called 'SVM Mode'), then run this script again." -ForegroundColor Red
    exit 1
}

# --- 3. Pick a driver: Hyper-V (Pro/Enterprise/Education) or VirtualBox (Home) -
$edition = (Get-CimInstance Win32_OperatingSystem).Caption
$isHome = $edition -match "Home"
$driver = if ($isHome) { "virtualbox" } else { "hyperv" }
Write-Step "Windows edition: $edition -> using the $driver driver"

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "winget not found. Install 'App Installer' from the Microsoft Store, then re-run." -ForegroundColor Red
    exit 1
}

if ($driver -eq "hyperv") {
    $hv = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
    if ($hv.State -ne "Enabled") {
        Write-Step "Enabling Hyper-V (a restart is required afterwards)"
        Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -All -NoRestart | Out-Null
        Write-Host "Hyper-V enabled. Restart Windows, then run this script again." -ForegroundColor Yellow
        exit 0
    }
} else {
    if (-not (Test-Path "$env:ProgramFiles\Oracle\VirtualBox\VBoxManage.exe")) {
        Write-Step "Installing VirtualBox"
        winget install --id Oracle.VirtualBox -e --accept-package-agreements --accept-source-agreements
    }
}

# --- 4. Install Multipass -----------------------------------------------------
$multipass = "$env:ProgramFiles\Multipass\bin\multipass.exe"
if (-not (Test-Path $multipass)) {
    Write-Step "Installing Multipass"
    winget install --id Canonical.Multipass -e --accept-package-agreements --accept-source-agreements
    Write-Step "Waiting for the Multipass service to start"
    Start-Sleep -Seconds 20
}
if (-not (Test-Path $multipass)) {
    Write-Host "Multipass did not install to $multipass. Install it from https://canonical.com/multipass and re-run." -ForegroundColor Red
    exit 1
}

& $multipass set local.driver=$driver
& $multipass set local.privileged-mounts=true

# --- 5. Launch the VM ---------------------------------------------------------
$existing = & $multipass list --format csv | Select-String -Pattern "^$Name,"
if ($existing) {
    Write-Step "A VM named '$Name' already exists - starting it"
    & $multipass start $Name
} else {
    $cloudInit = Join-Path $PSScriptRoot "cloud-init.yaml"
    Write-Step "Launching '$Name' (Ubuntu $Image, $Cpus CPUs, $Memory RAM, $Disk disk). First boot takes 5-15 minutes."
    & $multipass launch $Image --name $Name --cpus $Cpus --memory $Memory --disk $Disk `
        --cloud-init $cloudInit --timeout 1800
    if ($LASTEXITCODE -ne 0) { Write-Host "Launch failed. See vm\README.md > Troubleshooting." -ForegroundColor Red; exit 1 }
}

# --- 6. Shared folder ---------------------------------------------------------
New-Item -ItemType Directory -Force -Path $ShareFolder | Out-Null
Write-Step "Sharing $ShareFolder -> /home/ubuntu/share"
& $multipass mount $ShareFolder "${Name}:/home/ubuntu/share" 2>$null

# --- 7. Done ------------------------------------------------------------------
& $multipass info $Name
Write-Host ""
Write-Host "Your VM '$Name' is ready." -ForegroundColor Green
Write-Host "  Open a terminal in it:   multipass shell $Name"
Write-Host "  Shared folder:           $ShareFolder  <->  /home/ubuntu/share"
if ($driver -eq "hyperv") {
    Write-Host "  Servers in the VM:       http://<IPv4 above>:3000  (from your Windows browser)"
} else {
    Write-Host "  Servers in the VM:       see vm\README.md > 'Windows Home: reaching servers'"
}
