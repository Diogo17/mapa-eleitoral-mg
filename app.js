/* ═══════════════════════════════════════════════════════════
   MAPA ELEITORAL MG 2022 — app.js v3
   Home Dashboard · Partido · Comparar · Penetração · Exportar
   URL Share · Histórico · Comparativo de Turnos
   ═══════════════════════════════════════════════════════════ */

const API = ''; // Deixando vazio para funcionar tanto local quanto no Render

// ── Estado Global ──────────────────────────────────────────
const state = {
  modo: 'home',           // 'home' | 'candidato' | 'municipio' | 'partido' | 'comparar'
  cargoFiltro: 'todos',
  hometurno: 1,

  // Candidato mode
  candidatoAtual: null,
  candidatoInfo: null,
  turnoAtual: 1,
  tabAtual: 'municipios',  // 'municipios'|'zonas'|'secoes'|'penetracao'|'turnos'
  municipioSelecionado: null,
  zonaSelecionada: null,
  municipios: [],
  zonas: [],
  secoesPage: 1,
  secoesTotal: 0,
  secoesPorPagina: 50,
  sortMuni: { col: 'total_votos', dir: 'desc' },
  sortZona: { col: 'total_votos', dir: 'desc' },

  // Município mode
  municipioAtual: null,
  cargoMunicipio: 'Deputado Estadual',
  turnoMunicipio: 1,
  candidatosMunicipio: [],
  candidatoSelecionadoMunicipio: null,
  secoesPageMunicipio: 1,
  secoesTotalMunicipio: 0,

  // Partido mode
  partidoAtual: null,
  turnoPartido: 1,

  // Comparar mode
  candidatoA: null,
  candidatoB: null,
  turnoComparar: 1,
  comparandoSlot: 'A',   // próximo slot a preencher
};

let timerCand = null, timerMuni = null, timerComp = null;

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkDbStatus();
  setupCandidatoSearch();
  setupMunicipioSearch();
  setupCompararSearch();
  setupFilterBtns();
  carregarPartidos();
  loadFromURL();
  renderHistorico();
  setModo('home');
});

// ─────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────
async function checkDbStatus() {
  try {
    const res = await fetch(`${API}/api/status`);
    const data = await res.json();
    const el = document.getElementById('dbStatus');
    if (data.status === 'ok') {
      el.textContent = `${fmt(data.candidatos)} candidatos · ${data.banco_mb.toFixed(0)} MB`;
      el.parentElement.querySelector('.dot').style.background = '#10b981';
    } else {
      el.textContent = 'ETL pendente';
      el.parentElement.querySelector('.dot').style.background = '#f59e0b';
    }
  } catch {
    document.getElementById('dbStatus').textContent = 'Servidor offline';
    document.getElementById('dbStatus').parentElement.querySelector('.dot').style.background = '#ef4444';
  }
}

// ─────────────────────────────────────────────
// URL COMPARTILHÁVEL
// ─────────────────────────────────────────────
function updateURL(hash) {
  history.replaceState(null, '', hash || '#');
}

function loadFromURL() {
  const hash = window.location.hash;
  if (!hash || hash === '#') return;
  const parts = hash.replace('#', '').split('/');
  if (parts[0] === 'candidato' && parts[1]) {
    setTimeout(() => selecionarCandidato(parseInt(parts[1]), ''), 300);
  } else if (parts[0] === 'municipio' && parts[1]) {
    setTimeout(() => selecionarMunicipio(decodeURIComponent(parts[1])), 300);
  } else if (parts[0] === 'partido' && parts[1]) {
    setTimeout(() => selecionarPartido(decodeURIComponent(parts[1])), 300);
  }
}

// ─────────────────────────────────────────────
// HISTÓRICO (localStorage)
// ─────────────────────────────────────────────
function addHistorico(tipo, id, label) {
  let hist = JSON.parse(localStorage.getItem('mapaHistorico') || '[]');
  hist = hist.filter(h => !(h.tipo === tipo && h.id === id));
  hist.unshift({ tipo, id, label });
  hist = hist.slice(0, 8);
  localStorage.setItem('mapaHistorico', JSON.stringify(hist));
  renderHistorico();
}

function renderHistorico() {
  const el = document.getElementById('historicoContainer');
  if (!el) return;
  const hist = JSON.parse(localStorage.getItem('mapaHistorico') || '[]');
  if (!hist.length) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = `
    <span style="font-size:0.72rem;color:var(--text-muted);margin-right:4px;flex-shrink:0">🕐 Recentes:</span>
    ${hist.map(h => `
      <button class="hist-pill" onclick="carregarHistorico('${h.tipo}','${h.id}','${esc(h.label)}')">
        ${esc(h.label)} <span class="hist-x" onclick="removerHistorico(event,'${h.tipo}','${h.id}')">✕</span>
      </button>
    `).join('')}
  `;
}

function carregarHistorico(tipo, id, label) {
  if (tipo === 'candidato') {
    setModo('candidato');
    document.getElementById('searchInput').value = label;
    selecionarCandidato(parseInt(id), label);
  } else if (tipo === 'municipio') {
    setModo('municipio');
    document.getElementById('muniSearchInput').value = label;
    selecionarMunicipio(label);
  } else if (tipo === 'partido') {
    setModo('partido');
    selecionarPartido(label);
  }
}

function removerHistorico(e, tipo, id) {
  e.stopPropagation();
  let hist = JSON.parse(localStorage.getItem('mapaHistorico') || '[]');
  hist = hist.filter(h => !(h.tipo === tipo && h.id === id));
  localStorage.setItem('mapaHistorico', JSON.stringify(hist));
  renderHistorico();
}

