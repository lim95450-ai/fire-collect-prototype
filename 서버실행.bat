@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   [부산소방재난본부] 행정자료 취합시스템 로컬 서버 실행
echo   브라우저 주소: http://localhost:8080
echo   (종료하려면 이 창을 닫거나 Ctrl+C를 누르세요)
echo ========================================================
start "" "http://localhost:8080"
node serve.js
pause
