Import-Module ImportExcel

$xlsx = Join-Path $PSScriptRoot "DisplayDocket.xlsx"
$csv  = Join-Path $PSScriptRoot "schedule.csv"

Import-Excel $xlsx |
    Export-Csv $csv -NoTypeInformation -Encoding UTF8