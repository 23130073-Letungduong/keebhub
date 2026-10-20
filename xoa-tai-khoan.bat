@echo off
chcp 65001 >nul
title Xoa tai khoan KeebHub
rem Xoa han 1 tai khoan (kem don hang, danh gia, build, shop) khoi database de dang ky lai.
set HERE=%~dp0
set TOOLS=%HERE%..\tools
if exist "%TOOLS%\node\node.exe" set PATH=%TOOLS%\node;%PATH%

rem Neu co MongoDB portable (..\tools\mongodb) ma chua chay thi tu bat
if exist "%TOOLS%\mongodb\bin\mongod.exe" (
  powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient('127.0.0.1',27017);$c.Close();exit 0}catch{exit 1}"
  if errorlevel 1 (
    echo Dang khoi dong MongoDB...
    if not exist "%TOOLS%\mongodb-data" mkdir "%TOOLS%\mongodb-data"
    start "MongoDB" /min "%TOOLS%\mongodb\bin\mongod.exe" --dbpath "%TOOLS%\mongodb-data" --bind_ip 127.0.0.1 --port 27017
    powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){try{$c=New-Object Net.Sockets.TcpClient('127.0.0.1',27017);$c.Close();exit 0}catch{Start-Sleep 1}};exit 1"
  )
)

cd /d "%HERE%"
node scripts\xoa-tai-khoan.js %*
echo.
pause
