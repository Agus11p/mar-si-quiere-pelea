// main.js - Lógica centralizada con Multijugador Real (PeerJS)

/* ---------- ESTADO GLOBAL ---------- */
const STORAGE_KEYS = {
    RANKING: 'ranking',
    USER: 'msgp_username',
    GAME_ID: 'msgp_game_id' // ID de la sala actual
};

// PeerJS Instance global
let peer = null;
let conn = null; // Conexión activa P2P
let myPeerId = null;

// Estado de juego
let gameState = {
    board: Array(9).fill(null),
    turn: 'X',   // 'X' siempre empieza
    mySymbol: null, // 'X' (Host) o 'O' (Guest)
    isActive: false,
    players: { X: 'Esperando...', O: 'Esperando...' }
};

/* ---------- UTILIDADES ---------- */
function $(selector) { return document.querySelector(selector); }
function getStorage(key, defaultVal) {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : defaultVal;
}
function setStorage(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
}
function goto(page) { window.location.href = page; }

/* ---------- INICIO ---------- */
document.addEventListener('DOMContentLoaded', () => {

    // 1. SEGURIDAD: Verificar Sesión
    // Excluir login.html de la verificación (aunque login.html no carga main.js, por seguridad en el resto)
    const currentPage = window.location.pathname.split('/').pop();
    if (currentPage !== 'login.html' && !getStorage(STORAGE_KEYS.USER)) {
        window.location.href = 'login.html';
        return;
    }

    // Detectar página por body data-page
    const pageId = document.body.getAttribute('data-page');

    if (pageId === 'home') initHome();
    else if (pageId === 'matching') initMatching();
    else if (pageId === 'game') initGame();
    else if (pageId === 'result') initResult();

    // Renderizar ranking visual siempre si existe el sidebar
    renderRankingSidebar();
});


/* --- PÁGINA: HOME --- */
function initHome() {
    // Configurar bienvenida personalizada
    const currentUser = getStorage(STORAGE_KEYS.USER, 'Gamer');
    // Podríamos poner el nombre en algún lado si el diseño lo permite

    // Verificar si venimos con un ID de invitación
    const params = new URLSearchParams(window.location.search);
    const inviteId = params.get('join');

    // Renderizar ranking REAL (Sin datos falsos)
    const topList = $('#home-top-list');
    if (topList) {
        const ranking = getStorage(STORAGE_KEYS.RANKING, []);
        topList.innerHTML = ''; // Limpiar

        if (ranking.length === 0) {
            topList.innerHTML = `
                <div style="padding:2rem; text-align:center; color:#666; font-style:italic;">
                    <i class="fa-solid fa-ghost" style="font-size:2rem; margin-bottom:1rem; opacity:0.5;"></i><br>
                    Sin datos aún.<br>Sé el primero en ganar.
                </div>
            `;
        } else {
            ranking.slice(0, 10).forEach((p, i) => renderRankItem(topList, p, i));
        }
    }

    const btn = $('#join-btn');
    if (inviteId) {
        btn.innerHTML = '<i class="fa-solid fa-bolt"></i> ACEPTAR RETO';
        btn.classList.add('pulse-btn');
    }

    btn.addEventListener('click', () => {
        // Ya tenemos usuario validado por el login
        if (inviteId) {
            window.location.href = `matching.html?join=${inviteId}`;
        } else {
            window.location.href = `matching.html?create=true`;
        }
    });

    // Logout opcional
    const logoutBtn = $('.control-btn i.fa-gear')?.parentNode; // Usamos el botón de settings como logout temporal
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            if (confirm("¿Cerrar sesión?")) {
                localStorage.removeItem(STORAGE_KEYS.USER);
                window.location.href = 'login.html';
            }
        };
    }
}

function renderRankItem(container, player, index) {
    const isTop1 = index === 0;
    const li = document.createElement('li');
    li.className = `ranking-item ${isTop1 ? 'top-1' : ''}`;
    li.innerHTML = `
        <div class="rank-pos">${index + 1}</div>
        <div class="rank-info"><span class="rank-name">${player.nombre}</span><span class="rank-pts">${player.puntos} pts</span></div>
    `;
    container.appendChild(li);
}


