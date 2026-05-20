param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$HypixelApiKey,

  [string]$RenderApiKey = $env:RENDER_API_KEY,
  [string]$RenderServiceId = $env:RENDER_SERVICE_ID,
  [switch]$ClearBuildCache
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RenderApiKey)) {
  throw "Missing RENDER_API_KEY. Set it first: `$env:RENDER_API_KEY='rnd_...'"
}

if ([string]::IsNullOrWhiteSpace($RenderServiceId)) {
  throw "Missing RENDER_SERVICE_ID. Set it first: `$env:RENDER_SERVICE_ID='srv_...'"
}

if ([string]::IsNullOrWhiteSpace($HypixelApiKey)) {
  throw "Missing Hypixel API key."
}

$headers = @{
  Authorization = "Bearer $RenderApiKey"
  Accept = "application/json"
  "Content-Type" = "application/json"
}

$envVarUri = "https://api.render.com/v1/services/$RenderServiceId/env-vars/HYPIXEL_API_KEY"
$deployUri = "https://api.render.com/v1/services/$RenderServiceId/deploys"

Write-Host "Updating HYPIXEL_API_KEY on Render..."
$body = @{ value = $HypixelApiKey } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Put -Uri $envVarUri -Headers $headers -Body $body | Out-Null

$deployMode = if ($ClearBuildCache) { "clear" } else { "do_not_clear" }
$deployBody = @{ clearCache = $deployMode } | ConvertTo-Json

Write-Host "Triggering Render deploy..."
$deploy = Invoke-RestMethod -Method Post -Uri $deployUri -Headers $headers -Body $deployBody

Write-Host "Done. Render deploy triggered."
if ($deploy.id) {
  Write-Host "Deploy ID: $($deploy.id)"
}
Write-Host "Health check after deploy: https://<your-render-service>.onrender.com/api/health"
