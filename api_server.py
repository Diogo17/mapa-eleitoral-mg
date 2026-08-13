"""
API Server - Mapa Eleitoral MG 2022
Backend FastAPI com consultas ao banco SQLite.
"""

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import sqlite3
import os
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "mapaeleitoral.db")

app = FastAPI(title="Mapa Eleitoral MG 2022", version="1.0.0")

@app.on_event("startup")
def startup_event():
    if not os.path.exists(DB_PATH) or os.path.getsize(DB_PATH) < 1000000: # Se não existir ou for menor que 1MB (corrompido)
        print("Banco de dados ausente ou incompleto. Iniciando download automático do Google Drive...")
        import gdown
        file_id = "1bWdMER2pcZxrm6C-XnM2GLJHbrug0J7B"
        url = f"https://drive.google.com/uc?id={file_id}"
        try:
            # fuzzy=True ajuda a ignorar o aviso de "arquivo muito grande para verificação de vírus"
            gdown.download(url, DB_PATH, quiet=False, fuzzy=True)
            if os.path.exists(DB_PATH) and os.path.getsize(DB_PATH) > 1000000:
                print("✅ Download do banco de dados concluído com sucesso!")
            else:
                print("❌ Erro: O arquivo baixado é muito pequeno ou inválido.")
        except Exception as e:
            print(f"❌ Erro ao baixar banco de dados: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Otimização de nuvem: Reduzido de 50000 páginas (200MB) para -20000 (20MB fixos)
    # Isso impede que 3 conexões simultâneas esgotem os 512MB do Render Free Tier
    conn.execute("PRAGMA cache_size=-20000")
    conn.execute("PRAGMA temp_store=MEMORY")
    return conn

def row_to_dict(row):
    return dict(row)

# ─────────────────────────────────────────────
# Rota raiz - servir index.html
# ─────────────────────────────────────────────
@app.get("/")
def root():
    return FileResponse(os.path.join(BASE_DIR, "index.html"))

@app.get("/styles.css")
def serve_css():
    return FileResponse(os.path.join(BASE_DIR, "styles.css"))

@app.get("/app.js")
def serve_js():
    return FileResponse(os.path.join(BASE_DIR, "app.js"))


# ─────────────────────────────────────────────
# Busca de candidatos (autocomplete)
# ─────────────────────────────────────────────
@app.get("/api/buscar_candidato")
def buscar_candidato(
    q: str = Query(..., min_length=2),
    cargo: str = Query(None)
):
    """Busca candidatos por nome ou nome de urna para autocomplete."""
    if not os.path.exists(DB_PATH):
        raise HTTPException(503, "Banco de dados não encontrado. Execute o ETL primeiro.")

    term = f"%{q.upper()}%"
    conn = get_conn()
    try:
        cargo_filter = ""
        params = [term, term]
        if cargo and cargo != "todos":
            cargo_filter = "AND DS_CARGO = ?"
            params.append(cargo)

        # Buscar candidatos únicos (agrupa por SQ_CANDIDATO para eliminar duplicatas de turno)
        sql = f"""
            SELECT SQ_CANDIDATO, NM_CANDIDATO, NM_URNA_CANDIDATO,
                   NR_CANDIDATO, DS_CARGO, SG_PARTIDO
            FROM candidatos
            WHERE (UPPER(NM_CANDIDATO) LIKE ?
               OR UPPER(NM_URNA_CANDIDATO) LIKE ?)
            {cargo_filter}
            GROUP BY NM_CANDIDATO, DS_CARGO
            ORDER BY NM_CANDIDATO
            LIMIT 20
        """
        rows = conn.execute(sql, params).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Resumo do candidato
# ─────────────────────────────────────────────
@app.get("/api/candidato/{sq_candidato}/resumo")
def resumo_candidato(sq_candidato: int, turno: int = 1):
    """Retorna total de votos, municípios, zonas e seções onde o candidato teve votos."""
    conn = get_conn()
    try:
        # Info básica
        cand = conn.execute("""
            SELECT NM_CANDIDATO, NM_URNA_CANDIDATO, NR_CANDIDATO,
                   DS_CARGO, SG_PARTIDO, NM_PARTIDO
            FROM candidatos WHERE SQ_CANDIDATO = ?
        """, [sq_candidato]).fetchone()

        if not cand:
            raise HTTPException(404, "Candidato não encontrado")

        # Totais por turno
        totais = conn.execute("""
            SELECT NR_TURNO,
                   SUM(QT_VOTOS_NOMINAIS) as total_votos,
                   COUNT(DISTINCT NM_MUNICIPIO) as total_municipios,
                   COUNT(DISTINCT NR_ZONA) as total_zonas
            FROM votos_zona
            WHERE SQ_CANDIDATO = ?
            GROUP BY NR_TURNO
            ORDER BY NR_TURNO
        """, [sq_candidato]).fetchall()

        # Total de seções
        total_secoes = conn.execute("""
            SELECT COUNT(DISTINCT NR_SECAO || '-' || NR_ZONA || '-' || CD_MUNICIPIO) as cnt
            FROM votos_secao
            WHERE SQ_CANDIDATO = ? AND NR_TURNO = ?
        """, [sq_candidato, turno]).fetchone()

        return {
            "candidato": row_to_dict(cand),
            "sq_candidato": sq_candidato,
            "totais_por_turno": [row_to_dict(t) for t in totais],
            "total_secoes": total_secoes["cnt"] if total_secoes else 0
        }
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Votos por município
# ─────────────────────────────────────────────
@app.get("/api/candidato/{sq_candidato}/municipios")
def votos_por_municipio(sq_candidato: int, turno: int = 1):
    """Retorna votos agrupados por município."""
    conn = get_conn()
    try:
        rows = conn.execute("""
            SELECT NM_MUNICIPIO, CD_MUNICIPIO,
                   SUM(QT_VOTOS_NOMINAIS) as total_votos,
                   COUNT(DISTINCT NR_ZONA) as total_zonas
            FROM votos_zona
            WHERE SQ_CANDIDATO = ? AND NR_TURNO = ?
            GROUP BY CD_MUNICIPIO, NM_MUNICIPIO
            ORDER BY total_votos DESC
        """, [sq_candidato, turno]).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Votos por zona dentro de município
# ─────────────────────────────────────────────
@app.get("/api/candidato/{sq_candidato}/zonas")
def votos_por_zona(sq_candidato: int, municipio: str = Query(...), turno: int = 1):
    """Retorna votos por zona eleitoral dentro de um município."""
    conn = get_conn()
    try:
        rows = conn.execute("""
            SELECT NR_ZONA,
                   SUM(QT_VOTOS_NOMINAIS) as total_votos
            FROM votos_zona
            WHERE SQ_CANDIDATO = ?
              AND NM_MUNICIPIO = ?
              AND NR_TURNO = ?
            GROUP BY NR_ZONA
            ORDER BY total_votos DESC
        """, [sq_candidato, municipio, turno]).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Votos por seção dentro de município/zona
# ─────────────────────────────────────────────
@app.get("/api/candidato/{sq_candidato}/secoes")
def votos_por_secao(
    sq_candidato: int,
    municipio: str = Query(...),
    zona: int = Query(None),
    turno: int = 1,
    page: int = 1,
    per_page: int = 50
):
    """Retorna votos por seção com nome e endereço do local de votação."""
    conn = get_conn()
    try:
        zona_filter = "AND NR_ZONA = ?" if zona else ""
        params = [sq_candidato, municipio, turno]
        if zona:
            params.append(zona)

        count_sql = f"""
            SELECT COUNT(*) as cnt
            FROM votos_secao
            WHERE SQ_CANDIDATO = ?
              AND NM_MUNICIPIO = ?
              AND NR_TURNO = ?
              {zona_filter}
        """
        total = conn.execute(count_sql, params).fetchone()["cnt"]

        offset = (page - 1) * per_page
        rows = conn.execute(f"""
            SELECT NR_ZONA, NR_SECAO, NR_LOCAL_VOTACAO,
                   NM_LOCAL_VOTACAO, DS_LOCAL_VOTACAO_ENDERECO,
                   QT_VOTOS
            FROM votos_secao
            WHERE SQ_CANDIDATO = ?
              AND NM_MUNICIPIO = ?
              AND NR_TURNO = ?
              {zona_filter}
            ORDER BY QT_VOTOS DESC, NR_ZONA, NR_SECAO
            LIMIT ? OFFSET ?
        """, params + [per_page, offset]).fetchall()

        return {
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
            "data": [row_to_dict(r) for r in rows]
        }
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Ranking geral de candidatos
# ─────────────────────────────────────────────
@app.get("/api/ranking")
def ranking(cargo: str = Query("Deputado Estadual"), turno: int = 1, limite: int = 20):
    """Retorna ranking dos candidatos com mais votos."""
    conn = get_conn()
    try:
        rows = conn.execute("""
            SELECT v.SQ_CANDIDATO, v.NM_CANDIDATO, v.NM_URNA_CANDIDATO,
                   v.NR_CANDIDATO, v.DS_CARGO, v.SG_PARTIDO,
                   SUM(v.QT_VOTOS_NOMINAIS) as total_votos,
                   COUNT(DISTINCT v.NM_MUNICIPIO) as total_municipios
            FROM votos_zona v
            WHERE v.DS_CARGO = ? AND v.NR_TURNO = ?
            GROUP BY v.SQ_CANDIDATO, v.NM_CANDIDATO
            ORDER BY total_votos DESC
            LIMIT ?
        """, [cargo, turno, limite]).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Status do banco
# ─────────────────────────────────────────────
@app.get("/api/status")
def status():
    if not os.path.exists(DB_PATH):
        return {"status": "sem_banco", "mensagem": "Execute o ETL primeiro."}
    conn = get_conn()
    try:
        stats = {
            "status": "ok",
            "candidatos": conn.execute("SELECT COUNT(*) FROM candidatos").fetchone()[0],
            "votos_zona": conn.execute("SELECT COUNT(*) FROM votos_zona").fetchone()[0],
            "votos_secao": conn.execute("SELECT COUNT(*) FROM votos_secao").fetchone()[0],
            "banco_mb": round(os.path.getsize(DB_PATH) / 1024 / 1024, 1)
        }
        return stats
    finally:
        conn.close()



# ─────────────────────────────────────────────
# Busca de municípios (autocomplete)
# ─────────────────────────────────────────────
@app.get("/api/municipios/buscar")
def buscar_municipio(q: str = Query(..., min_length=2)):
    """Busca municípios por nome para autocomplete."""
    if not os.path.exists(DB_PATH):
        raise HTTPException(503, "Banco de dados não encontrado.")
    conn = get_conn()
    try:
        term = f"%{q.upper()}%"
        rows = conn.execute("""
            SELECT DISTINCT NM_MUNICIPIO, CD_MUNICIPIO
            FROM votos_zona
            WHERE UPPER(NM_MUNICIPIO) LIKE ?
            ORDER BY NM_MUNICIPIO
            LIMIT 15
        """, [term]).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Candidatos mais votados em um município
# ─────────────────────────────────────────────
@app.get("/api/municipio/{municipio}/candidatos")
def candidatos_por_municipio(
    municipio: str,
    cargo: str = Query("Deputado Estadual"),
    turno: int = 1,
    limite: int = 100
):
    """Ranking de candidatos mais votados em um município."""
    conn = get_conn()
    try:
        rows = conn.execute("""
            SELECT v.SQ_CANDIDATO, v.NM_CANDIDATO, v.NM_URNA_CANDIDATO,
                   v.NR_CANDIDATO, v.DS_CARGO, v.SG_PARTIDO,
                   SUM(v.QT_VOTOS_NOMINAIS) as total_votos
            FROM votos_zona v
            WHERE v.NM_MUNICIPIO = ?
              AND v.DS_CARGO = ?
              AND v.NR_TURNO = ?
              AND v.QT_VOTOS_NOMINAIS > 0
            GROUP BY v.SQ_CANDIDATO
            ORDER BY total_votos DESC
            LIMIT ?
        """, [municipio, cargo, turno, limite]).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Info geral de um município
# ─────────────────────────────────────────────
@app.get("/api/municipio/{municipio}/info")
def info_municipio(municipio: str):
    """Informações gerais de um município."""
    conn = get_conn()
    try:
        info = conn.execute("""
            SELECT COUNT(DISTINCT NR_ZONA) as total_zonas,
                   COUNT(DISTINCT SQ_CANDIDATO) as total_candidatos,
                   SUM(QT_VOTOS_NOMINAIS) as total_votos_geral
            FROM votos_zona
            WHERE NM_MUNICIPIO = ? AND NR_TURNO = 1
        """, [municipio]).fetchone()
        return row_to_dict(info) if info else {}
    finally:
        conn.close()

# ─────────────────────────────────────────────
@app.get("/api/abstencao")
def abstencao(municipio: str = Query(...), turno: int = 1):
    conn = get_conn()
    try:
        table_exists = conn.execute("""
            SELECT name FROM sqlite_master WHERE type='table' AND name='detalhe_votacao_secao'
        """).fetchone()

        if not table_exists:
            return []

        rows = conn.execute("""
            SELECT NR_ZONA, SUM(QT_APTOS) as aptos, SUM(QT_COMPARECIMENTO) as comparecimento,
                   SUM(QT_ABSTENCOES) as abstencoes,
                   ROUND(100.0*SUM(QT_ABSTENCOES)/SUM(QT_APTOS),1) as pct_abstencao
            FROM detalhe_votacao_secao
            WHERE NM_MUNICIPIO=? AND NR_TURNO=? AND CD_CARGO=7
            GROUP BY NR_ZONA
            ORDER BY pct_abstencao DESC
        """, [municipio, turno]).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()

    finally:
        conn.close()


# ─────────────────────────────────────────────
# Ranking geral do estado
# ─────────────────────────────────────────────
@app.get("/api/ranking-geral")
def ranking_geral_new(cargo: str = Query("Deputado Estadual"), turno: int = 1, limite: int = 20):
    """Top candidatos do estado por cargo."""
    conn = get_conn()
    try:
        rows = conn.execute("""
            SELECT v.SQ_CANDIDATO, v.NM_CANDIDATO, v.NM_URNA_CANDIDATO,
                   v.NR_CANDIDATO, v.DS_CARGO, v.SG_PARTIDO,
                   SUM(v.QT_VOTOS_NOMINAIS) as total_votos,
                   COUNT(DISTINCT v.NM_MUNICIPIO) as total_municipios
            FROM votos_zona v
            WHERE v.DS_CARGO = ? AND v.NR_TURNO = ? AND v.QT_VOTOS_NOMINAIS > 0
            GROUP BY v.SQ_CANDIDATO
            ORDER BY total_votos DESC
            LIMIT ?
        """, [cargo, turno, limite]).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Lista de partidos
# ─────────────────────────────────────────────
@app.get("/api/partidos")
def listar_partidos():
    """Retorna lista de partidos."""
    conn = get_conn()
    try:
        rows = conn.execute("""
            SELECT DISTINCT SG_PARTIDO
            FROM candidatos
            WHERE SG_PARTIDO IS NOT NULL AND SG_PARTIDO != ''
            ORDER BY SG_PARTIDO
        """).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Candidatos por partido
# ─────────────────────────────────────────────
@app.get("/api/partido/{partido}/candidatos")
def candidatos_partido(partido: str, turno: int = 1):
    """Candidatos de um partido com totais de votos."""
    conn = get_conn()
    try:
        rows = conn.execute("""
            SELECT c.SQ_CANDIDATO, c.NM_CANDIDATO, c.NM_URNA_CANDIDATO,
                   c.NR_CANDIDATO, c.DS_CARGO, c.SG_PARTIDO,
                   COALESCE(SUM(v.QT_VOTOS_NOMINAIS), 0) as total_votos
            FROM candidatos c
            LEFT JOIN votos_zona v ON c.SQ_CANDIDATO = v.SQ_CANDIDATO
                AND v.NR_TURNO = ?
            WHERE c.SG_PARTIDO = ?
            GROUP BY c.SQ_CANDIDATO
            ORDER BY total_votos DESC
        """, [turno, partido]).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Análise de penetração do candidato
# ─────────────────────────────────────────────
@app.get("/api/candidato/{sq_candidato}/penetracao")
def penetracao_candidato(sq_candidato: int, turno: int = 1):
    """Análise de penetração territorial do candidato."""
    conn = get_conn()
    try:
        stats = conn.execute("""
            SELECT
                COUNT(*) as total_secoes_com_votos,
                ROUND(AVG(QT_VOTOS), 1) as media_votos_secao,
                MAX(QT_VOTOS) as max_votos_secao,
                MIN(QT_VOTOS) as min_votos_secao
            FROM votos_secao
            WHERE SQ_CANDIDATO = ? AND NR_TURNO = ? AND QT_VOTOS > 0
        """, [sq_candidato, turno]).fetchone()

        muni_forte = conn.execute("""
            SELECT NM_MUNICIPIO, SUM(QT_VOTOS_NOMINAIS) as votos
            FROM votos_zona
            WHERE SQ_CANDIDATO = ? AND NR_TURNO = ?
            GROUP BY NM_MUNICIPIO
            ORDER BY votos DESC
            LIMIT 1
        """, [sq_candidato, turno]).fetchone()

        top5_munis = conn.execute("""
            SELECT NM_MUNICIPIO, SUM(QT_VOTOS_NOMINAIS) as votos
            FROM votos_zona
            WHERE SQ_CANDIDATO = ? AND NR_TURNO = ?
            GROUP BY NM_MUNICIPIO
            ORDER BY votos DESC
            LIMIT 5
        """, [sq_candidato, turno]).fetchall()

        result = row_to_dict(stats) if stats else {}
        result["municipio_mais_forte"] = row_to_dict(muni_forte) if muni_forte else None
        result["top5_municipios"] = [row_to_dict(r) for r in top5_munis]
        return result
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Comparativo entre turnos
# ─────────────────────────────────────────────
@app.get("/api/candidato/{sq_candidato}/comparativo-turnos")
def comparativo_turnos_new(sq_candidato: int):
    """Compara desempenho do candidato entre 1T e 2T por município."""
    conn = get_conn()
    try:
        rows = conn.execute("""
            SELECT NM_MUNICIPIO, NR_TURNO,
                   SUM(QT_VOTOS_NOMINAIS) as votos
            FROM votos_zona
            WHERE SQ_CANDIDATO = ? AND NR_TURNO IN (1, 2)
            GROUP BY NM_MUNICIPIO, NR_TURNO
            ORDER BY NM_MUNICIPIO
        """, [sq_candidato]).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Comparar dois candidatos
# ─────────────────────────────────────────────
@app.get("/api/comparar")
def comparar_candidatos_new(
    sq_a: int = Query(...),
    sq_b: int = Query(...),
    turno: int = 1
):
    """Compara dois candidatos por município."""
    conn = get_conn()
    try:
        def get_votos(sq):
            rows = conn.execute("""
                SELECT NM_MUNICIPIO, SUM(QT_VOTOS_NOMINAIS) as votos
                FROM votos_zona
                WHERE SQ_CANDIDATO = ? AND NR_TURNO = ?
                GROUP BY NM_MUNICIPIO
                ORDER BY votos DESC
            """, [sq, turno]).fetchall()
            return [row_to_dict(r) for r in rows]

        def get_info(sq):
            c = conn.execute("""
                SELECT NM_CANDIDATO, NM_URNA_CANDIDATO, NR_CANDIDATO,
                       DS_CARGO, SG_PARTIDO
                FROM candidatos WHERE SQ_CANDIDATO = ?
            """, [sq]).fetchone()
            return row_to_dict(c) if c else {}

        return {
            "candidato_a": {"info": get_info(sq_a), "votos": get_votos(sq_a)},
            "candidato_b": {"info": get_info(sq_b), "votos": get_votos(sq_b)},
        }
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Estatísticas gerais (home)
# ─────────────────────────────────────────────
@app.get("/api/estatisticas-gerais")
def estatisticas_gerais_new():
    """Estatísticas gerais para a home page."""
    if not os.path.exists(DB_PATH):
        return {}
    conn = get_conn()
    try:
        def count(sql, params=None):
            return conn.execute(sql, params or []).fetchone()[0]
        return {
            "total_candidatos_estadual": count("SELECT COUNT(*) FROM candidatos WHERE DS_CARGO='Deputado Estadual'"),
            "total_candidatos_federal": count("SELECT COUNT(*) FROM candidatos WHERE DS_CARGO='Deputado Federal'"),
            "total_municipios": count("SELECT COUNT(DISTINCT NM_MUNICIPIO) FROM votos_zona"),
            "total_votos_estadual_t1": count("SELECT COALESCE(SUM(QT_VOTOS_NOMINAIS),0) FROM votos_zona WHERE DS_CARGO='Deputado Estadual' AND NR_TURNO=1"),
            "total_votos_federal_t1": count("SELECT COALESCE(SUM(QT_VOTOS_NOMINAIS),0) FROM votos_zona WHERE DS_CARGO='Deputado Federal' AND NR_TURNO=1"),
        }
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Exportar CSV
# ─────────────────────────────────────────────
from fastapi.responses import StreamingResponse
import csv, io

@app.get("/api/candidato/{sq_candidato}/exportar-municipios")
def exportar_municipios(sq_candidato: int, turno: int = 1):
    """Exporta votos por município como CSV."""
    conn = get_conn()
    try:
        rows = conn.execute("""
            SELECT NM_MUNICIPIO, NR_ZONA, SUM(QT_VOTOS_NOMINAIS) as total_votos
            FROM votos_zona
            WHERE SQ_CANDIDATO = ? AND NR_TURNO = ?
            GROUP BY NM_MUNICIPIO, NR_ZONA
            ORDER BY total_votos DESC
        """, [sq_candidato, turno]).fetchall()
    finally:
        conn.close()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    writer.writerow(['Municipio', 'Zona', 'Total_Votos'])
    for r in rows:
        writer.writerow([r['NM_MUNICIPIO'], r['NR_ZONA'], r['total_votos']])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type='text/csv',
        headers={'Content-Disposition': f'attachment; filename=votos_{sq_candidato}_t{turno}.csv'}
    )


