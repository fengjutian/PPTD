param(
  [Parameter(Mandatory = $true)][string]$Pptx
)

# Opens the deck with PowerPoint and reports the timeline count.
#
# A file can be a valid ZIP and still be rejected by PowerPoint: the timing
# tree has to match the animation schema. This check is the difference between
# "the XML looks plausible" and "PowerPoint actually reads the animation".

$ErrorActionPreference = 'Stop'

$app = New-Object -ComObject PowerPoint.Application
try {
  $app.DisplayAlerts = 1
  $presentation = $app.Presentations.Open($Pptx, $true, $false, $false)
  try {
    Write-Output ("slides=" + $presentation.Slides.Count)
    Write-Output ("effects=" + $presentation.Slides.Item(1).Timeline.MainSequence.Count)
  } finally {
    $presentation.Close()
  }
} finally {
  $app.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
