@echo off
chcp 65001 >nul
title Mapa Eleitoral MG 2022

echo.
echo ═══════════════════════════════════════════════════════
echo   MAPA ELEITORAL - MINAS GERAIS 2022
echo   Sistema de Consulta Eleitoral
echo ═══════════════════════════════════════════════════════
echo.

cd /d "%~dp0"

:: Verificar Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao encontrado. Instale Python 3.8+ em python.org
    pause
    exit /b 1
)

:: Instalar dependências se necessário
echo [1/3] Verificando dependencias Python...
pip show fastapi >nul 2>&1
if errorlevel 1 (
    echo     Instalando FastAPI...
    pip install fastapi uvicorn python-multipart -q
)

pip show uvicorn >nul 2>&1
if errorlevel 1 (
    pip install uvicorn -q
)

echo     OK - Dependencias prontas.
echo.

:: Verificar se banco existe
if not exist "mapaeleitoral.db" (
    echo [2/3] Banco de dados nao encontrado.
    echo.
    echo     Iniciando importacao dos dados CSV...
    echo     ATENÇÃO: Este processo pode levar 10-20 minutos.
    echo     Nao feche esta janela!
    echo.
    python etl_importar.py
    if errorlevel 1 (
        echo.
        echo [ERRO] Falha na importacao dos dados!
        pause
        exit /b 1
    )
    echo.
    echo     Banco de dados criado com sucesso!
) else (
    echo [2/3] Banco de dados encontrado - OK
)

echo.
echo [3/3] Iniciando servidor...
echo.
echo ═══════════════════════════════════════════════════════
echo   Servidor rodando em: http://127.0.0.1:8000
echo   Pressione CTRL+C para encerrar
echo ═══════════════════════════════════════════════════════
echo.

:: Aguardar 2 segundos e abrir browser
start /b cmd /c "timeout /t 2 >nul && start http://127.0.0.1:8000"

:: Iniciar servidor
python api_server.py

pause
