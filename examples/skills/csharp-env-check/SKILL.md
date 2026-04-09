---
name: csharp-env-check
description: >
  Use this skill whenever generating, writing, or scaffolding a C# DLL, class library, NuGet package, or any .NET project. ALWAYS run environment detection BEFORE writing any code or project files. This skill detects whether the machine has .NET 8, .NET 7, .NET 6, or an older SDK installed, then tailors ALL generated code, .csproj TargetFramework, nullable settings, language version, and API choices to exactly what is available. Trigger on any mention of: "C# DLL", "class library", ".csproj", "dotnet", ".NET project", "NuGet", "generate C# code", "build a DLL", "C# wrapper", "write a C# class". Never assume a .NET version — always detect first.
---

# C# DLL Environment Check

Before writing any C# code or project file, detect the installed .NET SDK and tailor all output to exactly what is available on the user's machine.

---

## Phase 1: Detect the Environment

Run these commands in the bash tool (or instruct the user to run them if on their local machine).

### Step 1A — List all installed SDKs

```bash
dotnet --list-sdks
```

Expected output examples:
```
# .NET 8 installed:
8.0.100 [/usr/share/dotnet/sdk]

# Multiple versions:
6.0.420 [C:\Program Files\dotnet\sdk]
7.0.410 [C:\Program Files\dotnet\sdk]
8.0.100 [C:\Program Files\dotnet\sdk]

# Nothing installed:
# (command not found / error)
```

### Step 1B — Check active/default SDK version

```bash
dotnet --version
```

Returns the highest SDK version that will be used by default (e.g. `8.0.100`).

### Step 1C — Check installed runtimes

```bash
dotnet --list-runtimes
```

Useful when the target machine runs a DLL but may not have the matching runtime.

### Step 1D — Windows-only: check via registry / where

```powershell
# PowerShell — if dotnet CLI not on PATH
Get-Command dotnet -ErrorAction SilentlyContinue
[System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription
```

---

## Phase 2: Interpret Results

**Read `references/version-matrix.md`** for the full compatibility table.

Quick decision table:

| Detected SDK | Use TargetFramework | C# Version | Key notes |
|-------------|--------------------|-----------:|-----------|
| 8.x | `net8.0` | C# 12 | Primary collections, frozen collections, primary constructors |
| 7.x | `net7.0` | C# 11 | Required members, raw string literals |
| 6.x | `net6.0` | C# 10 | File-scoped namespaces, global usings |
| 5.x | `net5.0` | C# 9  | Records, init-only setters |
| 3.1 | `netcoreapp3.1` | C# 8  | LTS but EOL — warn user |
| Not found | ❌ | — | **Do not generate code** — see Phase 3 |

**If multiple SDKs installed**: use the highest version unless the user specifies otherwise (e.g. deployment target is .NET 7 server).

**Always ask if unclear**: *"Your machine has both .NET 7 and .NET 8. Should I target net8.0 (latest features) or net7.0 (if deploying to a .NET 7 server)?"*

---

## Phase 3: .NET Not Found

If `dotnet` command is not found or returns an error:

1. **Do not generate any code yet.**
2. Report clearly: *"No .NET SDK detected on this machine."*
3. Ask the user:
   - Are you writing code to run on a different machine? If so, what .NET version is on that machine?
   - Or do you want to install .NET first?
4. Provide install instructions from `references/install-guide.md`.
5. Once the user confirms the target version, proceed with code generation using that version.

---

## Phase 4: Generate the DLL with Correct Settings

After confirming the target framework, generate all project files using the exact settings from `references/version-matrix.md`.

### Minimum .csproj template (always use this structure)

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework><!-- net8.0 / net7.0 / net6.0 --></TargetFramework>
    <LangVersion><!-- 12 / 11 / 10 --></LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AssemblyName><!-- YourDllName --></AssemblyName>
    <RootNamespace><!-- YourNamespace --></RootNamespace>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <AllowUnsafeBlocks>false</AllowUnsafeBlocks>
  </PropertyGroup>
</Project>
```

### Version-specific additions

**net8.0 only:**
```xml
<EnableConfigurationBindingGenerator>true</EnableConfigurationBindingGenerator>
```

**net7.0 and below — no primary constructors in classes** (C# 12 feature):
```csharp
// ❌ net7.0 — not supported
public class MyService(ILogger logger) { }

// ✅ net7.0 — use explicit constructor
public class MyService
{
    private readonly ILogger _logger;
    public MyService(ILogger logger) => _logger = logger;
}
```

**net6.0 and below — no required members** (C# 11 feature):
```csharp
// ❌ net6.0
public required string Name { get; set; }

// ✅ net6.0 — use constructor or init
public string Name { get; init; } = string.Empty;
```

### Build and verify after generation

```bash
dotnet build YourProject.csproj
dotnet test  # if test project exists
```

Always confirm a clean build before presenting code to the user.

---

## Phase 5: Environment Summary Block

Always prepend this block to your response when generating C# code:

```
╔══════════════════════════════════════════════════╗
║  .NET Environment Detected                       ║
║  SDK version   : 8.0.100                         ║
║  TargetFramework: net8.0                         ║
║  C# version    : 12                              ║
║  Nullable      : enabled                         ║
╚══════════════════════════════════════════════════╝
```

---

## Reference Files

- `references/version-matrix.md` — Full .NET version → C# version → API availability matrix. Feature-by-feature compatibility table. **Read before generating any code.**
- `references/install-guide.md` — Installation instructions for Windows, Linux, macOS. **Read when dotnet is not found.**
