$shell = New-Object -ComObject Shell.Application
$recycleBin = $shell.Namespace(10)
$items = $recycleBin.Items()
Write-Host "Total items in Recycle Bin: $($items.Count)"
if ($items.Count -gt 0) {
    for ($i = 0; $i -lt [Math]::Min($items.Count, 3); $i++) {
        $item = $items.Item($i)
        Write-Host "`nItem $($i+1): $($item.Name)"
        Write-Host "Path: $($item.Path)"
        foreach ($verb in $item.Verbs()) {
            if ($verb.Name) {
                Write-Host "Verb: '$($verb.Name)'"
            }
        }
    }
}
