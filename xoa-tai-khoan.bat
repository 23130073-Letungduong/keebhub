@echo off
chcp 65001 >nul
title Xoa tai khoan KeebHub
rem Xoa han 1 tai khoan (kem don hang, danh gia, build, shop) khoi database de dang ky lai.
rem Dung node co san trong ..\tools\node (neu co), khong thi dung node da cai tren may.
set HERE=%~dp0
if exist "%HERE%..\tools\node\node.exe" set PATH=%HERE%..\tools\node;%PATH%
cd /d "%HERE%"
node scripts\xoa-tai-khoan.js %*
echo.
pause
