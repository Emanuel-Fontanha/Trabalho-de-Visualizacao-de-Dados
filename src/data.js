import { loadDb } from './config.js';

// Faixas de preço fixas usadas no histograma, EM USD (ver price_usd em
// listings_clean). Ficam fixas (em vez de recalculadas a cada filtro) para
// que o eixo X do histograma não "pule" quando o usuário aplica um filtro —
// só a altura das barras muda.
export const PRICE_BINS = [
    { min: 0, max: 25, label: '0–25' },
    { min: 25, max: 50, label: '25–50' },
    { min: 50, max: 75, label: '50–75' },
    { min: 75, max: 100, label: '75–100' },
    { min: 100, max: 150, label: '100–150' },
    { min: 150, max: 250, label: '150–250' },
    { min: 250, max: 400, label: '250–400' },
    { min: 400, max: 700, label: '400–700' },
    { min: 700, max: Infinity, label: '700+' },
];

/* Limite de VOLUME DE DADOS: quantos imóveis por cidade ficam no banco depois da carga. 
   Diferente dos limites de RENDERIZAÇÃO abaixo — este roda uma vez só, no loadAirbnb(). */
const DATA_LOAD_CAP_PER_CITY = 3000;

/*  Limites de RENDERIZAÇÃO: quantos pontos cada mapa desenha por query.
    MAX_MAP_POINTS_PER_CITY se multiplica pelo nº de cidades visíveis no 
    mapa principal; MAX_DETAIL_MAP_POINTS é total, pois o mapa de detalhe
    já mostra uma única cidade por vez. */
export const MAX_MAP_POINTS_PER_CITY = 1000;
export const MAX_DETAIL_MAP_POINTS = 1000;

// Monta a cláusula WHERE compartilhada por (quase) todas as consultas, a
// partir do objeto de filtros guardado em state.js.
export function buildWhereClause(filters = {}) {
    const clauses = ['1=1'];

    // Filtro de cidade (where)
    if (filters.cities && filters.cities.length > 0) {
        const list = filters.cities.map((c) => `'${String(c).replace(/'/g, "''")}'`).join(',');
        clauses.push(`l.city IN (${list})`);
    }

    // Filtro de preço (what)
    if (filters.priceRange) {
        const [min, max] = filters.priceRange;
        clauses.push(`l.price_usd BETWEEN ${Number(min)} AND ${Number(max)}`);
    }

    // Filtro de mapa/região (where geográfico)
    if (filters.bbox) {
        const { city, bbox } = filters.bbox;
        const { lonMin, lonMax, latMin, latMax } = bbox;
        if (city) {
            clauses.push(`l.city = '${String(city).replace(/'/g, "''")}'`);
        }
        clauses.push(`l.longitude BETWEEN ${Number(lonMin)} AND ${Number(lonMax)}`);
        clauses.push(`l.latitude BETWEEN ${Number(latMin)} AND ${Number(latMax)}`);
    }

    // Filtro de tempo (when)
    if (filters.dateRange) {
        const [start, end] = filters.dateRange;
        clauses.push(`EXISTS (
            SELECT 1 FROM reviews_clean AS r
            WHERE r.listing_id = l.listing_id
              AND r.date_parsed BETWEEN DATE '${start}' AND DATE '${end}'
        )`);
    }

    if (filters.ratingRange) {
        const [min, max] = filters.ratingRange;
        clauses.push(`l.review_scores_rating BETWEEN ${Number(min)} AND ${Number(max)}`);
    }

    return clauses.join(' AND ');
}

// DataLoader: carrega Listings/Reviews no DuckDB-WASM e expõe as consultas.
export class DataLoader {
    async init() {
        this.db = await loadDb();
        this.conn = await this.db.connect();
    }

    async loadAirbnb(listingsPath = '/Airbnb Data/Listings.csv', reviewsPath = '/Airbnb Data/Reviews.csv') {
        if (!this.db || !this.conn) throw new Error('Banco não inicializado. Chame init() primeiro.');

        const [r1, r2] = await Promise.all([fetch(listingsPath), fetch(reviewsPath)]);
        if (!r1.ok) throw new Error(`Falha ao buscar ${listingsPath} (${r1.status})`);
        if (!r2.ok) throw new Error(`Falha ao buscar ${reviewsPath} (${r2.status})`);

        const [buf1, buf2] = await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);

