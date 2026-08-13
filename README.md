# 🗺️ Mapa Eleitoral MG 2022

Sistema completo de consulta aos resultados das Eleições de 2022 no estado de Minas Gerais.
O sistema possui uma API em Python (FastAPI) e um front-end interativo (HTML/CSS/JS) focado em performance, permitindo a pesquisa de dados detalhados (Candidatos, Municípios, Partidos, Penetração, etc.) por município, zona e seção eleitoral.

## 🚀 Funcionalidades

- 🏠 **Home Dashboard**: Visão geral com os deputados federais e estaduais mais votados e resumo de votos do estado.
- 👤 **Consulta por Candidato**: Informações detalhadas sobre votos em municípios, zonas e seções, além de estatísticas de penetração.
- 🏙️ **Consulta por Município**: Top candidatos mais votados no município (Estadual/Federal).
- 🎖️ **Consulta por Partido**: Ranking interno de votos de todos os candidatos do partido.
- ⚔️ **Comparar Candidatos**: Coloque 2 candidatos lado a lado para verificar quem foi melhor em quais municípios.
- ⬇️ **Exportação para CSV**: Baixe as tabelas de seções eleitorais para análise no Excel.

## 🛠️ Tecnologias Utilizadas

- **Backend:** Python, FastAPI, Uvicorn, SQLite
- **Frontend:** Vanilla JS, HTML5, CSS3 Variables (Sem frameworks, alta performance)

## 📁 Estrutura do Projeto

- `api_server.py`: Servidor backend rodando com FastAPI que serve a API REST e os arquivos estáticos.
- `etl_importar.py`: Script para importar os arquivos CSV pesados do TSE para o banco de dados `mapaeleitoral.db`.
- `app.js`: A lógica de frontend, controle de estado, chamadas para a API e renderização dos dashboards.
- `index.html`: Toda a estrutura da UI em Single Page Application (SPA).
- `styles.css`: Sistema de design (modo escuro), animações e responsividade.
- `INICIAR.bat`: Script prático para rodar o backend localmente no Windows.

## ⚙️ Como executar localmente

### 1. Pré-requisitos
Você precisará ter o [Python](https://www.python.org/downloads/) instalado na sua máquina (versão 3.8 ou superior).

Instale as dependências:
```bash
pip install fastapi uvicorn
```

### 2. Base de Dados
O repositório **não** inclui a base de dados (`mapaeleitoral.db`) nem os arquivos CSV originais do TSE devido ao tamanho (+1.7GB). 
Para rodar o projeto do zero:
1. Baixe os resultados de MG no repositório de dados abertos do TSE (`detalhe_votacao_munzona_2022_MG.csv`, `votacao_candidato_munzona_2022_MG.csv`, `detalhe_votacao_secao_2022_MG.csv`).
2. Rode o script de ETL para gerar o banco local:
```bash
python etl_importar.py
```

### 3. Executando o Servidor
Execute o arquivo batch para iniciar o sistema (ou rode o comando uvicorn direto):
```bash
# Via terminal:
python api_server.py
```
Acesse `http://127.0.0.1:8000` no seu navegador.
