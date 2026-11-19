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
  foreach ($name in @('native-math.docx', 'filled-template.docx', 'table-math.docx', 'old-draft.docx', 'revised-draft.docx')) {
    $source = Join-Path $evidence $name
    $document = $null
    try {
      $document = $word.Documents.Open($source, $false, $true, $false)
      $equations = $document.OMaths.Count
      $minimum = switch ($name) {
        'native-math.docx' { 8 }
        'filled-template.docx' { 3 }
        'table-math.docx' { 10 }
        'old-draft.docx' { 1 }
        'revised-draft.docx' { 2 }
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
      $draftLayout = $null
      if ($name -in @('old-draft.docx', 'revised-draft.docx')) {
        if ($document.Sections.Item(1).Headers.Item(1).Range.Text -notmatch 'DRAFT_HEADER_KEEP_133' -or
            $document.Sections.Item(1).Footers.Item(1).Range.Text -notmatch 'DRAFT_FOOTER_KEEP_133') {
          throw "Word lost the original draft header/footer in $name."
        }
        if ($document.InlineShapes.Count -ne 1) { throw "Word lost the original image in $name." }
        $expectedNotes = if ($name -eq 'old-draft.docx') { 1 } else { 2 }
        if ($document.Footnotes.Count -ne $expectedNotes) { throw "Word lost draft notes in $name." }
      }
      if ($name -eq 'revised-draft.docx') {
        $bodyText = [string]$document.Content.Text
        if ($bodyText -notmatch 'Before revised draft after\.' -or $bodyText -notmatch 'Cell updated' -or
            $bodyText -match 'Replace this section|Remove this paragraph') {
          throw 'Word did not recognize the revised draft text.'
        }
        $range = $null
        $paragraph = $null
        $format = $null
        try {
          $range = $document.Content.Duplicate
          if (-not $range.Find.Execute('Keep final paragraph')) { throw 'Revised layout paragraph missing.' }
          $paragraph = $range.Paragraphs.Item(1)
          $format = $paragraph.Format
          $firstWidth = [double]$document.Tables.Item(1).Columns.Item(1).Width
          $secondWidth = [double]$document.Tables.Item(1).Columns.Item(2).Width
          $draftLayout = [pscustomobject]@{
            firstLineIndentPoints = [double]$format.FirstLineIndent
            spaceAfterPoints = [double]$format.SpaceAfter
            lineSpacingPoints = [double]$format.LineSpacing
            lineSpacingRule = [int]$format.LineSpacingRule
            alignment = [int]$format.Alignment
            keepTogether = [bool]$format.KeepTogether
            tableColumnRatio = $secondWidth / $firstWidth
            equationJustification = [int]$document.OMaths.Item(1).Justification
          }
          if ([Math]::Abs($draftLayout.firstLineIndentPoints - 18) -gt 0.2 -or
              [Math]::Abs($draftLayout.spaceAfterPoints - 8) -gt 0.2 -or
              $draftLayout.lineSpacingPoints -lt 15 -or
              $draftLayout.alignment -ne 3 -or -not $draftLayout.keepTogether -or
              [Math]::Abs($draftLayout.tableColumnRatio - 3) -gt 0.1 -or
              $draftLayout.equationJustification -ne 3) {
            throw "Word paragraph/table layout mismatch: $($draftLayout | ConvertTo-Json -Compress)"
          }
        } finally {
          foreach ($com in @($format, $paragraph, $range)) {
            if ($null -ne $com) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($com) | Out-Null }
          }
        }
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
        draftLayout = $draftLayout
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
  oldDraftTextAndLayoutPreserved = $true
  boundary = 'Generated fixtures only. Word rendering is not a full Windows/Office compatibility matrix.'
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'result.json') -Encoding UTF8
$report | ConvertTo-Json -Depth 6
