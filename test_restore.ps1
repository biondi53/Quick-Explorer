$shell = New-Object -ComObject Shell.Application
$recycleBin = $shell.Namespace(10)
$items = $recycleBin.Items()

if ($items.Count -eq 0) {
    Write-Host "Recycle Bin is empty. Please delete something first."
    exit
}

function Test-Verb($itemName, $verbName) {
    $item = $recycleBin.Items() | Where-Object { $_.Name -eq $itemName }
    if (-not $item) { return $false }
    
    Write-Host "Trying verb '$verbName' on '$itemName'..."
    $cntBefore = $recycleBin.Items().Count
    $item.InvokeVerb($verbName)
    Start-Sleep -Seconds 2
    $cntAfter = $recycleBin.Items().Count
    
    if ($cntAfter -lt $cntBefore) {
        Write-Host "SUCCESS: Item restored with '$verbName'"
        return $true
    }
    else {
        Write-Host "FAILED: Item still in Recycle Bin after '$verbName'"
        return $false
    }
}

$firstItem = $items.Item(0)
$name = $firstItem.Name

if (Test-Verb $name "undelete") { exit }
if (Test-Verb $name "restore") { exit }
if (Test-Verb $name "&Restaurar") { exit }
if (Test-Verb $name "Restaurar") { exit }

Write-Host "`nListing all available verbs for reference:"
foreach ($v in $firstItem.Verbs()) {
    Write-Host "Verb Name: '$($v.Name)'"
}