// ─────────────────────────────────────────────
// MODO
// ─────────────────────────────────────────────
function setModo(modo) {
  state.modo = modo;
  ['home', 'candidato', 'municipio', 'partido', 'comparar'].forEach(m => {
    const btn = document.getElementById(`mode${cap(m)}`);
    if (btn) btn.classList.toggle('active', m === modo);
    const wrap = document.getElementById(`${m}SearchWrapper`);
    if (wrap) wrap.style.display = m === modo ? 'block' : 'none';
  });
  // Sempre esconder todos os painéis
  ['emptyState','candidatoPanel','municipioPanel','partidoPanel','compararPanel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (modo === 'home') {
    document.getElementById('homePanel').style.display = 'block';
    carregarHome();
  } else {
    document.getElementById('homePanel').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
  }
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function resetPanels() {
  ['emptyState','candidatoPanel','municipioPanel','partidoPanel','compararPanel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.getElementById('homePanel').style.display = 'none';
  document.getElementById('emptyState').style.display = 'block';
}

// ─────────────────────────────────────────────
// HOME DASHBOARD
// ─────────────────────────────────────────────
async function carregarHome() {
  showLoading('Carregando dashboard...');
  try {
    const [stats, rankEst, rankFed] = await Promise.all([
      fetch(`${API}/api/estatisticas-gerais`).then(r => r.json()),
      fetch(`${API}/api/ranking-geral?cargo=Deputado+Estadual&turno=${state.hometurno}&limite=20`).then(r => r.json()),
      fetch(`${API}/api/ranking-geral?cargo=Deputado+Federal&turno=${state.hometurno}&limite=20`).then(r => r.json()),
    ]);
    renderHomeStats(stats);
    renderHomeRanking('rankEstadualBody', rankEst);
    renderHomeRanking('rankFederalBody', rankFed);
  } catch(e) {
    console.error(e);
  } finally {
    hideLoading();
  }
}

function renderHomeStats(stats) {
  const el = id => document.getElementById(id);
  el('homeStatEstadual').textContent = fmt(stats.total_candidatos_estadual);
  el('homeStatFederal').textContent = fmt(stats.total_candidatos_federal);
  el('homeStatMunicipios').textContent = fmt(stats.total_municipios);
  el('homeStatVotosEst').textContent = fmt(stats.total_votos_estadual_t1);
  el('homeStatVotosFed').textContent = fmt(stats.total_votos_federal_t1);
}

function renderHomeRanking(tbodyId, data) {
  const maxVotos = data[0]?.total_votos || 1;
  document.getElementById(tbodyId).innerHTML = data.map((c, i) => {
    const pct = ((c.total_votos / maxVotos) * 100).toFixed(1);
    const initials = (c.NM_URNA_CANDIDATO || c.NM_CANDIDATO || '?')
      .split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const rc = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    return `
      <tr class="row-link" data-sq="${c.SQ_CANDIDATO}" data-nm="${esc(c.NM_CANDIDATO)}">
        <td class="td-rank ${rc}">${i + 1}º</td>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="mini-avatar">${initials}</div>
            <div>
              <div style="font-weight:600;font-size:0.87rem">${c.NM_URNA_CANDIDATO || c.NM_CANDIDATO}</div>
              <div style="font-size:0.72rem;color:var(--text-muted)">${c.NM_CANDIDATO}</div>
            </div>
          </div>
        </td>
        <td><span class="tag tag-partido" style="font-size:0.7rem">🎖️ ${c.SG_PARTIDO}</span></td>
        <td class="td-votos">${fmt(c.total_votos)}</td>
        <td style="font-size:0.78rem;color:var(--text-muted)">${fmt(c.total_municipios)} mun.</td>
        <td>
          <div class="vote-bar-wrap">
            <div class="vote-bar"><div class="vote-bar-fill" style="width:${pct}%"></div></div>
          </div>
        </td>
      </tr>`;
  }).join('');
  document.querySelectorAll(`#${tbodyId} tr.row-link`).forEach(tr => {
    tr.addEventListener('click', () => {
      setModo('candidato');
      const sq = parseInt(tr.dataset.sq);
      const nm = tr.dataset.nm;
      document.getElementById('searchInput').value = nm;
      selecionarCandidato(sq, nm);
    });
  });
}

async function switchHomeTurno(t) {
  state.hometurno = t;
  document.getElementById('homeBtnT1').classList.toggle('active', t === 1);
  document.getElementById('homeBtnT2').classList.toggle('active', t === 2);
  showLoading('Atualizando ranking...');
  try {
    const [rankEst, rankFed] = await Promise.all([
      fetch(`${API}/api/ranking-geral?cargo=Deputado+Estadual&turno=${t}&limite=20`).then(r => r.json()),
      fetch(`${API}/api/ranking-geral?cargo=Deputado+Federal&turno=${t}&limite=20`).then(r => r.json()),
    ]);
    renderHomeRanking('rankEstadualBody', rankEst);
    renderHomeRanking('rankFederalBody', rankFed);
  } finally { hideLoading(); }
}

// ─────────────────────────────────────────────
// PARTIDOS
// ─────────────────────────────────────────────
async function carregarPartidos() {
  try {
    const res = await fetch(`${API}/api/partidos`);
    const data = await res.json();
    const sel = document.getElementById('partidoSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecione um partido...</option>' +
      data.map(p => `<option value="${esc(p.SG_PARTIDO)}">${p.SG_PARTIDO}</option>`).join('');
  } catch { /* não crítico */ }
}

async function selecionarPartido(partido) {
  state.partidoAtual = partido;
  const sel = document.getElementById('partidoSelect');
  if (sel) sel.value = partido;
  showLoading('Carregando partido...');
  try {
    await carregarDashboardPartido();
    resetPanels();
    document.getElementById('partidoPanel').style.display = 'block';
    updateURL(`#partido/${encodeURIComponent(partido)}`);
    addHistorico('partido', partido, `${partido}`);
  } catch(e) {
    showToast('Erro ao carregar partido.', 'error');
  } finally { hideLoading(); }
}

async function carregarDashboardPartido() {
  const res = await fetch(`${API}/api/partido/${encodeURIComponent(state.partidoAtual)}/candidatos?turno=${state.turnoPartido}`);
  const data = await res.json();

  document.getElementById('partidoNome').textContent = `Partido: ${state.partidoAtual}`;
  document.getElementById('partidoInfo').textContent = `${data.length} candidatos · ${state.turnoPartido}º Turno`;
  document.getElementById('partidoBtn1').classList.toggle('active', state.turnoPartido === 1);
  document.getElementById('partidoBtn2').classList.toggle('active', state.turnoPartido === 2);

  const maxVotos = data[0]?.total_votos || 1;
  document.getElementById('partidoCandBody').innerHTML = data.map((c, i) => {
    const pct = ((c.total_votos / maxVotos) * 100).toFixed(1);
    const initials = (c.NM_URNA_CANDIDATO || c.NM_CANDIDATO || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const rc = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    const isEst = c.DS_CARGO?.includes('Estadual');
    return `
      <tr class="row-link" data-sq="${c.SQ_CANDIDATO}" data-nm="${esc(c.NM_CANDIDATO)}">
        <td class="td-rank ${rc}">${i + 1}º</td>
        <td><div style="display:flex;align-items:center;gap:10px;">
          <div class="mini-avatar">${initials}</div>
          <div><div style="font-weight:600;font-size:0.87rem">${c.NM_URNA_CANDIDATO || c.NM_CANDIDATO}</div>
          <div style="font-size:0.72rem;color:var(--text-muted)">Nº ${c.NR_CANDIDATO}</div></div>
        </div></td>
        <td><span class="ac-badge ${isEst ? 'estadual' : 'federal'}" style="font-size:0.7rem">${isEst ? 'Estadual' : 'Federal'}</span></td>
        <td class="td-votos">${fmt(c.total_votos)}</td>
        <td><div class="vote-bar-wrap"><div class="vote-bar"><div class="vote-bar-fill" style="width:${pct}%"></div></div><span class="pct-label">${pct}%</span></div></td>
      </tr>`;
  }).join('');

  document.querySelectorAll('#partidoCandBody tr.row-link').forEach(tr => {
    tr.addEventListener('click', () => {
      setModo('candidato');
      document.getElementById('searchInput').value = tr.dataset.nm;
      selecionarCandidato(parseInt(tr.dataset.sq), tr.dataset.nm);
    });
  });
}

async function switchTurnoPartido(t) {
  state.turnoPartido = t;
  showLoading('Atualizando...');
  try { await carregarDashboardPartido(); } finally { hideLoading(); }
}

// ─────────────────────────────────────────────
// COMPARAR CANDIDATOS
// ─────────────────────────────────────────────
function setupCompararSearch() {
  ['A', 'B'].forEach(slot => {
    const input = document.getElementById(`compSearchInput${slot}`);
    const clear = document.getElementById(`compSearchClear${slot}`);
    if (!input) return;

    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (clear) clear.style.display = val ? 'block' : 'none';
      clearTimeout(timerComp);
      if (val.length < 2) { closeAC(`compAC${slot}`); return; }
      timerComp = setTimeout(() => fetchCompAC(val, slot), 280);
    });

    input.addEventListener('keydown', e => navKeydown(e, `compAC${slot}`));
    clear?.addEventListener('click', () => {
      input.value = '';
      if (clear) clear.style.display = 'none';
      state[`candidato${slot}`] = null;
      closeAC(`compAC${slot}`);
      atualizarCardComparar(slot, null);
    });

    document.addEventListener('mousedown', e => {
      if (!e.target.closest(`#compSearchBox${slot}`) && !e.target.closest(`#compAC${slot}`))
        closeAC(`compAC${slot}`);
    });
  });
}

async function fetchCompAC(q, slot) {
  try {
    const res = await fetch(`${API}/api/buscar_candidato?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    renderCompAC(data, slot);
  } catch { /* ignore */ }
}

function renderCompAC(items, slot) {
  const listId = `compAC${slot}`;
  const list = document.getElementById(listId);
  if (!list) return;
  if (!items.length) { list.innerHTML = '<div class="ac-empty">Nenhum candidato encontrado</div>'; list.style.display = 'block'; return; }
  list.innerHTML = items.map(c => {
    const initials = (c.NM_URNA_CANDIDATO || c.NM_CANDIDATO || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const isEst = c.DS_CARGO?.includes('Estadual');
    return `<div class="autocomplete-item" data-sq="${c.SQ_CANDIDATO}" data-nm="${esc(c.NM_CANDIDATO)}" data-urna="${esc(c.NM_URNA_CANDIDATO)}" data-cargo="${esc(c.DS_CARGO)}" data-partido="${esc(c.SG_PARTIDO)}">
      <div class="ac-avatar">${initials}</div>
      <div class="ac-info"><div class="ac-name">${c.NM_URNA_CANDIDATO || c.NM_CANDIDATO}</div>
      <div class="ac-meta">Nº ${c.NR_CANDIDATO} · ${c.SG_PARTIDO}</div></div>
      <span class="ac-badge ${isEst ? 'estadual' : 'federal'}">${isEst ? 'Est.' : 'Fed.'}</span>
    </div>`;
  }).join('');

  list.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      const sq = parseInt(item.dataset.sq);
      const nm = item.dataset.nm;
      const urna = item.dataset.urna;
      document.getElementById(`compSearchInput${slot}`).value = urna || nm;
      closeAC(listId);
      state[`candidato${slot}`] = { sq, nm, urna: urna || nm, cargo: item.dataset.cargo, partido: item.dataset.partido };
      atualizarCardComparar(slot, state[`candidato${slot}`]);
      if (state.candidatoA && state.candidatoB) executarComparacao();
    });
  });
  list.style.display = 'block';
}

function atualizarCardComparar(slot, cand) {
  const card = document.getElementById(`compCard${slot}`);
  if (!card) return;
  if (!cand) {
    card.innerHTML = `<div class="comp-empty-card">Selecione o Candidato ${slot}</div>`;
    return;
  }
  const initials = (cand.urna || cand.nm).split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const color = slot === 'A' ? 'var(--accent)' : 'var(--accent-2)';
  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;">
      <div style="width:52px;height:52px;border-radius:12px;background:${color};display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;color:#fff;flex-shrink:0">${initials}</div>
      <div>
        <div style="font-weight:700;font-size:1rem;">${cand.urna || cand.nm}</div>
        <div style="font-size:0.8rem;color:var(--text-secondary)">${cand.nm}</div>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <span class="tag tag-partido" style="font-size:0.72rem">🎖️ ${cand.partido}</span>
          <span class="tag ${cand.cargo?.includes('Estadual') ? 'tag-cargo estadual' : 'tag-cargo federal'}" style="font-size:0.72rem">${cand.cargo}</span>
        </div>
      </div>
    </div>`;
}

async function executarComparacao() {
  if (!state.candidatoA || !state.candidatoB) return;
  showLoading('Comparando candidatos...');
  try {
    const res = await fetch(`${API}/api/comparar?sq_a=${state.candidatoA.sq}&sq_b=${state.candidatoB.sq}&turno=${state.turnoComparar}`);
    const data = await res.json();
    renderComparacao(data);
    document.getElementById('compResultado').style.display = 'block';
  } catch(e) {
    showToast('Erro ao comparar candidatos.', 'error');
  } finally { hideLoading(); }
}

function renderComparacao(data) {
  const votosA = Object.fromEntries(data.candidato_a.votos.map(v => [v.NM_MUNICIPIO, v.votos]));
  const votosB = Object.fromEntries(data.candidato_b.votos.map(v => [v.NM_MUNICIPIO, v.votos]));
  const allMunis = [...new Set([...Object.keys(votosA), ...Object.keys(votosB)])].sort();

  const totalA = data.candidato_a.votos.reduce((s, v) => s + v.votos, 0);
  const totalB = data.candidato_b.votos.reduce((s, v) => s + v.votos, 0);

  // Total cards
  document.getElementById('compTotalA').textContent = fmt(totalA);
  document.getElementById('compTotalB').textContent = fmt(totalB);

  const winner = totalA > totalB ? 'A' : 'B';
  document.getElementById('compWinner').textContent = winner === 'A'
    ? `🏆 ${state.candidatoA.urna} venceu com ${fmt(totalA - totalB)} votos a mais`
    : `🏆 ${state.candidatoB.urna} venceu com ${fmt(totalB - totalA)} votos a mais`;

  // Tabela
  const tbody = document.getElementById('compBody');
  tbody.innerHTML = allMunis.map(muni => {
    const va = votosA[muni] || 0;
    const vb = votosB[muni] || 0;
    const diff = va - vb;
    const diffClass = diff > 0 ? 'diff-pos' : diff < 0 ? 'diff-neg' : '';
    const diffLabel = diff > 0 ? `+${fmt(diff)}` : fmt(diff);
    return `
      <tr>
        <td class="td-muni">${muni}</td>
        <td class="td-votos" style="color:var(--accent)">${fmt(va)}</td>
        <td class="td-votos" style="color:var(--accent-2)">${fmt(vb)}</td>
        <td class="td-votos ${diffClass}">${diffLabel}</td>
        <td>${renderMiniBar(va, vb)}</td>
      </tr>`;
  }).join('');
}

function renderMiniBar(a, b) {
  const total = a + b || 1;
  const pctA = ((a / total) * 100).toFixed(0);
  return `<div style="display:flex;height:8px;border-radius:100px;overflow:hidden;min-width:80px;">
    <div style="width:${pctA}%;background:var(--accent);transition:width 0.5s;"></div>
    <div style="flex:1;background:var(--accent-2);"></div>
  </div>`;
}

async function switchTurnoComparar(t) {
  state.turnoComparar = t;
  document.getElementById('compBtn1').classList.toggle('active', t === 1);
  document.getElementById('compBtn2').classList.toggle('active', t === 2);
  if (state.candidatoA && state.candidatoB) await executarComparacao();
}

// ─────────────────────────────────────────────
// FILTROS DE CARGO (candidato)
// ─────────────────────────────────────────────
function setupFilterBtns() {
  document.querySelectorAll('.filter-btn[data-cargo]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-cargo]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.cargoFiltro = btn.dataset.cargo;
      const val = document.getElementById('searchInput')?.value.trim() || '';
      if (val.length >= 2) fetchCandidatoAC(val);
    });
  });
}

// ─────────────────────────────────────────────
// CANDIDATO SEARCH
// ─────────────────────────────────────────────
function setupCandidatoSearch() {
  const input = document.getElementById('searchInput');
  const clear = document.getElementById('searchClear');
  if (!input) return;

  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (clear) clear.style.display = val ? 'block' : 'none';
    clearTimeout(timerCand);
    if (val.length < 2) { closeAC('autocompleteList'); return; }
    timerCand = setTimeout(() => fetchCandidatoAC(val), 280);
  });

  input.addEventListener('keydown', e => navKeydown(e, 'autocompleteList'));
  clear?.addEventListener('click', () => {
    input.value = '';
    clear.style.display = 'none';
    closeAC('autocompleteList');
    resetPanels();
  });

  document.addEventListener('mousedown', e => {
    if (!e.target.closest('#searchBox') && !e.target.closest('#autocompleteList'))
      closeAC('autocompleteList');
  });
}