@app.get("/api/candidato/{sq_candidato}/exportar-secoes")
def exportar_secoes_csv(sq_candidato: int, municipio: str = Query(None), turno: int = 1):
    """Exporta votos por seção como CSV."""
    conn = get_conn()
    try:
        muni_filter = "AND NM_MUNICIPIO = ?" if municipio else ""
        params = [sq_candidato, turno]
        if municipio:
            params.append(municipio)
        rows = conn.execute(f"""
            SELECT NM_MUNICIPIO, NR_ZONA, NR_SECAO, NM_LOCAL_VOTACAO,
                   DS_LOCAL_VOTACAO_ENDERECO, QT_VOTOS
            FROM votos_secao
            WHERE SQ_CANDIDATO = ? AND NR_TURNO = ? {muni_filter}
            ORDER BY NM_MUNICIPIO, NR_ZONA, NR_SECAO
        """, params).fetchall()
    finally:
        conn.close()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    writer.writerow(['Municipio','Zona','Secao','Local_Votacao','Endereco','Votos'])
    for r in rows:
        writer.writerow([r['NM_MUNICIPIO'], r['NR_ZONA'], r['NR_SECAO'],
                         r['NM_LOCAL_VOTACAO'], r['DS_LOCAL_VOTACAO_ENDERECO'], r['QT_VOTOS']])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type='text/csv',
        headers={'Content-Disposition': f'attachment; filename=secoes_{sq_candidato}_t{turno}.csv'}
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api_server:app", host="127.0.0.1", port=8000, reload=False)
