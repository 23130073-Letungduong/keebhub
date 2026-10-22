@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cau-hinh-dang-nhap-mxh.ps1"