async function fetchCandidatoAC(q) {
  try {
    const params = new URLSearchParams({ q });
    if (state.cargoFiltro !== 'todos') params.append('cargo', state.cargoFiltro);
    const res = await fetch(`${API}/api/buscar_candidato?${params}`);
    const data = await res.json();
    renderCandidatoAC(data);
  } catch { showToast('Erro ao conectar ao servidor.', 'error'); }
}

function renderCandidatoAC(items) {
  const list = document.getElementById('autocompleteList');
  if (!items.length) { list.innerHTML = '<div class="ac-empty">Nenhum candidato encontrado</div>'; list.style.display = 'block'; return; }
  list.innerHTML = items.map(c => {
    const initials = (c.NM_URNA_CANDIDATO || c.NM_CANDIDATO || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const isEst = c.DS_CARGO?.includes('Estadual');
    return `
      <div class="autocomplete-item" data-sq="${c.SQ_CANDIDATO}" data-nm="${esc(c.NM_CANDIDATO)}">
        <div class="ac-avatar">${initials}</div>
        <div class="ac-info">
          <div class="ac-name">${c.NM_URNA_CANDIDATO || c.NM_CANDIDATO}</div>
          <div class="ac-meta">${c.NM_CANDIDATO} · Nº ${c.NR_CANDIDATO} · ${c.SG_PARTIDO || ''}</div>
        </div>
        <span class="ac-badge ${isEst ? 'estadual' : 'federal'}">${isEst ? 'Est.' : 'Fed.'}</span>
      </div>`;
  }).join('');

  list.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      const sq = parseInt(item.dataset.sq);
      const nm = item.dataset.nm;
      document.getElementById('searchInput').value = nm;
      document.getElementById('searchClear').style.display = 'block';
      closeAC('autocompleteList');
      selecionarCandidato(sq, nm);
    });
  });
  list.style.display = 'block';
}