/* --- PÁGINA: MATCHING (LOBBY) --- */
function initMatching() {
    const params = new URLSearchParams(window.location.search);
    const isHost = params.has('create');
    const targetId = params.get('join');
    const myName = getStorage(STORAGE_KEYS.USER, 'Anon');

    const centerDiv = $('.center-col');

    // Inicializar PeerJS
    peer = new Peer(null, { debug: 2 });

    peer.on('open', (id) => {
        myPeerId = id;

        // Renderizar Diseño "Radar de Búsqueda"
        if (isHost) {
            const shareUrl = `${window.location.origin}${window.location.pathname.replace('matching.html', '')}index.html?join=${id}`;

            centerDiv.innerHTML = `
                <div class="searching-container">
                    <h2 class="search-title">BUSCANDO RIVAL...</h2>
                    
                    <div class="radar-wrapper">
                        <div class="radar-circle"></div>
                        <div class="radar-circle"></div>
                        <div class="radar-icon"><i class="fa-solid fa-swords"></i></div>
                    </div>

                    <div class="search-info-card">
                        <p style="color:#aaa; font-size:0.8rem; margin-bottom:0.5rem; text-transform:uppercase;">ENLACE DE BATALLA</p>
                        <div id="copy-btn" class="copy-link-box" title="Click para copiar">
                            ${shareUrl}
                        </div>
                        <p style="color:#666; font-size:0.7rem;">Comparte este link para iniciar</p>
                    </div>

                    <button onclick="goto('index.html')" class="control-btn" style="margin-top:2rem; border-color:#555;">
                        <i class="fa-solid fa-xmark"></i> CANCELAR BÚSQUEDA
                    </button>
                </div>
            `;

            $('#copy-btn').addEventListener('click', () => {
                navigator.clipboard.writeText(shareUrl);
                alert("Link copiado! Pégalo en el chat.");
            });

            // Esperar conexión
            peer.on('connection', (c) => {
                conn = c;
                setupConnection(true); // Soy Host
            });

        } else if (targetId) {
            // MODO GUEST: Conectando
            centerDiv.innerHTML = `
                 <div class="searching-container">
                    <h2 class="search-title" style="font-size:2rem;">CONECTANDO A ARENA...</h2>
                    <div class="radar-wrapper">
                         <div class="radar-circle" style="border-color:var(--accent-cyan);"></div>
                         <div class="radar-icon" style="background:var(--accent-cyan);"><i class="fa-solid fa-satellite-dish"></i></div>
                    </div>
                </div>
            `;

            conn = peer.connect(targetId, {
                metadata: { username: myName }
            });
            conn.on('open', () => {
                setupConnection(false); // Soy Guest
            });
        }
    });

    peer.on('error', (err) => {
        alert("Error de conexión: " + err.type);
        goto('index.html');
    });
}

function setupConnection(amIHost) {
    console.log("Conexión P2P OK!");
    startGameLogic(amIHost);
}


/* --- LÓGICA DE JUEGO (ARENA MODE) --- */
function startGameLogic(amIHost) {
    const myName = getStorage(STORAGE_KEYS.USER, 'Player');

    // Configurar estado
    gameState.mySymbol = amIHost ? 'X' : 'O';
    gameState.players[gameState.mySymbol] = myName; // Temporal hasta recibir del otro

    // == RENDERIZAR ARENA (Diseño Imagen 2) ==
    const centerCol = $('.center-col');
    // Limpiamos estilos de center-col para que use todo el ancho en modo juego
    centerCol.style.display = 'block';
    centerCol.innerHTML = '';

    const arenaDiv = document.createElement('div');
    arenaDiv.className = 'arena-container';

    // HTML Estructura "Arena"
    arenaDiv.innerHTML = `
        <div class="arena-header">
            <div class="round-timer"><i class="fa-regular fa-clock"></i> <span id="game-timer">00:00</span></div>
            <div style="position:absolute; right:0; font-size:0.8rem; color:#666;">MODO: 1 VS 1</div>
        </div>

        <div class="battle-ground">
            <!-- JUGADOR IZQUIERDA (HOST / 'X') -->
            <div id="player-card-X" class="player-card">
                <div class="turn-badge">TU TURNO</div>
                <div class="player-avatar">
                   <i class="fa-solid fa-user"></i>
                </div>
                <div class="player-name" id="name-X">Host</div>
                <div class="player-pts"><i class="fa-solid fa-trophy"></i> 1,200 pts</div>
            </div>

            <!-- TABLERO -->
            <div class="board-frame">
                <div class="board-grid">
                    ${Array(9).fill(0).map((_, i) => `<div class="game-cell" data-idx="${i}"></div>`).join('')}
                </div>
            </div>

            <!-- JUGADOR DERECHA (GUEST / 'O') -->
            <div id="player-card-O" class="player-card is-rival">
                <div class="turn-badge">RIVAL</div>
                <div class="player-avatar">
                   <i class="fa-regular fa-user"></i>
                </div>
                <div class="player-name" id="name-O">Guest</div>
                <div class="player-pts"><i class="fa-solid fa-trophy"></i> 850 pts</div>
            </div>
        </div>
    `;

    centerCol.appendChild(arenaDiv);

    // Listeners del tablero
    $$('.game-cell').forEach(cell => {
        cell.addEventListener('click', () => handleCellClick(cell.dataset.idx));
    });

    // Enviar mi nombre
    conn.send({ type: 'NAME', name: myName });

    // Manejar datos
    conn.on('data', (data) => {
        if (data.type === 'NAME') {
            const rivalSymbol = amIHost ? 'O' : 'X';
            gameState.players[rivalSymbol] = data.name;

            // Actualizar Nombres en UI
            $(`#name-X`).textContent = gameState.players['X'] || '..';
            $(`#name-O`).textContent = gameState.players['O'] || '..';

            gameState.isActive = true;
            updateTurnUI();
            startTimer(); // Iniciar reloj visual
        }

        if (data.type === 'MOVE') {
            applyMove(data.index, data.symbol);
        }
    });

    // Inicializar UI Nombres (con lo que tenemos)
    $(`#name-${gameState.mySymbol}`).textContent = myName;
    updateTurnUI();
}

