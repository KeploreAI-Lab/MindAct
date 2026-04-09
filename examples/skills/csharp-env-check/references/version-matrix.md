# .NET Version Matrix & Feature Compatibility

Full reference for mapping SDK version → project settings → available language features.

---

## Version → Framework → C# Mapping

| .NET SDK | TargetFramework | C# Default | LangVersion value | Support status |
|----------|----------------|-----------|-------------------|----------------|
| 9.x      | `net9.0`       | C# 13      | `13`              | Current (preview) |
| 8.x      | `net8.0`       | C# 12      | `12`              | ✅ LTS — recommended |
| 7.x      | `net7.0`       | C# 11      | `11`              | ✅ Active |
| 6.x      | `net6.0`       | C# 10      | `10`              | ✅ LTS |
| 5.x      | `net5.0`       | C# 9       | `9`               | ⚠ EOL |
| 3.1.x    | `netcoreapp3.1`| C# 8       | `8`               | ⚠ EOL |
| .NET Framework 4.8 | `net48` | C# 7.3   | `7.3`             | ⚠ Legacy — Windows only |

---

## .csproj Settings by Target

### net8.0
```xml
<PropertyGroup>
  <TargetFramework>net8.0</TargetFramework>
  <LangVersion>12</LangVersion>
  <Nullable>enable</Nullable>
  <ImplicitUsings>enable</ImplicitUsings>
</PropertyGroup>
```

### net7.0
```xml
<PropertyGroup>
  <TargetFramework>net7.0</TargetFramework>
  <LangVersion>11</LangVersion>
  <Nullable>enable</Nullable>
  <ImplicitUsings>enable</ImplicitUsings>
</PropertyGroup>
```

### net6.0
```xml
<PropertyGroup>
  <TargetFramework>net6.0</TargetFramework>
  <LangVersion>10</LangVersion>
  <Nullable>enable</Nullable>
  <ImplicitUsings>enable</ImplicitUsings>
</PropertyGroup>
```

### net48 (.NET Framework — legacy)
```xml
<PropertyGroup>
  <TargetFramework>net48</TargetFramework>
  <LangVersion>7.3</LangVersion>
  <!-- No ImplicitUsings, no Nullable in old SDK -->
</PropertyGroup>
```

---

## C# Language Feature Availability

| Feature | C# version | Min .NET |
|---------|-----------|----------|
| Primary constructors (classes) | C# 12 | net8.0 |
| Collection expressions `[1, 2, 3]` | C# 12 | net8.0 |
| `FrozenDictionary` / `FrozenSet` | C# 12 | net8.0 |
| `InlineArray` attribute | C# 12 | net8.0 |
| `required` members | C# 11 | net7.0 |
| Raw string literals `"""..."""` | C# 11 | net7.0 |
| List patterns `[1, 2, ..]` | C# 11 | net7.0 |
| Generic math interfaces | C# 11 | net7.0 |
| `file` access modifier | C# 11 | net7.0 |
| Record structs | C# 10 | net6.0 |
| File-scoped namespaces | C# 10 | net6.0 |
| Global usings | C# 10 | net6.0 |
| `with` on structs | C# 10 | net6.0 |
| `record` types | C# 9 | net5.0 |
| `init` setters | C# 9 | net5.0 |
| Pattern matching (enhanced) | C# 9 | net5.0 |
| `IAsyncEnumerable` | C# 8 | netcoreapp3.1 |
| Nullable reference types | C# 8 | netcoreapp3.1 |
| Switch expressions | C# 8 | netcoreapp3.1 |
| Default interface members | C# 8 | netcoreapp3.1 |
| Tuples, deconstruction | C# 7 | all |
| `async`/`await` | C# 5 | all |

---

## Common API Availability by Version

| API | Min .NET |
|-----|----------|
| `System.Text.Json` (built-in) | net3.1+ |
| `TimeOnly` / `DateOnly` | net6.0+ |
| `Parallel.ForEachAsync` | net6.0+ |
| `PriorityQueue<T,P>` | net6.0+ |
| `ArgumentNullException.ThrowIfNull()` | net6.0+ |
| `ArgumentOutOfRangeException.ThrowIfNegative()` | net8.0+ |
| `System.IO.Hashing` | net6.0+ |
| `PeriodicTimer` | net6.0+ |
| `Half` floating point type | net5.0+ |
| `System.Runtime.Intrinsics` (SIMD) | net5.0+ |
| `Span<T>` / `Memory<T>` | net(core)2.1+ |
| `ValueTask` | net(core)2.0+ |

---

## Multi-Targeting (when you need to support multiple runtimes)

```xml
<PropertyGroup>
  <TargetFrameworks>net8.0;net7.0;net6.0</TargetFrameworks>
</PropertyGroup>

<!-- Conditional code per target -->
<ItemGroup Condition="'$(TargetFramework)' == 'net8.0'">
  <PackageReference Include="SomeNet8OnlyPackage" Version="1.0.0" />
</ItemGroup>
```

In C# code:
```csharp
#if NET8_0_OR_GREATER
    // Use collection expressions
    var items = [1, 2, 3];
#elif NET6_0_OR_GREATER
    // Use list
    var items = new List<int> { 1, 2, 3 };
#else
    var items = new List<int> { 1, 2, 3 };
#endif
```

---

## DLL Output Settings by Use Case

### DLL for HALCON / COM interop (Windows)
```xml
<PropertyGroup>
  <TargetFramework>net8.0-windows</TargetFramework>  <!-- or net7.0-windows -->
  <UseWindowsForms>false</UseWindowsForms>
  <AllowUnsafeBlocks>true</AllowUnsafeBlocks>  <!-- if using pointers -->
  <Platforms>x64</Platforms>  <!-- industrial cameras are usually x64 -->
</PropertyGroup>
```

### DLL for cross-platform use
```xml
<PropertyGroup>
  <TargetFramework>net8.0</TargetFramework>  <!-- no -windows suffix -->
  <AllowUnsafeBlocks>false</AllowUnsafeBlocks>
  <Platforms>AnyCPU</Platforms>
</PropertyGroup>
```

### DLL published as NuGet package
```xml
<PropertyGroup>
  <TargetFrameworks>net8.0;net7.0;net6.0</TargetFrameworks>
  <GeneratePackageOnBuild>true</GeneratePackageOnBuild>
  <PackageId>YourPackage.Name</PackageId>
  <Version>1.0.0</Version>
  <Authors>Your Name</Authors>
  <Description>Package description</Description>
</PropertyGroup>
```

---

## Warning Scenarios

| Situation | Warning to surface |
|-----------|-------------------|
| SDK found but EOL (3.1, 5.0) | "⚠ .NET {version} is end-of-life. Consider upgrading to .NET 8 (LTS)." |
| net48 (.NET Framework) detected | "⚠ .NET Framework 4.8 is legacy. Many modern APIs unavailable. Confirm this is intentional." |
| SDK version != runtime version | "⚠ SDK {sdk} detected but target runtime is {rt}. Ensure deployment machine has {rt} installed." |
| User asks for feature unavailable in their version | "⚠ `{feature}` requires C# {ver} / .NET {net}. Your environment has .NET {current}. I'll use the equivalent for {current} instead." |
