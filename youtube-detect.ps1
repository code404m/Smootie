
$windows = Get-Process | Where-Object { $_.MainWindowTitle -match 'youtube' }
$result = @{
    hasWindow = $false
    title = $null
}
if ($windows -and $windows.Count -gt 0) {
    $result.hasWindow = $true
    $firstWithTitle = $windows | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } | Select-Object -First 1
    if ($firstWithTitle) {
        $result.title = $firstWithTitle.MainWindowTitle
    } else {
        $result.title = $windows[0].MainWindowTitle
    }
}
$result | ConvertTo-Json -Compress
