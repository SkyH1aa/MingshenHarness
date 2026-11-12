param(
  [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
  [Parameter(Mandatory = $true)][string]$PdfToPpm
)

$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reviewRoot = [IO.Path]::GetFullPath((Join-Path $repository '.impeccable\review')) + '\'
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
if (-not $evidence.StartsWith($reviewRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Office smoke only accepts generated fixtures under this repository review directory.'
}
if (-not (Test-Path -LiteralPath (Join-Path $evidence 'result.json'))) {
  throw 'Run the document authoring smoke successfully before native Office rendering.'
}
if (-not (Test-Path -LiteralPath $PdfToPpm -PathType Leaf)) {
  throw 'Provide the bundled pdftoppm executable.'
}

$output = Join-Path $evidence 'word-render'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$word = $null
$ownedWord = $false
$results = @()
function Get-CellEquationCount($Document) {
  $count = 0
  for ($index = 1; $index -le $Document.OMaths.Count; $index++) {
    $equation = $null
    $range = $null
    try {
      $equation = $Document.OMaths.Item($index)
      $range = $equation.Range
      if ($range.Information(12)) { $count++ }
    } finally {
      if ($null -ne $range) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($range) | Out-Null }
      if ($null -ne $equation) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($equation) | Out-Null }
    }
  }
  return $count
}

