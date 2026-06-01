param(
  [string]$StressMatrix = "100",
  [string]$ConnectionLimit = "10"
)

$ErrorActionPreference = "Stop"

$originalDatabaseUrl = $env:DATABASE_URL
$originalLabel = $env:STRESS_DB_CONNECTION_LABEL
$originalMatrix = $env:STRESS_MATRIX
$originalConnectionLimit = $env:STRESS_DB_CONNECTION_LIMIT

$targets = @(
  @{ Label = "local"; Url = $env:LOCAL_DATABASE_URL },
  @{ Label = "supabase-direct"; Url = $env:SUPABASE_DIRECT_DATABASE_URL },
  @{ Label = "supabase-pooler"; Url = $env:SUPABASE_POOLER_DATABASE_URL },
  @{ Label = "current"; Url = $originalDatabaseUrl }
) | Where-Object { $_.Url -and $_.Url.Trim().Length -gt 0 }

if ($targets.Count -eq 0) {
  Write-Host "No DATABASE_URL target found. Set DATABASE_URL or one of LOCAL_DATABASE_URL, SUPABASE_DIRECT_DATABASE_URL, SUPABASE_POOLER_DATABASE_URL."
  exit 1
}

try {
  foreach ($target in $targets) {
    Write-Host ""
    Write-Host "=== Entry latency target: $($target.Label) ==="

    $env:DATABASE_URL = $target.Url
    $env:STRESS_DB_CONNECTION_LABEL = $target.Label
    $env:STRESS_MATRIX = $StressMatrix
    $env:STRESS_DB_CONNECTION_LIMIT = $ConnectionLimit

    pnpm --filter api test:e2e -- entries-concurrency.e2e-spec.ts --runInBand

    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
} finally {
  $env:DATABASE_URL = $originalDatabaseUrl
  $env:STRESS_DB_CONNECTION_LABEL = $originalLabel
  $env:STRESS_MATRIX = $originalMatrix
  $env:STRESS_DB_CONNECTION_LIMIT = $originalConnectionLimit
}
