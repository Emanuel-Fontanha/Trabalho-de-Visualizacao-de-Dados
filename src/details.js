const fmtUSD = (v) => (v == null || isNaN(v) ? '—' : `US$ ${Math.round(v).toLocaleString('pt-BR')}`);
const fmtNum = (v, digits = 1) => (v == null || isNaN(v) ? '—' : Number(v).toFixed(digits));

function scoreBar(label, value) {
    const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / 10) * 100));
    return `
        <div class="score-row">
            <span class="score-label">${label}</span>
            <div class="score-track"><div class="score-fill" style="width:${pct}%"></div></div>
            <span class="score-value">${value == null ? '—' : value.toFixed(1)}</span>
        </div>
    `;
}

export function renderOverview(container, { summary, neighbourhoods }) {
    const maxN = Math.max(1, ...(neighbourhoods || []).map((n) => n.n_listings));
    const rows = (neighbourhoods || [])
        .map(
            (n) => `
        <div class="nb-row">
            <span class="nb-name">${n.neighbourhood ?? '—'} <em>(${n.city ?? '—'})</em></span>
            <div class="nb-track"><div class="nb-fill" style="width:${(n.n_listings / maxN) * 100}%"></div></div>
            <span class="nb-count">${n.n_listings}</span>
        </div>`
        )
        .join('');

    container.innerHTML = `
        <div class="overview">
            <div class="stat-grid">
                <div class="stat"><span class="stat-value">${summary?.n_listings ?? 0}</span><span class="stat-label">imóveis no filtro</span></div>
                <div class="stat"><span class="stat-value">${fmtUSD(summary?.avg_price)}</span><span class="stat-label">preço médio / noite</span></div>
                <div class="stat"><span class="stat-value">${fmtNum(summary?.avg_rating, 0)}</span><span class="stat-label">avaliação média</span></div>
            </div>
            <h3>Bairros mais frequentes</h3>
            <div class="nb-list">${rows || '<p class="muted">Nenhum imóvel no filtro atual.</p>'}</div>
            <p class="hint">Clique em um ponto no mapa para ver os detalhes de um imóvel.</p>
        </div>
    `;
}

export function renderListing(container, listing, { onClose } = {}) {
    if (!listing) {
        container.innerHTML = '<p class="muted">Imóvel não encontrado.</p>';
        return;
    }

    const badges = [
        listing.host_is_superhost === 't' ? '<span class="badge badge-good">Superhost</span>' : '',
        listing.host_identity_verified === 't' ? '<span class="badge">Identidade verificada</span>' : '',
        listing.instant_bookable === 't' ? '<span class="badge">Reserva instantânea</span>' : '',
    ].join('');

    container.innerHTML = `
        <div class="listing-detail">
            <button class="back-btn" id="back-to-overview">← Voltar para visão geral</button>
            <h3>${listing.name ?? 'Sem nome'}</h3>
            <p class="muted">${listing.neighbourhood ?? ''}, ${listing.city ?? ''}${listing.district ? ' · ' + listing.district : ''}</p>
            <div class="badges">${badges}</div>

            <div class="stat-grid">
                <div class="stat"><span class="stat-value">${fmtUSD(listing.price_usd)}</span><span class="stat-label">por noite</span></div>
                <div class="stat"><span class="stat-value">${listing.accommodates ?? '—'}</span><span class="stat-label">hóspedes</span></div>
                <div class="stat"><span class="stat-value">${listing.bedrooms ?? '—'}</span><span class="stat-label">quartos</span></div>
            </div>

            <p><strong>Tipo:</strong> ${listing.room_type ?? '—'} (${listing.property_type ?? '—'})</p>
            <p><strong>Estadia mínima:</strong> ${listing.minimum_nights ?? '—'} noites</p>

            <h3>Avaliações ${listing.review_scores_rating != null ? `— ${listing.review_scores_rating.toFixed(0)}/100` : ''}</h3>
            <div class="scores">
                ${scoreBar('Precisão', listing.review_scores_accuracy)}
                ${scoreBar('Limpeza', listing.review_scores_cleanliness)}
                ${scoreBar('Check-in', listing.review_scores_checkin)}
                ${scoreBar('Comunicação', listing.review_scores_communication)}
                ${scoreBar('Localização', listing.review_scores_location)}
                ${scoreBar('Custo-benefício', listing.review_scores_value)}
            </div>
        </div>
    `;

    const backBtn = container.querySelector('#back-to-overview');
    if (backBtn && onClose) backBtn.addEventListener('click', onClose);
}