// ─────────────────────────────────────────────
// MUNICÍPIO SEARCH
// ─────────────────────────────────────────────
function setupMunicipioSearch() {
  const input = document.getElementById('muniSearchInput');
  const clear = document.getElementById('muniSearchClear');
  if (!input) return;

  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (clear) clear.style.display = val ? 'block' : 'none';
    clearTimeout(timerMuni);
    if (val.length < 2) { closeAC('muniAutocompleteList'); return; }
    timerMuni = setTimeout(() => fetchMunicipioAC(val), 280);
  });

  input.addEventListener('keydown', e => navKeydown(e, 'muniAutocompleteList'));
  clear?.addEventListener('click', () => {
    input.value = '';
    clear.style.display = 'none';
    closeAC('muniAutocompleteList');
    resetPanels();
  });

  document.addEventListener('mousedown', e => {
    if (!e.target.closest('#muniSearchBox') && !e.target.closest('#muniAutocompleteList'))
      closeAC('muniAutocompleteList');
  });
}

async function fetchMunicipioAC(q) {
  try {
    const res = await fetch(`${API}/api/municipios/buscar?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    renderMunicipioAC(data);
  } catch { showToast('Erro ao buscar municípios.', 'error'); }
}

function renderMunicipioAC(items) {
  const list = document.getElementById('muniAutocompleteList');
  if (!items.length) { list.innerHTML = '<div class="ac-empty">Nenhum município encontrado</div>'; list.style.display = 'block'; return; }
  list.innerHTML = items.map(m => `
    <div class="autocomplete-item" data-nm="${esc(m.NM_MUNICIPIO)}">
      <div class="ac-avatar" style="background:linear-gradient(135deg,#10b981,#059669);">🏙️</div>
      <div class="ac-info"><div class="ac-name">${m.NM_MUNICIPIO}</div>
      <div class="ac-meta">Minas Gerais · Código ${m.CD_MUNICIPIO}</div></div>
      <span class="ac-badge estadual">MG</span>
    </div>`
  ).join('');

  list.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      const nm = item.dataset.nm;
      document.getElementById('muniSearchInput').value = nm;
      document.getElementById('muniSearchClear').style.display = 'block';
      closeAC('muniAutocompleteList');
      selecionarMunicipio(nm);
    });
  });
  list.style.display = 'block';
}

// ─────────────────────────────────────────────
// SELECIONAR CANDIDATO
// ─────────────────────────────────────────────
async function selecionarCandidato(sq, nome) {
  state.candidatoAtual = sq;
  state.turnoAtual = 1;
  state.municipioSelecionado = null;
  state.zonaSelecionada = null;
  state.tabAtual = 'municipios';

  showLoading('Carregando candidato...');
  try {
    await carregarResumo();
    resetPanels();
    document.getElementById('candidatoPanel').style.display = 'block';
    switchTab('municipios', false);
    await carregarMunicipios();
    atualizarBreadcrumb();
    updateURL(`#candidato/${sq}`);
    if (nome) addHistorico('candidato', sq, nome.substring(0, 30));
  } catch(e) {
    showToast('Erro ao carregar candidato.', 'error');
    console.error(e);
  } finally { hideLoading(); }
}

async function carregarResumo() {
  const res = await fetch(`${API}/api/candidato/${state.candidatoAtual}/resumo?turno=${state.turnoAtual}`);
  if (!res.ok) throw new Error('Candidato não encontrado');
  const data = await res.json();
  state.candidatoInfo = data;
  const c = data.candidato;

  document.getElementById('candNome').textContent = c.NM_CANDIDATO || '—';
  document.getElementById('candNomeUrna').textContent =
    c.NM_URNA_CANDIDATO && c.NM_URNA_CANDIDATO !== '#NULO'
      ? `Nome de urna: ${c.NM_URNA_CANDIDATO}` : '';

  const initials = (c.NM_URNA_CANDIDATO || c.NM_CANDIDATO || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('candAvatar').textContent = initials || '🧑‍💼';

  const isEst = c.DS_CARGO?.includes('Estadual');
  document.getElementById('candTags').innerHTML = `
    <span class="tag tag-nr">Nº ${c.NR_CANDIDATO}</span>
    <span class="tag tag-partido">🎖️ ${c.SG_PARTIDO || ''}</span>
    <span class="tag tag-cargo ${isEst ? 'estadual' : 'federal'}">${c.DS_CARGO}</span>
    <button class="share-btn" onclick="compartilharLink()" title="Compartilhar link">🔗 Compartilhar</button>
  `;

  const turnos = data.totais_por_turno.map(t => t.NR_TURNO);
  document.getElementById('btn2Turno').disabled = !turnos.includes(2);
  // Mostrar/ocultar aba Turnos
  const tabTurnos = document.querySelector('[data-tab="turnos"]');
  if (tabTurnos) tabTurnos.style.display = turnos.includes(2) ? '' : 'none';

  const td = data.totais_por_turno.find(t => t.NR_TURNO === state.turnoAtual) || data.totais_por_turno[0];
  if (td) {
    document.getElementById('statVotos').textContent = fmt(td.total_votos || 0);
    document.getElementById('statMunicipios').textContent = fmt(td.total_municipios || 0);
    document.getElementById('statZonas').textContent = fmt(td.total_zonas || 0);
  }
  document.getElementById('statSecoes').textContent = fmt(data.total_secoes || 0);
  document.getElementById('btn1Turno').classList.toggle('active', state.turnoAtual === 1);
  document.getElementById('btn2Turno').classList.toggle('active', state.turnoAtual === 2);
}

function compartilharLink() {
  const url = window.location.origin + window.location.pathname + `#candidato/${state.candidatoAtual}`;
  navigator.clipboard.writeText(url).then(() => showToast('🔗 Link copiado para a área de transferência!', 'success'));
}

async function switchTurno(t) {
  if (state.turnoAtual === t) return;
  state.turnoAtual = t;
  state.municipioSelecionado = null;
  state.zonaSelecionada = null;
  showLoading('Atualizando turno...');
  try {
    await carregarResumo();
    switchTab('municipios', false);
    await carregarMunicipios();
    atualizarBreadcrumb();
  } finally { hideLoading(); }
}

// ─────────────────────────────────────────────
// ABAS DO CANDIDATO
// ─────────────────────────────────────────────
function switchTab(tab, load = true) {
  state.tabAtual = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['municipios','zonas','secoes','penetracao','turnos'].forEach(t => {
    const el = document.getElementById(`tab${cap(t)}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  if (load) {
    if (tab === 'zonas' && state.municipioSelecionado) carregarZonas(state.municipioSelecionado);
    else if (tab === 'secoes') carregarSecoes();
    else if (tab === 'penetracao') carregarPenetracao();
    else if (tab === 'turnos') carregarComparativoTurnos();
  }
}

// ─────────────────────────────────────────────
// MUNICÍPIOS
// ─────────────────────────────────────────────
async function carregarMunicipios() {
  const res = await fetch(`${API}/api/candidato/${state.candidatoAtual}/municipios?turno=${state.turnoAtual}`);
  state.municipios = await res.json();
  state.sortMuni = { col: 'total_votos', dir: 'desc' };
  renderMunicipios();
}

function renderMunicipios() {
  const filter = (document.getElementById('muniTableFilter')?.value || '').toLowerCase();
  let data = state.municipios.filter(m => !filter || m.NM_MUNICIPIO.toLowerCase().includes(filter));
  data = sortBy(data, state.sortMuni.col, state.sortMuni.dir);
  const maxVotos = data[0]?.total_votos || 1;
  document.getElementById('muniCount').textContent = `${data.length} municípios`;

  document.getElementById('muniBody').innerHTML = data.map((m, i) => {
    const pct = ((m.total_votos / maxVotos) * 100).toFixed(1);
    const rc = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    return `
      <tr class="row-link" data-muni="${esc(m.NM_MUNICIPIO)}">
        <td class="td-rank ${rc}">${i + 1}º</td>
        <td class="td-muni">${m.NM_MUNICIPIO}</td>
        <td class="td-zona">${m.total_zonas}</td>
        <td class="td-votos">${fmt(m.total_votos)}</td>
        <td>
          <div class="vote-bar-wrap">
            <div class="vote-bar"><div class="vote-bar-fill" style="width:${pct}%"></div></div>
            <span class="pct-label">${pct}%</span>
          </div>
        </td>
        <td><button class="export-mini-btn" onclick="exportarMunicipioCSV(event,'${esc(m.NM_MUNICIPIO)}')" title="Exportar CSV">⬇️</button></td>
      </tr>`;
  }).join('');

  document.querySelectorAll('#muniBody tr.row-link').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.export-mini-btn')) return;
      drillMunicipio(tr.dataset.muni);
    });
  });

  // Botão exportar geral
  const btnExp = document.getElementById('btnExportarMunicipios');
  if (btnExp) btnExp.onclick = () => exportarCSVLocal(data, ['NM_MUNICIPIO','total_zonas','total_votos'], `municipios_${state.candidatoAtual}`);

  updateSortHeaders('muni');
}

function exportarMunicipioCSV(e, muni) {
  e.stopPropagation();
  window.open(`${API}/api/candidato/${state.candidatoAtual}/exportar-secoes?municipio=${encodeURIComponent(muni)}&turno=${state.turnoAtual}`, '_blank');
}

async function drillMunicipio(municipio) {
  state.municipioSelecionado = municipio;
  state.zonaSelecionada = null;
  state.secoesPage = 1;
  atualizarBreadcrumb();
  switchTab('zonas', false);
  showLoading('Carregando zonas...');
  try { await carregarZonas(municipio); } finally { hideLoading(); }
}

// ─────────────────────────────────────────────
// ZONAS
// ─────────────────────────────────────────────
async function carregarZonas(municipio) {
  const params = new URLSearchParams({ municipio, turno: state.turnoAtual });
  const res = await fetch(`${API}/api/candidato/${state.candidatoAtual}/zonas?${params}`);
  state.zonas = await res.json();
  state.sortZona = { col: 'total_votos', dir: 'desc' };
  renderZonas(municipio);
}

function renderZonas(municipio) {
  document.getElementById('zonaSubtitle').textContent = `em ${municipio}`;
  let data = sortBy(state.zonas, state.sortZona.col, state.sortZona.dir);
  const maxVotos = data[0]?.total_votos || 1;
  document.getElementById('zonaBody').innerHTML = data.map((z, i) => {
    const pct = ((z.total_votos / maxVotos) * 100).toFixed(1);
    const rc = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    return `
      <tr class="row-link" data-zona="${z.NR_ZONA}">
        <td class="td-rank ${rc}">${i + 1}º</td>
        <td style="font-weight:600">Zona ${z.NR_ZONA}</td>
        <td class="td-votos">${fmt(z.total_votos)}</td>
        <td><div class="vote-bar-wrap"><div class="vote-bar"><div class="vote-bar-fill" style="width:${pct}%"></div></div><span class="pct-label">${pct}%</span></div></td>
      </tr>`;
  }).join('');
  document.querySelectorAll('#zonaBody tr.row-link').forEach(tr => {
    tr.addEventListener('click', () => drillZona(parseInt(tr.dataset.zona)));
  });
  updateSortHeaders('zona');
}

async function drillZona(zona) {
  state.zonaSelecionada = zona;
  state.secoesPage = 1;
  atualizarBreadcrumb();
  switchTab('secoes', false);
  showLoading('Carregando seções...');
  try { await carregarSecoes(); } finally { hideLoading(); }
}

// ─────────────────────────────────────────────
// SEÇÕES
// ─────────────────────────────────────────────
async function carregarSecoes() {
  if (!state.municipioSelecionado) return;
  const params = new URLSearchParams({
    municipio: state.municipioSelecionado,
    turno: state.turnoAtual,
    page: state.secoesPage,
    per_page: state.secoesPorPagina,
  });
  if (state.zonaSelecionada) params.append('zona', state.zonaSelecionada);
  const res = await fetch(`${API}/api/candidato/${state.candidatoAtual}/secoes?${params}`);
  const data = await res.json();
  state.secoesTotal = data.total;
  document.getElementById('secaoSubtitle').textContent = state.zonaSelecionada
    ? `Zona ${state.zonaSelecionada} · ${state.municipioSelecionado}`
    : state.municipioSelecionado;
  renderSecaoRows('secaoBody', data.data);
  const start = (state.secoesPage - 1) * state.secoesPorPagina + 1;
  const end = Math.min(state.secoesPage * state.secoesPorPagina, data.total);
  document.getElementById('secaoPageInfo').textContent = `${fmt(start)}–${fmt(end)} de ${fmt(data.total)} seções`;
  buildPagination('secaoPagination', data.pages, state.secoesPage, p => {
    state.secoesPage = p; showLoading('Carregando...'); carregarSecoes().finally(hideLoading);
  });
  // Botão exportar seções
  const btnExp = document.getElementById('btnExportarSecoes');
  if (btnExp) btnExp.onclick = () => window.open(`${API}/api/candidato/${state.candidatoAtual}/exportar-secoes?municipio=${encodeURIComponent(state.municipioSelecionado)}&turno=${state.turnoAtual}`, '_blank');
}

// ─────────────────────────────────────────────
// PENETRAÇÃO
// ─────────────────────────────────────────────
async function carregarPenetracao() {
  showLoading('Calculando penetração...');
  try {
    const res = await fetch(`${API}/api/candidato/${state.candidatoAtual}/penetracao?turno=${state.turnoAtual}`);
    const data = await res.json();
    renderPenetracao(data);
  } finally { hideLoading(); }
}

function renderPenetracao(data) {
  document.getElementById('penSecoes').textContent = fmt(data.total_secoes_com_votos);
  document.getElementById('penMedia').textContent = (data.media_votos_secao || 0).toFixed(1);
  document.getElementById('penMax').textContent = fmt(data.max_votos_secao);
  document.getElementById('penMunForte').textContent = data.municipio_mais_forte?.NM_MUNICIPIO || '—';
  document.getElementById('penMunForteVotos').textContent = data.municipio_mais_forte ? `(${fmt(data.municipio_mais_forte.votos)} votos)` : '';

  // Top 5 municípios barra
  const maxVotos = data.top5_municipios?.[0]?.votos || 1;
  document.getElementById('penTop5').innerHTML = (data.top5_municipios || []).map((m, i) => {
    const pct = ((m.votos / maxVotos) * 100).toFixed(0);
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <span style="font-size:0.75rem;color:var(--text-muted);min-width:20px">${i+1}.</span>
      <span style="font-size:0.82rem;min-width:160px;color:var(--text-primary)">${m.NM_MUNICIPIO}</span>
      <div class="vote-bar" style="flex:1"><div class="vote-bar-fill" style="width:${pct}%"></div></div>
      <span style="font-size:0.78rem;color:var(--accent);font-weight:700;min-width:70px;text-align:right">${fmt(m.votos)}</span>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// COMPARATIVO DE TURNOS
// ─────────────────────────────────────────────
async function carregarComparativoTurnos() {
  showLoading('Carregando comparativo...');
  try {
    const res = await fetch(`${API}/api/candidato/${state.candidatoAtual}/comparativo-turnos`);
    const rows = await res.json();
    renderComparativoTurnos(rows);
  } finally { hideLoading(); }
}

function renderComparativoTurnos(rows) {
  const byMuni = {};
  rows.forEach(r => {
    if (!byMuni[r.NM_MUNICIPIO]) byMuni[r.NM_MUNICIPIO] = {};
    byMuni[r.NM_MUNICIPIO][r.NR_TURNO] = r.votos;
  });

  const data = Object.entries(byMuni).map(([muni, t]) => ({
    muni, t1: t[1] || 0, t2: t[2] || 0, diff: (t[2] || 0) - (t[1] || 0)
  })).sort((a, b) => b.t1 - a.t1);

  document.getElementById('turnosBody').innerHTML = data.map(row => {
    const diffClass = row.diff > 0 ? 'diff-pos' : row.diff < 0 ? 'diff-neg' : '';
    const arrow = row.diff > 0 ? '▲' : row.diff < 0 ? '▼' : '—';
    return `<tr>
      <td class="td-muni">${row.muni}</td>
      <td class="td-votos" style="color:var(--accent)">${fmt(row.t1)}</td>
      <td class="td-votos" style="color:var(--accent-2)">${fmt(row.t2)}</td>
      <td class="${diffClass}" style="font-weight:700">${arrow} ${fmt(Math.abs(row.diff))}</td>
    </tr>`;
  }).join('');

  document.getElementById('turnosCount').textContent = `${data.length} municípios com dados em ambos os turnos`;
}

// ─────────────────────────────────────────────
// MUNICIPIO PANEL
// ─────────────────────────────────────────────
async function selecionarMunicipio(nome) {
  state.municipioAtual = nome;
  state.cargoMunicipio = 'Deputado Estadual';
  state.turnoMunicipio = 1;
  state.candidatoSelecionadoMunicipio = null;

  showLoading('Carregando município...');
  try {
    await carregarDashboardMunicipio();
    resetPanels();
    document.getElementById('municipioPanel').style.display = 'block';
    document.getElementById('secoesMuniPanel').style.display = 'none';
    updateURL(`#municipio/${encodeURIComponent(nome)}`);
    addHistorico('municipio', nome, nome);
  } catch(e) {
    showToast('Erro ao carregar município.', 'error'); console.error(e);
  } finally { hideLoading(); }
}

async function carregarDashboardMunicipio() {
  document.getElementById('muniNome').textContent = state.municipioAtual;
  document.getElementById('muniInfoText').textContent = 'Minas Gerais · Eleições Gerais 2022';
  document.querySelectorAll('[data-cargo-muni]').forEach(b => b.classList.toggle('active', b.dataset.cargoMuni === state.cargoMunicipio));
  document.getElementById('muniBtn1Turno').classList.toggle('active', state.turnoMunicipio === 1);
  document.getElementById('muniBtn2Turno').classList.toggle('active', state.turnoMunicipio === 2);

  const params = new URLSearchParams({ cargo: state.cargoMunicipio, turno: state.turnoMunicipio });
  const res = await fetch(`${API}/api/municipio/${encodeURIComponent(state.municipioAtual)}/candidatos?${params}`);
  state.candidatosMunicipio = await res.json();

  try {
    const infoRes = await fetch(`${API}/api/municipio/${encodeURIComponent(state.municipioAtual)}/info`);
    const info = await infoRes.json();
    document.getElementById('muniStatsTags').innerHTML = `
      <span class="tag tag-nr">🗺️ ${info.total_zonas || 0} Zonas</span>
      <span class="tag tag-partido">👥 ${fmt(info.total_candidatos || 0)} Candidatos</span>
    `;
  } catch { /* ignore */ }
  renderCandidatosMunicipio();
}

function renderCandidatosMunicipio() {
  const filter = (document.getElementById('candMuniFilter')?.value || '').toLowerCase();
  let data = state.candidatosMunicipio.filter(c =>
    !filter || (c.NM_URNA_CANDIDATO || c.NM_CANDIDATO || '').toLowerCase().includes(filter)
  );
  const maxVotos = data[0]?.total_votos || 1;
  document.getElementById('candMuniSubtitle').textContent = `${state.cargoMunicipio} · ${state.municipioAtual} · ${data.length} candidatos`;

  document.getElementById('candMuniBody').innerHTML = data.map((c, i) => {
    const pct = ((c.total_votos / maxVotos) * 100).toFixed(1);
    const initials = (c.NM_URNA_CANDIDATO || c.NM_CANDIDATO || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const rc = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    const isSelected = state.candidatoSelecionadoMunicipio === c.SQ_CANDIDATO;
    return `
      <tr class="cand-muni-row ${isSelected ? 'row-selected' : ''}" data-sq="${c.SQ_CANDIDATO}" data-nm="${esc(c.NM_URNA_CANDIDATO || c.NM_CANDIDATO)}">
        <td class="td-rank ${rc}">${i + 1}º</td>
        <td><div style="display:flex;align-items:center;gap:10px;">
          <div class="mini-avatar">${initials}</div>
          <div><div style="font-weight:600;font-size:0.88rem;">${c.NM_URNA_CANDIDATO || c.NM_CANDIDATO}</div>
          <div style="font-size:0.73rem;color:var(--text-muted)">Nº ${c.NR_CANDIDATO} · ${c.NM_CANDIDATO}</div></div>
        </div></td>
        <td><span class="tag tag-partido" style="font-size:0.72rem">🎖️ ${c.SG_PARTIDO || '—'}</span></td>
        <td class="td-votos">${fmt(c.total_votos)}</td>
        <td><div class="vote-bar-wrap"><div class="vote-bar"><div class="vote-bar-fill" style="width:${pct}%"></div></div><span class="pct-label">${pct}%</span></div></td>
        <td style="text-align:center;"><span class="ver-secoes-btn ${isSelected ? 'active' : ''}">${isSelected ? '▼ Aberto' : '🏫 Ver seções'}</span></td>
      </tr>`;
  }).join('');

  document.querySelectorAll('#candMuniBody tr.cand-muni-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const sq = parseInt(tr.dataset.sq), nm = tr.dataset.nm;
      if (state.candidatoSelecionadoMunicipio === sq) fecharSecoesMuni();
      else drillCandidatoMunicipio(sq, nm);
    });
  });
}

async function drillCandidatoMunicipio(sq, nome) {
  state.candidatoSelecionadoMunicipio = sq;
  state.secoesPageMunicipio = 1;
  renderCandidatosMunicipio();
  const panel = document.getElementById('secoesMuniPanel');
  panel.style.display = 'block';
  document.getElementById('secoesMuniSubtitle').textContent = `de ${nome} em ${state.municipioAtual}`;
  showLoading('Carregando seções...');
  try { await carregarSecoesMunicipio(); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  finally { hideLoading(); }
}

async function carregarSecoesMunicipio() {
  const params = new URLSearchParams({ municipio: state.municipioAtual, turno: state.turnoMunicipio, page: state.secoesPageMunicipio, per_page: 50 });
  const res = await fetch(`${API}/api/candidato/${state.candidatoSelecionadoMunicipio}/secoes?${params}`);
  const data = await res.json();
  state.secoesTotalMunicipio = data.total;
  renderSecaoRows('secoesMuniBody', data.data);
  const start = (state.secoesPageMunicipio - 1) * 50 + 1;
  const end = Math.min(state.secoesPageMunicipio * 50, data.total);
  document.getElementById('secoesMuniPageInfo').textContent = `${fmt(start)}–${fmt(end)} de ${fmt(data.total)} seções`;
  buildPagination('secoesMuniPagination', data.pages, state.secoesPageMunicipio, p => {
    state.secoesPageMunicipio = p; showLoading('Carregando...'); carregarSecoesMunicipio().finally(hideLoading);
  });
  // Exportar seções do município
  const btnExp = document.getElementById('btnExportarSecoesMuni');
  if (btnExp) btnExp.onclick = () => window.open(`${API}/api/candidato/${state.candidatoSelecionadoMunicipio}/exportar-secoes?municipio=${encodeURIComponent(state.municipioAtual)}&turno=${state.turnoMunicipio}`, '_blank');
}

function fecharSecoesMuni() {
  document.getElementById('secoesMuniPanel').style.display = 'none';
  state.candidatoSelecionadoMunicipio = null;
  renderCandidatosMunicipio();
}

async function setCargoMunicipio(cargo, btn) {
  if (state.cargoMunicipio === cargo) return;
  state.cargoMunicipio = cargo;
  state.candidatoSelecionadoMunicipio = null;
  document.getElementById('secoesMuniPanel').style.display = 'none';
  document.querySelectorAll('[data-cargo-muni]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  showLoading('Filtrando...');
  try { await carregarDashboardMunicipio(); } finally { hideLoading(); }
}

async function switchTurnoMunicipio(t) {
  if (state.turnoMunicipio === t) return;
  state.turnoMunicipio = t;
  state.candidatoSelecionadoMunicipio = null;
  document.getElementById('secoesMuniPanel').style.display = 'none';
  showLoading('Atualizando turno...');
  try { await carregarDashboardMunicipio(); } finally { hideLoading(); }
}

function filtrarCandMuni() { renderCandidatosMunicipio(); }

// ─────────────────────────────────────────────
// EXPORTAR CSV (client-side)
// ─────────────────────────────────────────────
function exportarCSVLocal(data, cols, filename) {
  if (!data || !data.length) { showToast('Nenhum dado para exportar.', 'error'); return; }
  const header = cols.join(';');
  const rows = data.map(row => cols.map(c => `"${(row[c] || '').toString().replace(/"/g, '""')}"`).join(';'));
  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast('✅ CSV exportado com sucesso!', 'success');
}

// ─────────────────────────────────────────────
// FILTRO + ORDENAÇÃO
// ─────────────────────────────────────────────
function filtrarTabela(tipo) { if (tipo === 'muni') renderMunicipios(); }

function sortTable(tipo, col) {
  const s = tipo === 'muni' ? state.sortMuni : state.sortZona;
  if (s.col === col) s.dir = s.dir === 'asc' ? 'desc' : 'asc'; else { s.col = col; s.dir = 'desc'; }
  if (tipo === 'muni') renderMunicipios(); else renderZonas(state.municipioSelecionado);
}

function updateSortHeaders(tipo) {
  const s = tipo === 'muni' ? state.sortMuni : state.sortZona;
  document.querySelectorAll(`[id^="th-${tipo}-"]`).forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.id === `th-${tipo}-${s.col}`) th.classList.add(s.dir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

function sortBy(arr, col, dir) {
  return [...arr].sort((a, b) => {
    const va = a[col], vb = b[col];
    if (typeof va === 'number' && typeof vb === 'number') return dir === 'asc' ? va - vb : vb - va;
    return dir === 'asc' ? String(va||'').localeCompare(String(vb||''),'pt-BR') : String(vb||'').localeCompare(String(va||''),'pt-BR');
  });
}

// ─────────────────────────────────────────────
// BREADCRUMB
// ─────────────────────────────────────────────
function atualizarBreadcrumb() {
  const parts = [`<span class="breadcrumb-item" onclick="voltarMunicipios()">🏙️ Municípios</span>`];
  if (state.municipioSelecionado) {
    parts.push(`<span class="breadcrumb-sep">›</span>`);
    if (state.zonaSelecionada) {
      parts.push(`<span class="breadcrumb-item" onclick="voltarZonas()">${state.municipioSelecionado}</span>`);
      parts.push(`<span class="breadcrumb-sep">›</span>`);
      parts.push(`<span class="breadcrumb-current">Zona ${state.zonaSelecionada}</span>`);
    } else {
      parts.push(`<span class="breadcrumb-current">${state.municipioSelecionado}</span>`);
    }
  }
  document.getElementById('breadcrumb').innerHTML = parts.join(' ');
}

function voltarMunicipios() {
  state.municipioSelecionado = null; state.zonaSelecionada = null;
  switchTab('municipios', false); renderMunicipios(); atualizarBreadcrumb();
}

function voltarZonas() {
  state.zonaSelecionada = null;
  switchTab('zonas', false); renderZonas(state.municipioSelecionado); atualizarBreadcrumb();
}

// ─────────────────────────────────────────────
// PAGINAÇÃO
// ─────────────────────────────────────────────
function buildPagination(containerId, pages, current, onPageFn) {
  if (!pages || pages <= 1) { document.getElementById(containerId).innerHTML = ''; return; }
  let btns = `<button class="page-btn" ${current===1?'disabled':''} data-p="${current-1}">‹</button>`;
  let s = Math.max(1, current-2), e = Math.min(pages, current+2);
  if (s > 1) btns += `<button class="page-btn" data-p="1">1</button>${s>2?'<span class="page-ellipsis">…</span>':''}`;
  for (let p = s; p <= e; p++) btns += `<button class="page-btn ${p===current?'active':''}" data-p="${p}">${p}</button>`;
  if (e < pages) btns += `${e<pages-1?'<span class="page-ellipsis">…</span>':''}<button class="page-btn" data-p="${pages}">${pages}</button>`;
  btns += `<button class="page-btn" ${current===pages?'disabled':''} data-p="${current+1}">›</button>`;
  const el = document.getElementById(containerId);
  el.innerHTML = btns;
  el.querySelectorAll('.page-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => onPageFn(parseInt(btn.dataset.p)));
  });
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function renderSecaoRows(tbodyId, items) {
  document.getElementById(tbodyId).innerHTML = items.map(s => `
    <tr>
      <td class="td-zona">Zona ${s.NR_ZONA}</td>
      <td class="td-secao">${s.NR_SECAO}</td>
      <td class="td-local td-ellipsis" title="${esc(s.NM_LOCAL_VOTACAO)}">${s.NM_LOCAL_VOTACAO||'—'}</td>
      <td class="td-local td-ellipsis td-muted" title="${esc(s.DS_LOCAL_VOTACAO_ENDERECO)}">${s.DS_LOCAL_VOTACAO_ENDERECO||'—'}</td>
      <td class="td-votos">${fmt(s.QT_VOTOS||0)}</td>
    </tr>`).join('');
}

function closeAC(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

function navKeydown(e, listId) {
  const list = document.getElementById(listId);
  if (!list || list.style.display === 'none') return;
  const items = list.querySelectorAll('.autocomplete-item');
  let idx = [...items].findIndex(el => el.classList.contains('active'));
  if (e.key === 'ArrowDown') { e.preventDefault(); if(idx>=0)items[idx].classList.remove('active'); idx=Math.min(idx+1,items.length-1); items[idx]?.classList.add('active'); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if(idx>=0)items[idx].classList.remove('active'); idx=Math.max(idx-1,0); items[idx]?.classList.add('active'); }
  else if (e.key === 'Enter') { e.preventDefault(); list.querySelector('.autocomplete-item.active')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); }
  else if (e.key === 'Escape') closeAC(listId);
}

function esc(str) { return (str||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;'); }
function fmt(n) { return (n||0).toLocaleString('pt-BR'); }
function showLoading(msg='Carregando...') { document.getElementById('loadingText').textContent=msg; document.getElementById('loadingOverlay').classList.add('active'); }
function hideLoading() { document.getElementById('loadingOverlay').classList.remove('active'); }
function showToast(msg, type='info') {
  const c=document.getElementById('toastContainer');
  const t=document.createElement('div'); t.className=`toast ${type}`; t.textContent=msg;
  c.appendChild(t); setTimeout(()=>t.remove(),4000);
}
