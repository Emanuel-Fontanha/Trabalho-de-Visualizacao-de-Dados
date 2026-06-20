// Estado global da aplicação, com um pub/sub simples (observer pattern).
// Toda view (mapa, timeline, histograma, detalhes) se inscreve via
// subscribe() e reage sempre que o estado muda — é o mecanismo que liga
// (linked views) as visualizações entre si: nenhuma view conhece a outra
// diretamente, todas só conhecem este módulo.

const initialFilters = {
    priceRange: null, // [min, max] em R$  -> dimensão "what"
    bbox: null, // {lonMin, lonMax, latMin, latMax} -> dimensão "where"
    dateRange: null, // [isoStart, isoEnd] -> dimensão "when"
};

const state = {
    filters: { ...initialFilters },
    selection: null, // listing_id selecionado no mapa (details on demand)
};

const listeners = new Set();

// Avisa todos os inscritos. Centralizado aqui para garantir que toda
// alteração de estado (de onde quer que venha) dispare a mesma notificação.
function notify() {
    listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function setState(patch) {
    Object.assign(state, patch);
    notify();
}

// Faz merge raso em filters (preserva os outros filtros já ativos) — assim
// cada view só precisa informar o filtro que ela mesma controla, sem se
// preocupar em repetir os filtros das outras.
export function updateFilters(patch) {
    state.filters = { ...state.filters, ...patch };
    notify();
}

export function clearFilters() {
    state.filters = { ...initialFilters };
    state.selection = null;
    notify();
}

export function setSelection(id) {
    state.selection = id;
    notify();
}

export function getState() {
    return state;
}