function updateTurnUI() {
    // Quitar activo de todos
    $$('.player-card').forEach(p => p.classList.remove('active-turn'));

    // Poner activo al actual
    const currentSymbol = gameState.turn; // 'X' o 'O'
    const card = $(`#player-card-${currentSymbol}`);
    if (card) {
        card.classList.add('active-turn');
        // Actualizar texto de badge según si soy yo
        const badge = card.querySelector('.turn-badge');
        if (badge) {
            badge.textContent = (gameState.mySymbol === currentSymbol) ? "TU TURNO" : "TURNO RIVAL";
            badge.style.background = (gameState.mySymbol === currentSymbol) ? "var(--accent-pink)" : "#444";
        }
    }
}

let timerInt;
function startTimer() {
    let sec = 0;
    const el = $('#game-timer');
    clearInterval(timerInt);
    timerInt = setInterval(() => {
        sec++;
        const m = Math.floor(sec / 60).toString().padStart(2, '0');
        const s = (sec % 60).toString().padStart(2, '0');
        el.textContent = `${m}:${s}`;
    }, 1000);
}

function handleCellClick(idx) {
    if (!gameState.isActive) return;
    if (gameState.board[idx] !== null) return;
    if (gameState.turn !== gameState.mySymbol) return; // No es mi turno

    applyMove(idx, gameState.mySymbol);
    conn.send({ type: 'MOVE', index: idx, symbol: gameState.mySymbol });
}

function applyMove(idx, symbol) {
    gameState.board[idx] = symbol;
    const cell = $(`.game-cell[data-idx="${idx}"]`);
    cell.textContent = symbol === 'X' ? '✕' : '◯'; // Usar símbolos bonitos
    cell.classList.add(symbol);

    // Verificar victoria
    if (checkWin(symbol)) {
        endGame(symbol);
        return;
    }
    if (!gameState.board.includes(null)) {
        endGame('DRAW');
        return;
    }

    gameState.turn = gameState.turn === 'X' ? 'O' : 'X';
    updateTurnUI();
}


function updateStatus() {
    // This function is now largely replaced by updateTurnUI and other direct UI updates.
    // Keeping it empty or removing it if no other part of the code explicitly calls it for a different purpose.
    // The instruction implies its content is removed.
}

function checkWin(symbol) {
    const wins = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    return wins.some(c => c.every(i => gameState.board[i] === symbol));
}

function endGame(winnerSymbol) {
    gameState.isActive = false;
    let msg = "";
    if (winnerSymbol === 'DRAW') {
        msg = "EMPATE 🤝";
    } else if (winnerSymbol === gameState.mySymbol) {
        msg = "¡GANASTE! 🏆";
        updateRankingLocal(gameState.players[gameState.mySymbol]); // +10 pts
    } else {
        msg = "PERDISTE 💀";
    }

    $('.center-col').innerHTML += `
        <div style="position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); display:flex; flex-direction:column; justify-content:center; align-items:center;">
            <h1 style="color:var(--accent-pink); font-size:3rem; margin-bottom:2rem;">${msg}</h1>
            <button onclick="goto('index.html')" class="control-btn primary" style="font-size:1.5rem;">VOLVER AL LOBBY</button>
        </div>
    `;
}

function updateRankingLocal(winnerName) {
    // Simple mock de ranking local para demo
    let ranking = getStorage(STORAGE_KEYS.RANKING, []);
    let p = ranking.find(x => x.nombre === winnerName);
    if (p) p.puntos += 10;
    else ranking.push({ nombre: winnerName, puntos: 10 });
    ranking.sort((a, b) => b.puntos - a.puntos);
    setStorage(STORAGE_KEYS.RANKING, ranking);
}

function renderRankingSidebar() {
    // Si la barra existe en el HTML actual, renderizar
    // (Ya cubierto en initHome, pero útil si se llama desde otros lados)
    // Dejo vacío porque initHome ya lo hace.
}

/* Helpers */
function $$(sel) { return document.querySelectorAll(sel); }
