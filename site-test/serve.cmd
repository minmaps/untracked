@echo off
REM Sert le banc de test sur http://localhost:8000
REM localhost est un "contexte securise" : c'est ce qui rend IdleDetector
REM testable, ce qu'un simple file:// ne permettrait pas.
cd /d "%~dp0"
echo.
echo   Banc de test Rideau  ->  http://localhost:8000
echo   (Ctrl+C pour arreter)
echo.
python -m http.server 8000
