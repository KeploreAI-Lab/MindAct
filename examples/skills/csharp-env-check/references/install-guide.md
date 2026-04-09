# .NET SDK Install Guide

Use this when `dotnet` is not found on the user's machine, or when they need to install a specific version.

---

## Windows

### Option A — winget (Windows 10/11, recommended)
```powershell
# Install .NET 8 SDK
winget install Microsoft.DotNet.SDK.8

# Install .NET 7 SDK
winget install Microsoft.DotNet.SDK.7

# Verify
dotnet --list-sdks
```

### Option B — Direct download
1. Go to https://dotnet.microsoft.com/download
2. Choose SDK (not Runtime) for your version
3. Download the `.exe` installer
4. Run installer, then open a new terminal
5. Verify: `dotnet --version`

### Option C — Chocolatey
```powershell
choco install dotnet-8.0-sdk   # .NET 8
choco install dotnet-7.0-sdk   # .NET 7
```

---

## Linux (Ubuntu / Debian)

```bash
# .NET 8
wget https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb
sudo dpkg -i packages-microsoft-prod.deb
sudo apt update
sudo apt install -y dotnet-sdk-8.0

# .NET 7
sudo apt install -y dotnet-sdk-7.0

# Verify
dotnet --list-sdks
```

---

## macOS

```bash
# Using Homebrew
brew install --cask dotnet-sdk   # installs latest LTS (.NET 8)

# Or specific version
brew install --cask dotnet@8
brew install --cask dotnet@7

# Verify
dotnet --list-sdks
```

---

## Side-by-Side Versions

Multiple .NET SDKs can coexist on the same machine. Use `global.json` to pin a project to a specific version:

```json
{
  "sdk": {
    "version": "7.0.410",
    "rollForward": "latestMinor"
  }
}
```

Place `global.json` in the project root. `dotnet --version` in that directory will then report the pinned version.

---

## Verify Installation Checklist

```bash
dotnet --version          # active SDK version
dotnet --list-sdks        # all installed SDKs
dotnet --list-runtimes    # all installed runtimes
dotnet new list           # verify templates work
```

All four commands should succeed without errors before proceeding to code generation.
