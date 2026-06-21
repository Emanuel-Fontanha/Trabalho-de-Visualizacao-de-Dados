import { DataLoader, PRICE_BINS } from './data.js';
import { subscribe, getState, updateFilters, setSelection, clearFilters } from './state.js';
import { createMap } from './views/map.js';
import { createTimeline } from './timeline.js';
import { createHistogram } from './histogram.js';
import { renderOverview, renderListing } from './details.js';

const loader = new DataLoader();

const detailsEl = document.querySelector('#details');
const statusEl = document.querySelector('#filter-status');
const loadingEl = document.querySelector('#loading');
const clearBtn = document.querySelector('#clear-filters');
// *** NOVO: elemento que mostra "N filtros ativos" ao lado do botão de
// limpar — ver showClearFeedback()/updateActiveFilterCount() abaixo.
const activeFilterCountEl = document.querySelector('#active-filter-count');
// *** NOVO: filtro de cidade (where) — pedido explícito do enunciado do
// trabalho ("filtro por região"). #city-filter é uma div vazia no HTML;
// os chips são criados dinamicamente em buildCityChips(), depois que
// loader.listCities() traz as cidades realmente presentes na amostra.
const cityFilterEl = document.querySelector('#city-filter');

// --- Views --------------------------------------------------------------
// Cada view só conhece seu próprio SVG e os callbacks que dispara — toda a
// coordenação entre elas passa pelo state.js (nenhuma view chama a outra
// diretamente).
const mapView = createMap('#map', {
    onSelect: (d) => setSelection(d.listing_id),
    onBrush: (bbox) => updateFilters({ bbox }),
});

const timelineView = createTimeline('#timeline-chart', {
    onBrush: (range) => updateFilters({ dateRange: range }),
});

const histogramView = createHistogram('#histogram-chart', {
    onBarClick: (binLabel) => {
        const bin = PRICE_BINS.find((b) => b.label === binLabel);
        if (!bin) return;
        const max = bin.max === Infinity ? 1e9 : bin.max;
        const current = getState().filters.priceRange;
        const isActive = current && current[0] === bin.min && current[1] === max;
        // clicar de novo na mesma barra remove o filtro (toggle)
        updateFilters({ priceRange: isActive ? null : [bin.min, max] });
    },
});

// Acha o bin ativo (se houver) a partir do filtro de preço corrente, só
// para destacar a barra correspondente no histograma.
function activeBinLabel(filters) {
    if (!filters.priceRange) return null;
    const [min, max] = filters.priceRange;
    const bin = PRICE_BINS.find((b) => b.min === min && (b.max === Infinity ? max === 1e9 : b.max === max));
    return bin ? bin.label : null;
}

// *** NOVO: monta os chips de filtro de cidade (where), um por cidade
// presente na amostra. Clicar faz toggle (seleciona/deseleciona); nenhuma
// cidade marcada = sem filtro = todas as 10. Reaproveita o mesmo
// updateFilters() de qualquer outra view — o chip de cidade não é
// estruturalmente diferente de um brush ou de um clique de barra, é só
// outra fonte de mudança de estado.
//
// `selected` vive fora de buildCityChips (em vez de dentro dela) só para
// que clearCityChips() consiga limpá-lo também — se ficasse só no closure
// da função, "Limpar filtros" resetaria a aparência dos chips mas o Set
// continuaria com as cidades antigas, e o próximo clique do usuário
// removeria (em vez de adicionar) a cidade clicada.
const selectedCities = new Set();

function buildCityChips(cities) {
    if (!cityFilterEl) return;
    cityFilterEl.innerHTML = '';
    selectedCities.clear();

    cities.forEach(({ city, n }) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'city-chip';
        chip.textContent = `${city} (${n})`;
        chip.addEventListener('click', () => {
            if (selectedCities.has(city)) selectedCities.delete(city);
            else selectedCities.add(city);
            chip.classList.toggle('active');
            updateFilters({ cities: selectedCities.size > 0 ? Array.from(selectedCities) : null });
        });
        cityFilterEl.appendChild(chip);
    });
}

function clearCityChips() {
    selectedCities.clear();
    cityFilterEl?.querySelectorAll('.city-chip.active').forEach((el) => el.classList.remove('active'));
}

