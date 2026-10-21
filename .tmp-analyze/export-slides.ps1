param([string]$Source, [string]$Output)
$ErrorActionPreference = 'Stop'
$powerPoint = $null
$presentation = $null
try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  $powerPoint.AutomationSecurity = 3
  $presentation = $powerPoint.Presentations.Open((Resolve-Path $Source).Path, 0, 0, -1)
  New-Item -ItemType Directory -Force -Path $Output | Out-Null
  $Output = (Resolve-Path $Output).Path
  Write-Output ("slides=" + $presentation.Slides.Count + " width=" + $presentation.PageSetup.SlideWidth + " height=" + $presentation.PageSetup.SlideHeight)
  for ($index = 1; $index -le $presentation.Slides.Count; $index += 1) {
    $slide = $presentation.Slides.Item($index)
    $target = Join-Path $Output ("page{0}.png" -f $index)
    try {
      $slide.Export($target, 'PNG', 1600, 900)
      Write-Output "exported page $index"
    } catch {
      Write-Output ("page " + $index + " export failed: " + $_.Exception.Message)
      try { $presentation.Export($Output, 'PNG') ; Write-Output "used presentation.Export" ; break } catch { Write-Output ("presentation export failed: " + $_.Exception.Message) }
    }
  }
}
finally {
  if ($presentation -ne $null) { $presentation.Close() }
  if ($powerPoint -ne $null) { $powerPoint.Quit() }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