        // Os CSVs do Inside Airbnb costumam vir em Windows-1252, não UTF-8
        // puro. Decodificar aqui evita o erro "Invalid unicode (byte
        // sequence mismatch)" que o DuckDB lança ao ler os bytes brutos
        // como UTF-8.
        const decoder = new TextDecoder('windows-1252');
        const text1 = decoder.decode(buf1);
        const text2 = decoder.decode(buf2);

        await this.db.registerFileText('Listings.csv', text1);
        await this.db.registerFileText('Reviews.csv', text2);

        await this.conn.query(`
            CREATE OR REPLACE TABLE listings_raw AS
            SELECT * FROM read_csv_auto('Listings.csv', SAMPLE_SIZE=-1, IGNORE_ERRORS=true);
        `);

        await this.conn.query(`
            CREATE OR REPLACE TABLE reviews_raw AS
            SELECT * FROM read_csv_auto('Reviews.csv', SAMPLE_SIZE=-1, IGNORE_ERRORS=true);
        `);

        // Conta os reviews por imóvel ANTES de montar listings_clean — é o
        // critério usado pra decidir quais imóveis por cidade ficam, e
        // também pra ordenar os mapas depois (ver listingsForMap /
        // listingsInCity).
        await this.conn.query(`
            CREATE OR REPLACE TABLE review_counts AS
            SELECT TRY_CAST(listing_id AS BIGINT) AS listing_id, COUNT(*) AS n_reviews
            FROM reviews_raw
            WHERE TRY_CAST(listing_id AS BIGINT) IS NOT NULL
            GROUP BY 1;
        `);

        // n_reviews fica como coluna normal em listings_clean (sem EXCLUDE)
        // porque listingsForMap/listingsInCity precisam dela pra ordenar.
        await this.conn.query(`
            CREATE OR REPLACE TABLE listings_clean AS
            SELECT * FROM (
                SELECT
                    l.listing_id,
                    l.name,
                    l.neighbourhood,
                    l.district,
                    l.city,
                    l.property_type,
                    l.room_type,
                    l.accommodates,
                    l.bedrooms,
                    TRY_CAST(REPLACE(REPLACE(CAST(l.price AS VARCHAR), '$', ''), ',', '') AS DOUBLE) AS price,
                    TRY_CAST(REPLACE(REPLACE(CAST(l.price AS VARCHAR), '$', ''), ',', '') AS DOUBLE) / CASE l.city
                        WHEN 'Paris' THEN 0.825
                        WHEN 'Rome' THEN 0.825
                        WHEN 'New York' THEN 1.00
                        WHEN 'Sydney' THEN 1.29
                        WHEN 'Rio de Janeiro' THEN 5.40
                        WHEN 'Istanbul' THEN 7.00
                        WHEN 'Mexico City' THEN 20.0
                        WHEN 'Bangkok' THEN 30.0
                        WHEN 'Cape Town' THEN 14.8
                        WHEN 'Hong Kong' THEN 7.75
                        ELSE 1.00
                    END AS price_usd,
                    l.minimum_nights,
                    l.maximum_nights,
                    TRY_CAST(l.latitude AS DOUBLE) AS latitude,
                    TRY_CAST(l.longitude AS DOUBLE) AS longitude,
                    TRY_CAST(l.review_scores_rating AS DOUBLE) AS review_scores_rating,
                    TRY_CAST(l.review_scores_accuracy AS DOUBLE) AS review_scores_accuracy,
                    TRY_CAST(l.review_scores_cleanliness AS DOUBLE) AS review_scores_cleanliness,
                    TRY_CAST(l.review_scores_checkin AS DOUBLE) AS review_scores_checkin,
                    TRY_CAST(l.review_scores_communication AS DOUBLE) AS review_scores_communication,
                    TRY_CAST(l.review_scores_location AS DOUBLE) AS review_scores_location,
                    TRY_CAST(l.review_scores_value AS DOUBLE) AS review_scores_value,
                    l.host_id,
                    l.host_since,
                    l.host_is_superhost,
                    l.host_identity_verified,
                    l.instant_bookable,
                    COALESCE(rc.n_reviews, 0) AS n_reviews
                FROM listings_raw AS l
                LEFT JOIN review_counts AS rc ON rc.listing_id = TRY_CAST(l.listing_id AS BIGINT)
                WHERE TRY_CAST(l.latitude AS DOUBLE) IS NOT NULL
                  AND TRY_CAST(l.longitude AS DOUBLE) IS NOT NULL
                  AND TRY_CAST(REPLACE(REPLACE(CAST(l.price AS VARCHAR), '$', ''), ',', '') AS DOUBLE) IS NOT NULL
                  AND TRY_CAST(l.review_scores_rating AS DOUBLE) IS NOT NULL
            )
            QUALIFY ROW_NUMBER() OVER (PARTITION BY city ORDER BY n_reviews DESC) <= ${DATA_LOAD_CAP_PER_CITY};
        `);