try {
  $word = New-Object -ComObject Word.Application
  if ($word.Documents.Count -ne 0) { throw 'Refusing to use a Word instance with existing documents.' }
  $ownedWord = $true
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  foreach ($name in @('native-math.docx', 'filled-template.docx', 'table-math.docx')) {
    $source = Join-Path $evidence $name
    $document = $null
    try {
      $document = $word.Documents.Open($source, $false, $true, $false)
      $equations = $document.OMaths.Count
      $minimum = switch ($name) {
        'native-math.docx' { 8 }
        'filled-template.docx' { 3 }
        'table-math.docx' { 10 }
      }
      if ($equations -lt $minimum) {
        throw "Word recognized $equations equations in $name, expected at least $minimum."
      }
      $cellEquations = Get-CellEquationCount $document
      $tableRows = $null
      $tableColumns = $null
      if ($name -eq 'table-math.docx') {
        $tableRows = $document.Tables.Item(1).Rows.Count
        $tableColumns = $document.Tables.Item(1).Columns.Count
        if ($cellEquations -ne 10 -or $tableRows -ne 12 -or $tableColumns -ne 2) {
          throw "Word table structure mismatch: equations=$cellEquations, rows=$tableRows, columns=$tableColumns."
        }
        if ($document.Tables.Item(1).Cell(2, 2).Range.OMaths.Count -ne 1) {
          throw 'Word did not recognize the native fraction in the target table cell.'
        }
        $tableText = [string]$document.Tables.Item(1).Range.Text
        if ($tableText -notmatch 'TABLE_CELL_BEFORE_132' -or $tableText -notmatch 'TABLE_CELL_AFTER_132' -or $tableText -notmatch 'TABLE_NESTED_132') {
          throw 'Word lost structured or nested Markdown content inside table cells.'
        }
      }
      if ($name -eq 'filled-template.docx' -and $cellEquations -ne 2) {
        throw "Word recognized $cellEquations template table formulas, expected 2."
      }
      if ($name -eq 'native-math.docx' -and $document.Content.Text -notmatch 'Bold and italic with ') {
        throw 'Word did not preserve Markdown whitespace across formatted runs.'
      }
      $document.Fields.Update() | Out-Null
      $document.Repaginate()
      $pdf = Join-Path $output ($name -replace '\.docx$', '.pdf')
      $document.ExportAsFixedFormat($pdf, 17)
      $results += [pscustomobject]@{
        file = $name
        equations = $equations
        cellEquations = $cellEquations
        tableRows = $tableRows
        tableColumns = $tableColumns
        pages = $document.ComputeStatistics(2)
        footnotes = $document.Footnotes.Count
        pdf = $pdf
      }
    } finally {
      if ($null -ne $document) {
        $document.Close(0)
        [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null
      }
    }
  }

  $copy = Join-Path $output 'editable-copy.docx'
  Copy-Item -LiteralPath (Join-Path $evidence 'native-math.docx') -Destination $copy
  $document = $null
  try {
    $document = $word.Documents.Open($copy, $false, $false, $false)
    $document.OMaths.Item(1).Range.Text = 'z^2+1'
    $document.OMaths.Item(1).BuildUp()
    if ($document.OMaths.Count -lt 8) { throw 'Editing removed native equations.' }
    $document.Save()
  } finally {
    if ($null -ne $document) {
      $document.Close(0)
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null
    }
  }
  $document = $null
  try {
    $document = $word.Documents.Open($copy, $false, $true, $false)
    $reopenedCount = $document.OMaths.Count
    $reopenedEquation = ([string]$document.OMaths.Item(1).Range.Text).Normalize([Text.NormalizationForm]::FormKC)
    if ($reopenedCount -lt 8 -or $reopenedEquation -notmatch 'z') {
      throw "Edited native equation did not survive reopening: count=$reopenedCount, first=$reopenedEquation"
    }
  } finally {
    if ($null -ne $document) {
      $document.Close(0)
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null
    }
  }

  $tableCopy = Join-Path $output 'editable-table-copy.docx'
  Copy-Item -LiteralPath (Join-Path $evidence 'table-math.docx') -Destination $tableCopy
  $document = $null
  try {
    $document = $word.Documents.Open($tableCopy, $false, $false, $false)
    $document.Tables.Item(1).Cell(2, 2).Range.OMaths.Item(1).Range.Text = 't^2+2'
    $document.Tables.Item(1).Cell(2, 2).Range.OMaths.Item(1).BuildUp()
    if ((Get-CellEquationCount $document) -ne 10) {
      throw 'Editing a table cell removed native equations or moved them outside the table.'
    }
    $document.Save()
  } finally {
    if ($null -ne $document) {
      $document.Close(0)
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null
    }
  }
  $document = $null
  try {
    $document = $word.Documents.Open($tableCopy, $false, $true, $false)
    $reopenedTableEquations = Get-CellEquationCount $document
    $reopenedTableEquation = ([string]$document.Tables.Item(1).Cell(2, 2).Range.OMaths.Item(1).Range.Text).Normalize([Text.NormalizationForm]::FormKC)
    if ($reopenedTableEquations -ne 10 -or $reopenedTableEquation -notmatch 't') {
      throw "Edited table equation did not survive reopening: count=$reopenedTableEquations, target=$reopenedTableEquation"
    }
    $document.Repaginate()
    $pdf = Join-Path $output 'editable-table-copy.pdf'
    $document.ExportAsFixedFormat($pdf, 17)
    $results += [pscustomobject]@{
      file = 'editable-table-copy.docx'
      equations = $document.OMaths.Count
      cellEquations = $reopenedTableEquations
      tableRows = $document.Tables.Item(1).Rows.Count
      tableColumns = $document.Tables.Item(1).Columns.Count
      pages = $document.ComputeStatistics(2)
      footnotes = $document.Footnotes.Count
      editedCell = 'row 2 column 2'
      editedEquation = $reopenedTableEquation
      pdf = $pdf
    }
  } finally {
    if ($null -ne $document) {
      $document.Close(0)
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null
    }
  }
} finally {
  if ($null -ne $word) {
    if ($ownedWord) { $word.Quit(0) }
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
  }
}

foreach ($result in $results) {
  $prefix = Join-Path $output ([IO.Path]::GetFileNameWithoutExtension($result.file))
  & $PdfToPpm -scale-to 1600 -png $result.pdf $prefix
  if ($LASTEXITCODE -ne 0) { throw "Page rasterization failed for $($result.file)." }
}
$report = [pscustomobject]@{
  engine = 'Microsoft Word COM'
  documents = $results
  nativeEquationEditSaveReopen = $true
  tableCellNativeEquationEditSaveReopen = $true
  markdownWhitespacePreserved = $true
  boundary = 'Generated fixtures only. Word rendering is not a full Windows/Office compatibility matrix.'
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'result.json') -Encoding UTF8
$report | ConvertTo-Json -Depth 6
