"""
ETL - Mapa Eleitoral MG 2022
Importa CSVs do TSE para banco SQLite otimizado.
Filtra apenas: Deputado Estadual (CD_CARGO=7) e Deputado Federal (CD_CARGO=6)
"""
import sys, io
# Forcar UTF-8 no stdout para evitar erros no Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import sqlite3
import pandas as pd
import os
import sys
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "mapaeleitoral.db")

# Arquivos de origem
FILE_ZONA = os.path.join(BASE_DIR, "votacao_candidato_munzona_2022_MG.csv")
FILE_SECAO = os.path.join(BASE_DIR, "votacao_secao_2022_MG", "votacao_secao_2022_MG.csv")

# Cargos desejados: 6=Deputado Federal, 7=Deputado Estadual
CARGOS = [6, 7]
CHUNKSIZE = 50_000

def print_progress(msg):
    print(f"[ETL] {msg}", flush=True)

def criar_banco(conn):
    print_progress("Criando estrutura do banco de dados...")
    conn.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        PRAGMA cache_size=100000;
        PRAGMA temp_store=MEMORY;

        CREATE TABLE IF NOT EXISTS candidatos (
            SQ_CANDIDATO     INTEGER PRIMARY KEY,
            NM_CANDIDATO     TEXT,
            NM_URNA_CANDIDATO TEXT,
            NR_CANDIDATO     INTEGER,
            CD_CARGO         INTEGER,
            DS_CARGO         TEXT,
            SG_PARTIDO       TEXT,
            NM_PARTIDO       TEXT,
            NR_TURNO         INTEGER
        );

        CREATE TABLE IF NOT EXISTS votos_zona (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            SQ_CANDIDATO     INTEGER,
            NM_CANDIDATO     TEXT,
            NM_URNA_CANDIDATO TEXT,
            NR_CANDIDATO     INTEGER,
            CD_CARGO         INTEGER,
            DS_CARGO         TEXT,
            SG_PARTIDO       TEXT,
            NR_TURNO         INTEGER,
            CD_MUNICIPIO     INTEGER,
            NM_MUNICIPIO     TEXT,
            NR_ZONA          INTEGER,
            QT_VOTOS_NOMINAIS INTEGER
        );

        CREATE TABLE IF NOT EXISTS votos_secao (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            SQ_CANDIDATO     INTEGER,
            NM_CANDIDATO     TEXT,
            NM_URNA_CANDIDATO TEXT,
            NR_CANDIDATO     INTEGER,
            CD_CARGO         INTEGER,
            DS_CARGO         TEXT,
            NR_TURNO         INTEGER,
            CD_MUNICIPIO     INTEGER,
            NM_MUNICIPIO     TEXT,
            NR_ZONA          INTEGER,
            NR_SECAO         INTEGER,
            NR_LOCAL_VOTACAO INTEGER,
            NM_LOCAL_VOTACAO TEXT,
            DS_LOCAL_VOTACAO_ENDERECO TEXT,
            QT_VOTOS         INTEGER
        );
    """)
    conn.commit()
    print_progress("Estrutura criada.")

def importar_zonas(conn):
    print_progress(f"Iniciando importação de votos por ZONA/MUNICÍPIO...")
    print_progress(f"Arquivo: {FILE_ZONA}")

    if not os.path.exists(FILE_ZONA):
        print_progress("AVISO: Arquivo de zonas não encontrado. Pulando.")
        return

    total = 0
    chunk_num = 0
    t0 = time.time()

    for chunk in pd.read_csv(
        FILE_ZONA,
        sep=";",
        encoding="latin-1",
        chunksize=CHUNKSIZE,
        dtype=str,
        on_bad_lines="skip"
    ):
        chunk_num += 1

        # Filtrar cargos desejados
        chunk["CD_CARGO"] = pd.to_numeric(chunk["CD_CARGO"], errors="coerce")
        chunk = chunk[chunk["CD_CARGO"].isin(CARGOS)]

        if chunk.empty:
            continue

        # Selecionar e renomear colunas necessárias
        cols_map = {
            "SQ_CANDIDATO": "SQ_CANDIDATO",
            "NM_CANDIDATO": "NM_CANDIDATO",
            "NM_URNA_CANDIDATO": "NM_URNA_CANDIDATO",
            "NR_CANDIDATO": "NR_CANDIDATO",
            "CD_CARGO": "CD_CARGO",
            "DS_CARGO": "DS_CARGO",
            "SG_PARTIDO": "SG_PARTIDO",
            "NR_TURNO": "NR_TURNO",
            "CD_MUNICIPIO": "CD_MUNICIPIO",
            "NM_MUNICIPIO": "NM_MUNICIPIO",
            "NR_ZONA": "NR_ZONA",
            "QT_VOTOS_NOMINAIS": "QT_VOTOS_NOMINAIS",
        }

        available = {k: v for k, v in cols_map.items() if k in chunk.columns}
        df = chunk[list(available.keys())].copy()
        df.columns = [available[c] for c in df.columns]

        # Converter numéricos
        for col in ["SQ_CANDIDATO", "NR_CANDIDATO", "CD_CARGO", "NR_TURNO", "CD_MUNICIPIO", "NR_ZONA", "QT_VOTOS_NOMINAIS"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        df.to_sql("votos_zona", conn, if_exists="append", index=False)
        total += len(df)

        elapsed = time.time() - t0
        print_progress(f"  Chunk {chunk_num} | {total:,} registros inseridos | {elapsed:.0f}s")

    print_progress(f"[OK] Zonas importadas: {total:,} registros em {time.time()-t0:.0f}s")

def importar_secoes(conn):
    print_progress(f"Iniciando importação de votos por SEÇÃO...")
    print_progress(f"Arquivo: {FILE_SECAO}")

    if not os.path.exists(FILE_SECAO):
        print_progress("AVISO: Arquivo de seções não encontrado. Pulando.")
        return

    total = 0
    chunk_num = 0
    t0 = time.time()

    for chunk in pd.read_csv(
        FILE_SECAO,
        sep=";",
        encoding="latin-1",
        chunksize=CHUNKSIZE,
        dtype=str,
        on_bad_lines="skip"
    ):
        chunk_num += 1

        # Filtrar cargos
        chunk["CD_CARGO"] = pd.to_numeric(chunk["CD_CARGO"], errors="coerce")
        chunk = chunk[chunk["CD_CARGO"].isin(CARGOS)]

        if chunk.empty:
            continue

        # Verificar se SQ_CANDIDATO existe, senão usar NR_VOTAVEL como NR_CANDIDATO
        cols_map = {
            "SQ_CANDIDATO": "SQ_CANDIDATO",
            "NM_CANDIDATO": "NM_CANDIDATO",
            "NM_URNA_CANDIDATO": "NM_URNA_CANDIDATO",
            "NR_CANDIDATO": "NR_CANDIDATO",
            "NR_VOTAVEL": "NR_CANDIDATO",  # fallback
            "NM_VOTAVEL": "NM_CANDIDATO",   # fallback
            "CD_CARGO": "CD_CARGO",
            "DS_CARGO": "DS_CARGO",
            "NR_TURNO": "NR_TURNO",
            "CD_MUNICIPIO": "CD_MUNICIPIO",
            "NM_MUNICIPIO": "NM_MUNICIPIO",
            "NR_ZONA": "NR_ZONA",
            "NR_SECAO": "NR_SECAO",
            "NR_LOCAL_VOTACAO": "NR_LOCAL_VOTACAO",
            "NM_LOCAL_VOTACAO": "NM_LOCAL_VOTACAO",
            "DS_LOCAL_VOTACAO_ENDERECO": "DS_LOCAL_VOTACAO_ENDERECO",
            "QT_VOTOS": "QT_VOTOS",
        }

        df_cols = {}
        for src, dst in cols_map.items():
            if src in chunk.columns and dst not in df_cols:
                df_cols[dst] = chunk[src]

        df = pd.DataFrame(df_cols)

        # Converter numéricos
        for col in ["SQ_CANDIDATO", "NR_CANDIDATO", "CD_CARGO", "NR_TURNO",
                    "CD_MUNICIPIO", "NR_ZONA", "NR_SECAO", "NR_LOCAL_VOTACAO", "QT_VOTOS"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        df.to_sql("votos_secao", conn, if_exists="append", index=False)
        total += len(df)

        elapsed = time.time() - t0
        print_progress(f"  Chunk {chunk_num} | {total:,} registros inseridos | {elapsed:.0f}s")

    print_progress(f"[OK] Secoes importadas: {total:,} registros em {time.time()-t0:.0f}s")

def popular_candidatos(conn):
    print_progress("Populando tabela de candidatos únicos...")

    conn.executescript("""
        INSERT OR IGNORE INTO candidatos
            (SQ_CANDIDATO, NM_CANDIDATO, NM_URNA_CANDIDATO, NR_CANDIDATO, CD_CARGO, DS_CARGO, SG_PARTIDO, NR_TURNO)
        SELECT DISTINCT
            SQ_CANDIDATO, NM_CANDIDATO, NM_URNA_CANDIDATO, NR_CANDIDATO, CD_CARGO, DS_CARGO, SG_PARTIDO, NR_TURNO
        FROM votos_zona
        WHERE SQ_CANDIDATO IS NOT NULL;
    """)

    conn.executescript("""
        INSERT OR IGNORE INTO candidatos
            (SQ_CANDIDATO, NM_CANDIDATO, NM_URNA_CANDIDATO, NR_CANDIDATO, CD_CARGO, DS_CARGO, NR_TURNO)
        SELECT DISTINCT
            SQ_CANDIDATO, NM_CANDIDATO, NM_URNA_CANDIDATO, NR_CANDIDATO, CD_CARGO, DS_CARGO, NR_TURNO
        FROM votos_secao
        WHERE SQ_CANDIDATO IS NOT NULL
          AND SQ_CANDIDATO NOT IN (SELECT SQ_CANDIDATO FROM candidatos WHERE SQ_CANDIDATO IS NOT NULL);
    """)
    conn.commit()

    count = conn.execute("SELECT COUNT(*) FROM candidatos").fetchone()[0]
    print_progress(f"[OK] {count:,} candidatos unicos registrados.")

def criar_indices(conn):
    print_progress("Criando índices para consultas rápidas...")
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS idx_zona_sq    ON votos_zona(SQ_CANDIDATO);
        CREATE INDEX IF NOT EXISTS idx_zona_nm    ON votos_zona(NM_CANDIDATO);
        CREATE INDEX IF NOT EXISTS idx_zona_mun   ON votos_zona(NM_MUNICIPIO);
        CREATE INDEX IF NOT EXISTS idx_zona_cargo ON votos_zona(CD_CARGO);

        CREATE INDEX IF NOT EXISTS idx_secao_sq    ON votos_secao(SQ_CANDIDATO);
        CREATE INDEX IF NOT EXISTS idx_secao_nm    ON votos_secao(NM_CANDIDATO);
        CREATE INDEX IF NOT EXISTS idx_secao_mun   ON votos_secao(NM_MUNICIPIO);
        CREATE INDEX IF NOT EXISTS idx_secao_zona  ON votos_secao(NR_ZONA);
        CREATE INDEX IF NOT EXISTS idx_secao_cargo ON votos_secao(CD_CARGO);

        CREATE INDEX IF NOT EXISTS idx_cand_nm     ON candidatos(NM_CANDIDATO);
        CREATE INDEX IF NOT EXISTS idx_cand_urna   ON candidatos(NM_URNA_CANDIDATO);
        CREATE INDEX IF NOT EXISTS idx_cand_nr     ON candidatos(NR_CANDIDATO);
        CREATE INDEX IF NOT EXISTS idx_cand_cargo  ON candidatos(CD_CARGO);
    """)
    conn.commit()
    print_progress("[OK] Indices criados.")

