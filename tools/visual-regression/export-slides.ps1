param(
  [Parameter(Mandatory = $true)][string]$Pptx,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$Width = 1280,
  [int]$Height = 720
)

# Renders every slide of a deck to a PNG file with a fixed name.
#
# PowerPoint is the application the deck is meant for, so its rendering is the
# one the visual regression check compares. The file names are written by this
# script because the names PowerPoint picks on its own are localised.

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$app = New-Object -ComObject PowerPoint.Application
try {
  $presentation = $app.Presentations.Open($Pptx, $true, $false, $false)
  try {
    for ($index = 1; $index -le $presentation.Slides.Count; $index += 1) {
      $target = Join-Path $OutDir ("slide-{0}.png" -f $index)
      $presentation.Slides.Item($index).Export($target, "PNG", $Width, $Height)
    }
  } finally {
    $presentation.Close()
  }
} finally {
  $app.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}

Get-ChildItem $OutDir -Filter *.png | ForEach-Object { $_.FullName }
