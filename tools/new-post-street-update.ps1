param(
  [string]$CsvPath = (Join-Path $PSScriptRoot "..\out\post_street.csv"),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\out\update"),
  [int]$BatchSize = 1000
)

$columns = @(
  'legacy_id','zip_code','district_id','city_name','district_name','street_name','sector',
  'neighborhood','neighborhood_from','neighborhood_end','lane','lane_from','lane_end',
  'alley','alley_from','alley_end','house_number','house_number_sub','floor',
  'house_number_from','house_number_from_sub','house_number_end','house_number_end_sub',
  'floor_end','scope','number_type','record_type','source_detail','source_version'
)
$numericColumns = @{
  legacy_id = $true; district_id = $true; neighborhood = $true; neighborhood_from = $true;
  neighborhood_end = $true; lane = $true; lane_from = $true; lane_end = $true; alley = $true;
  alley_from = $true; alley_end = $true; house_number = $true; house_number_sub = $true;
  floor = $true; house_number_from = $true; house_number_from_sub = $true; house_number_end = $true;
  house_number_end_sub = $true; floor_end = $true; scope = $true; number_type = $true; record_type = $true
}
$updateColumns = $columns | Where-Object { $_ -ne 'legacy_id' } | ForEach-Object { "$_ = excluded.$_" }

function To-PgLiteral([string]$Column, [object]$Value) {
  if ([string]::IsNullOrEmpty([string]$Value)) { return 'null' }
  if ($numericColumns.ContainsKey($Column)) { return [string]$Value }
  return "'" + ([string]$Value).Replace("'", "''") + "'"
}

if (-not (Test-Path -LiteralPath $CsvPath)) { throw "CSV not found: $CsvPath" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$rows = Import-Csv -LiteralPath $CsvPath -Encoding utf8
$batch = [System.Collections.Generic.List[string]]::new()
$batchNumber = 0

function Write-Batch {
  param([System.Collections.Generic.List[string]]$Rows, [int]$Number)
  if ($Rows.Count -eq 0) { return }
  $file = Join-Path $OutputDirectory ('01_post_street_{0:D4}.sql' -f $Number)
  $sql = @(
    'begin;',
    "insert into postal.post_street ($($columns -join ',')) values",
    (($Rows -join ",`n") + "`non conflict (legacy_id) do update set $($updateColumns -join ', ');"),
    'commit;'
  ) -join "`n"
  [System.IO.File]::WriteAllText($file, $sql, [System.Text.UTF8Encoding]::new($false))
}

foreach ($row in $rows) {
  $values = foreach ($column in $columns) { To-PgLiteral $column $row.$column }
  $batch.Add('  (' + ($values -join ',') + ')')
  if ($batch.Count -ge $BatchSize) {
    $batchNumber++; Write-Batch $batch $batchNumber; $batch.Clear()
  }
}
if ($batch.Count) { $batchNumber++; Write-Batch $batch $batchNumber }

$validatePath = Join-Path $OutputDirectory '02_validate.sql'
$validateSql = @"
select count(*) as row_count, count(distinct legacy_id) as distinct_legacy_id from postal.post_street;
select zip_code, count(*) as row_count from postal.post_street group by zip_code order by zip_code;
"@
[System.IO.File]::WriteAllText($validatePath, $validateSql, [System.Text.UTF8Encoding]::new($false))
Write-Output "Generated $batchNumber upsert batches in $OutputDirectory"
