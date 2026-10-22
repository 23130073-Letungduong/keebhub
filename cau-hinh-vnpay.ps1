# Cau hinh thanh toan VNPay THAT (moi truong sandbox cua VNPay) cho KeebHub
# Can 2 gia tri VNPay gui qua email sau khi dang ky: vnp_TmnCode va vnp_HashSecret
# Dang ky (mien phi): https://sandbox.vnpayment.vn/devreg/
$envFile = Join-Path $PSScriptRoot '.env'
$example = Join-Path $PSScriptRoot '.env.example'
if (-not (Test-Path $envFile)) { Copy-Item $example $envFile; Write-Host 'Chua co .env -> da tao tu .env.example' -ForegroundColor Yellow }
$lines = [System.Collections.Generic.List[string]](Get-Content $envFile -Encoding UTF8)
function SetKey($name, $value) {
  $i = $lines.FindIndex({ param($l) $l -match "^$name=" })
  if ($i -ge 0) { $lines[$i] = "$name=$value" } else { $lines.Add("$name=$value") }
}
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host ' CAU HINH THANH TOAN VNPAY (SANDBOX)' -ForegroundColor Cyan
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host 'Chua co tai khoan? Dang ky tai https://sandbox.vnpayment.vn/devreg/'
Write-Host 'VNPay se gui email chua "Terminal ID / Ma Website (vnp_TmnCode)" va "Chuoi bi mat (vnp_HashSecret)".'
Write-Host 'Bo trong ca 2 o + Enter = quay ve trang MO PHONG.' -ForegroundColor Gray
Write-Host ''
$tmn = (Read-Host 'vnp_TmnCode (8 ky tu)').Trim()
$sec = Read-Host 'vnp_HashSecret (khong hien khi dan)' -AsSecureString
$secret = ([Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))).Trim()
if (($tmn -and -not $secret) -or ($secret -and -not $tmn)) { Write-Host 'Can nhap DU ca 2 gia tri.' -ForegroundColor Red; Read-Host 'Nhan Enter de thoat'; exit 1 }
SetKey 'VNP_TMNCODE' $tmn
SetKey 'VNP_HASHSECRET' $secret
SetKey 'VNP_URL' 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'
SetKey 'VNP_RETURN_URL' 'http://localhost:3000/payment/vnpay_return'
[IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
$srv = Join-Path $PSScriptRoot 'server.js'
if (Test-Path $srv) { (Get-Item $srv).LastWriteTime = Get-Date }
if ($tmn) {
  Write-Host "`nDa luu. Tu gio bam thanh toan VNPay se chuyen sang cong VNPay that (sandbox)." -ForegroundColor Green
  Write-Host 'The test: Ngan hang NCB | So the 9704198526191432198 | Ten NGUYEN VAN A | Ngay phat hanh 07/15 | OTP 123456' -ForegroundColor Yellow
} else {
  Write-Host "`nDa xoa key VNPay -> web dung lai trang mo phong." -ForegroundColor Green
}
Write-Host 'Web dang chay (nodemon) se tu khoi dong lai; neu khong, tat web roi chay lai.'
Read-Host 'Nhan Enter de thoat'