        // Mantém só os reviews dos imóveis que sobraram em listings_clean —
        // já que reduzimos os listings, não faz sentido carregar reviews de
        // imóveis que nem existem mais na tabela final.
        await this.conn.query(`
            CREATE OR REPLACE TABLE reviews_clean AS
            SELECT
                TRY_CAST(r.listing_id AS BIGINT) AS listing_id,
                r.review_id,
                TRY_CAST(r.date AS DATE) AS date_parsed
            FROM reviews_raw AS r
            WHERE TRY_CAST(r.listing_id AS BIGINT) IS NOT NULL
              AND TRY_CAST(r.listing_id AS BIGINT) IN (SELECT listing_id FROM listings_clean);
        `);

        await this.conn.query(`DROP TABLE listings_raw;`);
        await this.conn.query(`DROP TABLE reviews_raw;`);
        await this.conn.query(`DROP TABLE review_counts;`);
    }

    // Executa SQL arbitrário e devolve um array de objetos JS simples.
    async query(sql) {
        if (!this.db || !this.conn) throw new Error('Banco não inicializado. Chame init() primeiro.');
        const res = await this.conn.query(sql);

        return res.toArray().map((row) => {
            const obj = row.toJSON();
            for (const key in obj) {
                // Corrige os BigInts para o D3 (Arrow devolve inteiros de
                // 64 bits como BigInt; +BigInt lança TypeError em escalas
                // do D3, então convertemos para Number aqui uma única vez).
                if (typeof obj[key] === 'bigint') obj[key] = Number(obj[key]);
            }
            return obj;
        });
    }

    // --- Consultas usadas pelas views coordenadas -------------------------

    // Limita o número de pontos por cidade (ver DATA_LOAD_CAP_PER_CITY) 
    async listingsForMap(filters = {}) {
        const where = buildWhereClause({ 
            cities: filters.cities, 
            priceRange: filters.priceRange, 
            dateRange: filters.dateRange,
            ratingRange: filters.ratingRange
        });
        const sql = `
            SELECT listing_id, name, city, neighbourhood, room_type, property_type,
                latitude, longitude, price, price_usd, review_scores_rating
            FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY city ORDER BY n_reviews DESC) AS rn
                FROM listings_clean AS l
                WHERE ${where}
            ) AS sampled
            WHERE rn <= ${MAX_MAP_POINTS_PER_CITY};
        `;
        return this.query(sql);
    }

    // query para os pontos do mapa de detalhe, depois de aplicar os filtros. 
    // Se o filtro de cidade tiver mais de MAX_MAP_POINTS_PER_CITY imóveis, ele continua limitando por cidade (como em listingsForMap) mas garantindo que o imóvel 
    // selecionado pelo usuário esteja entre eles (ver a lógica de is_selected e ORDER BY n_reviews DESC, is_selected DESC). Se o filtro de cidade tiver menos de MAX_MAP_POINTS_PER_CITY imóveis, ele mostra todos (sem limite).
    async listingsInCity(city, filters = {}, selectedListingId = null) {
        const baseWhere = buildWhereClause({ ...filters, cities: [city] });
        const hasSelection = selectedListingId != null;
        const selectedId = hasSelection ? Number(selectedListingId) : null;

        const sql = `
            SELECT listing_id, name, city, neighbourhood, room_type, property_type,
                latitude, longitude, price_usd, review_scores_rating
            FROM (
                SELECT *,
                    (${hasSelection ? `l.listing_id = ${selectedId}` : 'FALSE'}) AS is_selected,
                    ROW_NUMBER() OVER (ORDER BY n_reviews DESC) AS rn
                FROM listings_clean AS l
                WHERE (
                    (${baseWhere})
                    AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
                )
                ${hasSelection ? `OR l.listing_id = ${selectedId}` : ''}
            ) AS sampled
            WHERE rn <= ${MAX_DETAIL_MAP_POINTS} OR is_selected;
        `;
        return this.query(sql);
    }

    // query para o histograma de preços, depois de aplicar os filtros. Agrupa por faixas de preço (definidas em PRICE_BINS) e tipo de quarto (room_type).
    async priceHistogram(filters = {}) {
        const where = buildWhereClause({ 
            cities: filters.cities, 
            bbox: filters.bbox, 
            dateRange: filters.dateRange,
            ratingRange: filters.ratingRange});
        const caseLines = PRICE_BINS.map((b) =>
            b.max === Infinity
                ? `WHEN l.price_usd >= ${b.min} THEN '${b.label}'`
                : `WHEN l.price_usd >= ${b.min} AND l.price_usd < ${b.max} THEN '${b.label}'`
        ).join('\n                ');

        const sql = `
            SELECT
                CASE
                ${caseLines}
                END AS bin_label,
                l.room_type,
                COUNT(*) AS n
            FROM listings_clean AS l
            WHERE ${where} AND l.price_usd IS NOT NULL
            GROUP BY bin_label, l.room_type;
        `;
        return this.query(sql);
    }

    // query para a série temporal de reviews por mês, depois de aplicar os filtros (exceto o filtro de tempo, que é o que queremos analisar aqui). O resultado tem que ser mensal (não diário) para fazer sentido no zoom da timeline.
    async reviewsTimeSeries(filters = {}) {
        const where = buildWhereClause({ 
            cities: filters.cities, 
            priceRange: filters.priceRange, 
            bbox: filters.bbox,
            ratingRange: filters.ratingRange
        });
        const sql = `
            SELECT strftime(r.date_parsed, '%Y-%m') AS month, COUNT(*) AS n_reviews
            FROM reviews_clean AS r
            JOIN listings_clean AS l ON l.listing_id = r.listing_id
            WHERE r.date_parsed IS NOT NULL AND ${where}
            GROUP BY month
            ORDER BY month;
        `;
        return this.query(sql);
    }


    // query para a série temporal de reviews por rating (e.g. quantos reviews de cada rating cada mês), similar à reviewsTimeSeries mas agrupando por faixas de rating (e.g. 0–2, 2–4, 4–6, 6–8, 8–10).
    async summaryStats(filters = {}) {
        const where = buildWhereClause(filters);
        const sql = `
            SELECT COUNT(*) AS n_listings,
                   AVG(l.price_usd) AS avg_price,
                   AVG(l.review_scores_rating) AS avg_rating
            FROM listings_clean AS l
            WHERE ${where};
        `;
        const rows = await this.query(sql);
        return rows[0];
    }

    // query para o ranking de bairros por número de imóveis (e.g. top 5 bairros com mais imóveis disponíveis, depois de aplicar os filtros).
    async topNeighbourhoods(filters = {}, limit = 5) {
        const where = buildWhereClause(filters);
        const sql = `
            SELECT l.city, l.neighbourhood, COUNT(*) AS n_listings, AVG(l.price_usd) AS avg_price
            FROM listings_clean AS l
            WHERE ${where}
            GROUP BY l.city, l.neighbourhood
            ORDER BY n_listings DESC
            LIMIT ${Number(limit)};
        `;
        return this.query(sql);
    }

    // query para listar as cidades disponíveis (para popular o dropdown de filtro de cidade).
    async listCities() {
        const sql = `
            SELECT city, COUNT(*) AS n
            FROM listings_clean
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            GROUP BY city
            ORDER BY n DESC;
        `;
        return this.query(sql);
    }

    // query para os detalhes de um imóvel específico, dado seu listing_id. Usado para popular o painel de detalhes quando o usuário clica num ponto do mapa.
    async listingDetails(listingId) {
        const sql = `
            SELECT *
            FROM listings_clean
            WHERE listing_id = ${Number(listingId)}
            LIMIT 1;
        `;
        const rows = await this.query(sql);
        return rows[0] || null;
    }
}