def main():
    print_progress("=" * 60)
    print_progress("MAPA ELEITORAL MG 2022 - Importacao de Dados")
    print_progress("Cargos: Deputado Estadual + Deputado Federal")
    print_progress("=" * 60)

    t_inicio = time.time()

    # Detectar estado parcial do banco
    zonas_ok = False
    secoes_ok = False

    if os.path.exists(DB_PATH):
        conn_check = sqlite3.connect(DB_PATH)
        try:
            zonas_count = conn_check.execute("SELECT COUNT(*) FROM votos_zona").fetchone()[0]
            secoes_count = conn_check.execute("SELECT COUNT(*) FROM votos_secao").fetchone()[0]
            zonas_ok = zonas_count > 0
            secoes_ok = secoes_count > 0
            print_progress(f"Banco existente detectado:")
            print_progress(f"  votos_zona:  {zonas_count:,} registros {'[OK]' if zonas_ok else '[VAZIO]'}")
            print_progress(f"  votos_secao: {secoes_count:,} registros {'[OK]' if secoes_ok else '[VAZIO]'}")
        except Exception:
            zonas_ok = False
            secoes_ok = False
        finally:
            conn_check.close()

        if zonas_ok and secoes_ok:
            print_progress("Banco completo encontrado. Nada a fazer.")
            print_progress("Para recriar, delete 'mapaeleitoral.db' e rode novamente.")
            return
        elif zonas_ok:
            print_progress("[RETOMANDO] Zonas ja importadas. Continuando com secoes...")
        else:
            print_progress("Banco incompleto. Recriando do zero...")
            conn_check = sqlite3.connect(DB_PATH)
            conn_check.close()
            os.remove(DB_PATH)
    else:
        print_progress("Criando novo banco de dados...")

    conn = sqlite3.connect(DB_PATH)

    try:
        criar_banco(conn)

        if not zonas_ok:
            importar_zonas(conn)
        else:
            print_progress("Zonas: pulando (ja importadas).")

        if not secoes_ok:
            importar_secoes(conn)
        else:
            print_progress("Secoes: pulando (ja importadas).")

        popular_candidatos(conn)
        criar_indices(conn)

        total_tempo = time.time() - t_inicio
        print_progress("=" * 60)
        print_progress(f"[CONCLUIDO] ETL concluido em {total_tempo/60:.1f} minutos!")
        print_progress(f"Banco: {DB_PATH}")

        # Estatisticas finais
        stats = {
            "candidatos": conn.execute("SELECT COUNT(*) FROM candidatos").fetchone()[0],
            "registros_zona": conn.execute("SELECT COUNT(*) FROM votos_zona").fetchone()[0],
            "registros_secao": conn.execute("SELECT COUNT(*) FROM votos_secao").fetchone()[0],
        }
        for k, v in stats.items():
            print_progress(f"  {k}: {v:,}")
        print_progress("=" * 60)

    finally:
        conn.close()

if __name__ == "__main__":
    main()
