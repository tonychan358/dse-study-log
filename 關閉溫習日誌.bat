@echo off
chcp 65001 >nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8005 ^| findstr LISTENING') do taskkill /F /PID %%a
echo 已關閉 port 8005 的服務。
pause
