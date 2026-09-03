param(
  [Parameter(Mandatory = $true)][string]$ConnectionString,
  [string]$OutputPath = (Join-Path $PSScriptRoot "..\out\post_street.csv")
)

$columns = @(
  'legacy_id','zip_code','district_id','city_name','district_name','street_name','sector',
  'neighborhood','neighborhood_from','neighborhood_end','lane','lane_from','lane_end',
  'alley','alley_from','alley_end','house_number','house_number_sub','floor','floor_from',
  'house_number_from','house_number_from_sub','house_number_end','house_number_end_sub',
  'floor_end','scope','number_type','record_type','source_detail','source_version'
)
$directory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $directory | Out-Null

function ConvertTo-CsvField([object]$Value) {
  if ($null -eq $Value -or $Value -is [System.DBNull]) { return '' }
  return '"' + ([string]$Value).Replace('"', '""') + '"'
}

$connection = [System.Data.SqlClient.SqlConnection]::new($ConnectionString)
$command = $connection.CreateCommand()
$command.CommandTimeout = 0
$command.CommandText = @"
select id as legacy_id, zip_code, district_id, city_name, district_name, street_name, sector,
       neighborhood, neighborhood_from, neighborhood_end, lane, lane_from, lane_end,
       alley, alley_from, alley_end, house_number, house_number_sub, floor, floor_from,
       house_number_from, house_number_from_sub, house_number_end, house_number_end_sub,
       floor_end, scope, number_type, record_type, source_detail,
       convert(varchar(19), getdate(), 120) as source_version
from dbo.post_street
order by id;
"@

$connection.Open()
try {
  $reader = $command.ExecuteReader()
  try {
    $writer = [System.IO.StreamWriter]::new($OutputPath, $false, [System.Text.UTF8Encoding]::new($false))
    try {
      $writer.WriteLine(($columns -join ','))
      $count = 0
      while ($reader.Read()) {
        $fields = for ($index = 0; $index -lt $reader.FieldCount; $index++) { ConvertTo-CsvField $reader.GetValue($index) }
        $writer.WriteLine(($fields -join ','))
        $count++
      }
      Write-Output "Exported $count rows to $OutputPath"
    } finally { $writer.Dispose() }
  } finally { $reader.Dispose() }
} finally { $connection.Dispose() }