// *** NOVO: feedback visual do botão "Limpar filtros" ***
// O botão, sozinho, não dizia nada sobre o que aconteceu ao ser clicado
// (nenhuma mudança de texto/cor) — o usuário só percebia o efeito
// indiretamente, vendo os gráficos mudarem. Duas coisas resolvem isso:
//  1. clique no botão troca o texto por "✓ Filtros limpos" por 1,1s;
//  2. um contador ("3 filtros ativos") aparece ao lado do botão sempre
//     que algum filtro estiver aplicado, e desaparece quando não há
//     nenhum — assim dá pra perceber a limpeza mesmo sem prestar atenção
//     exatamente no instante do clique.
const clearBtnDefaultText = clearBtn ? clearBtn.textContent : '';
let clearFeedbackTimeout = null;

function showClearFeedback() {
    if (!clearBtn) return;
    clearTimeout(clearFeedbackTimeout);
    clearBtn.textContent = '✓ Filtros limpos';
    clearBtn.classList.add('clear-btn-confirmed');
    clearFeedbackTimeout = setTimeout(() => {
        clearBtn.textContent = clearBtnDefaultText;
        clearBtn.classList.remove('clear-btn-confirmed');
    }, 1100);
}

// Conta quantos filtros estão ativos no momento (cada chave não-nula em
// state.filters conta 1, exceto cities, que conta só se tiver alguma
// cidade marcada) — usado só para o contador ao lado do botão, não afeta
// nenhuma consulta.
function countActiveFilters(filters) {
    let n = 0;
    if (filters.cities && filters.cities.length > 0) n++;
    if (filters.priceRange) n++;
    if (filters.bbox) n++;
    if (filters.dateRange) n++;
    return n;
}

function updateActiveFilterCount(filters) {
    if (!activeFilterCountEl) return;
    const n = countActiveFilters(filters);
    if (n === 0) {
        activeFilterCountEl.textContent = '';
        activeFilterCountEl.style.display = 'none';
    } else {
        activeFilterCountEl.textContent = n === 1 ? '1 filtro ativo' : `${n} filtros ativos`;
        activeFilterCountEl.style.display = 'inline';
    }
}

function formatStatus(summary) {
    if (!statusEl) return;
    const n = summary?.n_listings ?? 0;
    statusEl.textContent = n === 1 ? '1 imóvel no filtro atual' : `${n} imóveis no filtro atual`;
}

// --- Re-renderização coordenada ------------------------------------------
// Toda vez que o estado muda (qualquer filtro ou seleção), refaz as 5
// consultas relevantes e atualiza as 4 views. Um contador de requisição
// evita que uma resposta antiga (de uma query lenta) sobrescreva uma mais
// recente caso o usuário mude o filtro rapidamente (race condition).
let requestId = 0;

async function renderAll(state) {
    const myRequest = ++requestId;
    const { filters, selection } = state;

    const [mapData, histData, timelineData, summary, neighbourhoods] = await Promise.all([
        loader.listingsForMap(filters),
        loader.priceHistogram(filters),
        loader.reviewsTimeSeries(filters),
        loader.summaryStats(filters),
        loader.topNeighbourhoods(filters, 5),
    ]);

    if (myRequest !== requestId) return; // uma requisição mais nova já chegou; descarta esta

    mapView.update(mapData, selection);
    timelineView.update(timelineData);
    histogramView.update(histData, activeBinLabel(filters));
    formatStatus(summary);
    updateActiveFilterCount(filters);

    if (selection) {
        const listing = await loader.listingDetails(selection);
        if (myRequest !== requestId) return;
        renderListing(detailsEl, listing, { onClose: () => setSelection(null) });
    } else {
        renderOverview(detailsEl, { summary, neighbourhoods });
    }
}

clearBtn?.addEventListener('click', () => {
    mapView.clearBrush();
    timelineView.clearBrush();
    clearCityChips();
    clearFilters();
    showClearFeedback();
});

async function main() {
    subscribe(renderAll);

    await loader.init();
    await loader.loadAirbnb();

    // *** NOVO: popula o filtro de cidade com as cidades realmente
    // presentes na amostra carregada (não hardcoded), depois que o banco
    // já está pronto para ser consultado.
    const cities = await loader.listCities();
    buildCityChips(cities);

    if (loadingEl) loadingEl.style.display = 'none';

    await renderAll(getState());

    // Exposto para depuração no console (não usado pela UI).
    window.loader = loader;
}

window.addEventListener('DOMContentLoaded', () => {
    main().catch((err) => {
        console.error(err);
        if (loadingEl) loadingEl.textContent = 'Erro ao carregar os dados — veja o console.';
    });
});