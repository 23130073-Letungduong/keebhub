# Dien key dang nhap Google / Facebook vao .env cua du an (de trong = giu nguyen gia tri cu)
# Chay bang: cau-hinh-dang-nhap-mxh.bat (cung thu muc voi file nay)
$envFile = Join-Path $PSScriptRoot '.env'
$example = Join-Path $PSScriptRoot '.env.example'
if (-not (Test-Path $envFile)) {
  if (Test-Path $example) { Copy-Item $example $envFile } else { New-Item $envFile -ItemType File | Out-Null }
  Write-Host 'Chua co file .env -> da tao tu .env.example' -ForegroundColor Yellow
}
$lines = @(Get-Content $envFile -Encoding UTF8)
function SetKey($name, $value) {
  if (-not $value) { return }
  $script:lines = @($script:lines | Where-Object { $_ -notmatch "^$name=" })
  $script:lines += "$name=$value"
}
function ReadSecret($label) {
  $s = Read-Host $label -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
Write-Host ''
Write-Host 'Dan cac gia tri truong nhom gui rieng (hoac cua app ban tu tao). Bo trong + Enter = bo qua.' -ForegroundColor Gray
Write-Host 'Callback can dang ky: http://localhost:3000/auth/google/callback va http://localhost:3000/auth/facebook/callback' -ForegroundColor Gray
Write-Host ''
Write-Host '=== Dang nhap Google (Google Cloud Console > APIs & Services > Credentials > OAuth client ID) ===' -ForegroundColor Cyan
SetKey 'GOOGLE_CLIENT_ID'     (Read-Host 'Google Client ID')
SetKey 'GOOGLE_CLIENT_SECRET' (ReadSecret 'Google Client Secret (khong hien khi go)')
Write-Host '=== Dang nhap Facebook (developers.facebook.com > App > App settings > Basic) ===' -ForegroundColor Cyan
SetKey 'FACEBOOK_APP_ID'      (Read-Host 'Facebook App ID')
SetKey 'FACEBOOK_APP_SECRET'  (ReadSecret 'Facebook App Secret (khong hien khi go)')
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllLines($envFile, [string[]]$lines, $utf8)
# Cham vao server.js de nodemon tu khoi dong lai (neu web dang chay)
$srv = Join-Path $PSScriptRoot 'server.js'
if (Test-Path $srv) { (Get-Item $srv).LastWriteTime = Get-Date }
Write-Host "`nDa luu vao .env (file nay KHONG duoc day len GitHub)." -ForegroundColor Green
Write-Host 'Neu web dang chay bang nodemon thi tu khoi dong lai; neu khong, tat web roi chay lai.' -ForegroundColor Green
Read-Host 'Nhan Enter de thoat'
