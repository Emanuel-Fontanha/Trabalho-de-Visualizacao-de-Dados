import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

// Configuração do DuckDB-WASM. Os bundles são montados manualmente (em vez de
// usar duckdb.selectBundle com import() dinâmico) porque o Vite precisa
// resolver os caminhos dos arquivos .wasm/.worker em tempo de build.
const MANUAL_BUNDLES = {
    mvp: { mainModule: duckdb_wasm, mainWorker: mvp_worker },
    eh: { mainModule: duckdb_wasm_eh, mainWorker: eh_worker },
};

// Guarda uma única instância do banco (singleton): instanciar o WASM é caro,
// então se loadDb() for chamado mais de uma vez (ex: hot-reload em dev),
// devolvemos a mesma instância em vez de subir um novo worker.
let dbPromise = null;

export function loadDb() {
    if (!dbPromise) {
        dbPromise = (async () => {
            const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
            const worker = new Worker(bundle.mainWorker);
            const logger = new duckdb.ConsoleLogger();
            const db = new duckdb.AsyncDuckDB(logger, worker);
            await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
            return db;
        })();
    }
    return dbPromise;
}