# Cau hinh gui email that qua Gmail cho KeebHub (ghi vao .env cua du an roi gui 1 email thu)
# Ban nam TRONG thu muc du an -> nguoi clone tu GitHub cung dung duoc. Chay: cau-hinh-email.bat
$ErrorActionPreference = 'Stop'
$App = $PSScriptRoot
$envFile = Join-Path $App '.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $App '.env.example') $envFile }
# Node portable (neu co ..\tools\node), khong thi dung Node da cai tren may
$portable = Join-Path $App '..\tools\node'
if (Test-Path (Join-Path $portable 'node.exe')) { $env:Path = $portable + ';' + $env:Path }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Chua cai Node.js (https://nodejs.org).' -ForegroundColor Red; Read-Host 'Nhan Enter de thoat'; exit 1 }
# Nguoi moi clone thuong chua chay npm install -> buoc gui email thu se loi 'Cannot find module'
if (-not (Test-Path (Join-Path $App 'node_modules\nodemailer'))) {
  Write-Host 'Chua cai thu vien (node_modules) -> dang chay npm install, doi 1-2 phut...' -ForegroundColor Yellow
  Push-Location $App; $ErrorActionPreference = 'Continue'; npm install; $ErrorActionPreference = 'Stop'; Pop-Location
}

Write-Host '================================================================' -ForegroundColor Cyan
Write-Host ' CAU HINH GUI EMAIL QUA GMAIL' -ForegroundColor Cyan
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host 'Ban co the dung BAT KY Gmail nao (khong bat buoc Gmail ca nhan).'
Write-Host ''
$gmail = (Read-Host 'Dia chi Gmail dung de gui (vd: keebhub.shop@gmail.com)').Trim()
if ($gmail -notmatch '^[^@\s]+@(gmail|googlemail)\.com$') { Write-Host 'Dia chi Gmail khong hop le.' -ForegroundColor Red; Read-Host 'Nhan Enter de thoat'; exit 1 }

Write-Host ''
Write-Host "Tiep theo can tao MAT KHAU UNG DUNG (16 ky tu) cho $gmail :" -ForegroundColor Yellow
Write-Host " 1. Trinh duyet se mo trang chon tai khoan Google -> chon / dang nhap DUNG $gmail"
Write-Host '    (neu trinh duyet tu vao Gmail khac: bam anh dai dien goc tren phai -> chon hoac "Them tai khoan")'
Write-Host ' 2. Bat "Xac minh 2 buoc" neu Google yeu cau'
Write-Host ' 3. O trang Mat khau ung dung: dat ten "KeebHub" -> Tao -> copy 16 ky tu'
Write-Host ''
# Mo trang chon tai khoan, goi y san Gmail vua nhap, xong thi chuyen toi trang mat khau ung dung
$next = [uri]::EscapeDataString('https://myaccount.google.com/apppasswords')
Start-Process ("https://accounts.google.com/AccountChooser?Email=" + [uri]::EscapeDataString($gmail) + "&continue=$next")
$sec = Read-Host 'Mat khau ung dung 16 ky tu (go/dan vao, se khong hien chu)' -AsSecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)) -replace '\s', ''
if ($pass.Length -ne 16) { Write-Host "Mat khau ung dung phai co 16 ky tu (ban nhap $($pass.Length))." -ForegroundColor Red; Read-Host 'Nhan Enter de thoat'; exit 1 }

$lines = [System.Collections.Generic.List[string]](Get-Content $envFile)
function SetKey($name, $value) {
  $i = $lines.FindIndex({ param($l) $l -match "^$name=" })
  if ($i -ge 0) { $lines[$i] = "$name=$value" } else { $lines.Add("$name=$value") }
}
SetKey 'SMTP_HOST' 'smtp.gmail.com'
SetKey 'SMTP_PORT' '465'
SetKey 'SMTP_USER' $gmail
SetKey 'SMTP_PASS' $pass
SetKey 'MAIL_FROM' "`"KeebHub <$gmail>`""
SetKey 'MAIL_DEV' ''
[IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "`nDa luu cau hinh vao .env (file nay KHONG duoc day len GitHub)" -ForegroundColor Green

Write-Host "`nDang gui email thu..." -ForegroundColor Cyan
Set-Location $App
node scripts\thu-gui-email.js
if ($LASTEXITCODE -eq 0) {
  # cham vao server.js de web dang chay (nodemon) tu khoi dong lai voi cau hinh moi
  (Get-Item (Join-Path $App 'server.js')).LastWriteTime = Get-Date
  Write-Host "`nXONG! Gmail da gui duoc." -ForegroundColor Green
Write-Host ''
Write-Host '>>> QUAN TRONG: cau hinh chi co hieu luc sau khi KHOI DONG LAI web <<<' -ForegroundColor Yellow
Write-Host '    - Dang chay "npm run dev" (nodemon): web tu khoi dong lai, doi 2-3 giay.' -ForegroundColor Yellow
Write-Host '    - Dang chay "npm start" / "node server.js": bam Ctrl+C trong cua so web roi chay lai.' -ForegroundColor Yellow
} else {
  Write-Host "`nChua gui duoc. Chay lai file nay va nhap lai Gmail / mat khau ung dung." -ForegroundColor Red
}
Read-Host 'Nhan Enter de thoat'
