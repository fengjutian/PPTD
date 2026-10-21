param([string]$Layouts, [string]$Renders, [string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$data = Get-Content -LiteralPath $Layouts -Raw -Encoding UTF8 | ConvertFrom-Json
$results = @{}

function Get-Luminance([double]$r, [double]$g, [double]$b) {
  $c = @($r, $g, $b) | ForEach-Object {
    $n = $_ / 255.0
    if ($n -le 0.03928) { $n / 12.92 } else { [Math]::Pow(($n + 0.055) / 1.055, 2.4) }
  }
  return 0.2126 * $c[0] + 0.7152 * $c[1] + 0.0722 * $c[2]
}

foreach ($layout in $data.layouts) {
  $path = Join-Path $Renders ("layout{0}.png" -f $layout.index)
  if (-not (Test-Path -LiteralPath $path)) { continue }
  $bitmap = New-Object System.Drawing.Bitmap($path)
  $width = $bitmap.Width
  $height = $bitmap.Height

  $title = $layout.regions | Where-Object { $_.role -eq 'title' } | Select-Object -First 1
  $bodies = @($layout.regions | Where-Object { $_.role -eq 'body' } | Sort-Object { -($_.width * $_.height) })
  $content = $bodies | Select-Object -First 1

  $probe = @{}
  foreach ($entry in @(@('title', $title), @('body', $content))) {
    $name = $entry[0]
    $region = $entry[1]
    if ($null -eq $region) { continue }
    $x0 = [Math]::Max(0, [Math]::Floor(($region.x / $data.slideWidthEmu) * $width))
    $y0 = [Math]::Max(0, [Math]::Floor(($region.y / $data.slideHeightEmu) * $height))
    $x1 = [Math]::Min([double]$width, [Math]::Ceiling((($region.x + $region.width) / $data.slideWidthEmu) * $width))
    $y1 = [Math]::Min([double]$height, [Math]::Ceiling((($region.y + $region.height) / $data.slideHeightEmu) * $height))
    if ($x1 -le $x0 -or $y1 -le $y0) { continue }
    $total = 0.0
    $count = 0
    for ($y = $y0; $y -lt $y1; $y += 2) {
      for ($x = $x0; $x -lt $x1; $x += 2) {
        $pixel = $bitmap.GetPixel($x, $y)
        $total += Get-Luminance $pixel.R $pixel.G $pixel.B
        $count += 1
      }
    }
    if ($count -gt 0) { $probe[$name] = [Math]::Round($total / $count, 4) }
  }
  $results["$($layout.index)"] = $probe
  $bitmap.Dispose()
}

$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Out -Encoding UTF8
Write-Output "probed $($results.Count) layouts"
$results.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Key): $($_.Value | ConvertTo-Json -Compress)" }
