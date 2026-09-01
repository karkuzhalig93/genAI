# RAG Pipeline — Testleaf

Demo project for storing and retrieving testcases and user stories using MongoDB Atlas Vector Search (BM25 + vector hybrid retrieval, reranking, summarization, and prompt generation). Excel data is converted to JSON, embedded via Mistral, indexed in MongoDB Atlas, then queried/reranked/summarized via Groq AI to generate test cases from user stories.

## Project Layout

```
rag-mongo-demo-v9/
├── server/
│   └── index.js              # Express API (single file, all routes) — port 3001
├── client/                   # React (CRA) frontend — port 3003
│   └── src/
│       ├── App.js            # Shell: sidebar nav + tab routing between feature panels
│       └── components/
│           ├── data/         # Excel → JSON conversion, embeddings creation
│           ├── processing/   # Query preprocessing, dedup/summarization, prompt/schema manager
│           ├── search/       # Vector, BM25, Hybrid, Reranking search UIs
│           └── settings/     # .env variable viewer/editor
├── src/                      # Backend-side pipeline logic, imported by server/index.js
│   ├── config/                # Saved MongoDB Atlas index definitions (vector/BM25)
│   ├── data/                  # Converted JSON + source Excel files
│   └── scripts/
│       ├── data-conversion/   # excel-to-json, excel-to-userstories, Jira fetch
│       ├── embeddings/        # Mistral batch embedding creation
│       ├── query-preprocessing/ # normalizer, synonym/abbreviation expansion
│       ├── search/            # standalone CLI search scripts (bm25, rerank, hybrid, etc.)
│       └── utilities/         # mistralEmbedding.js, groqClient.js (shared by server + scripts)
├── uploads/                   # Multer upload destination for raw Excel files
├── .env.example                # Required environment variables template
└── package.json                # Root scripts: dev/server/client/build
```

## End-to-End Flow

1. **Upload** — User uploads a Test Cases or User Stories Excel file via `ConvertToJson.js` → `POST /api/upload-excel`. Server converts it to JSON (`src/scripts/data-conversion/`) and writes it to `src/data/`.
2. **Embed** — User selects converted JSON file(s) in `EmbeddingsStore.js` → `POST /api/create-embeddings-batch` (or `/api/create-embeddings`). Server calls Mistral (`generateEmbedding`/`generateBatchEmbeddings`) and upserts documents + vectors into MongoDB Atlas collections (`test_cases` / `user_stories`). Progress is polled via the in-memory job tracker (`/api/jobs/:jobId`).
3. **Preprocess** — `QueryPreprocessing.js` sends a raw query to `POST /api/search/preprocess` (normalization, abbreviation + synonym expansion) before search.
4. **Search** — Depending on the tab chosen, the frontend hits one of:
   - `POST /api/search` — pure vector search (Atlas Vector Search)
   - `POST /api/search/bm25` — pure keyword/BM25 search (Atlas Search)
   - `POST /api/search/hybrid` — BM25 + vector fused search
   - `POST /api/search/user-stories` — hybrid search scoped to the `user_stories` collection, with impact/regression-risk scoring
5. **Rerank / Dedup / Summarize** — Retrieved results can be refined via `POST /api/search/rerank` (Groq semantic rerank), `POST /api/search/deduplicate`, and `POST /api/search/summarize` (`SummarizationDedup.js`).
6. **Generate** — `PromptSchemaManager.js` chains preprocess → hybrid search (+ user-stories search) → rerank → dedup → summarize → `POST /api/test-prompt` (Groq chat completion) to generate new test cases from a user story, using `GET /api/testcases/latest-id` to continue ID numbering.
7. **Settings** — `Settings.js` reads/writes non-secret runtime config via `GET/POST /api/env`.

## Backend (`server/index.js`, Express on port 3001)

- MongoDB Atlas driver (`mongodb`) for vector/BM25 search and storage — connection string + index names come from `.env` (`MONGODB_URI`, `DB_NAME`, `COLLECTION_NAME`, `VECTOR_INDEX_NAME`, `BM25_INDEX_NAME`, `USER_STORIES_COLLECTION_NAME`, `USER_STORIES_VECTOR_INDEX_NAME`).
- **Mistral AI** (`@mistralai/mistralai` via `src/scripts/utilities/mistralEmbedding.js`) generates embeddings (`MISTRAL_API_KEY`, `MISTRAL_EMBEDDING_MODEL`).
- **Groq AI** (`groq-sdk` via `src/scripts/utilities/groqClient.js`) powers reranking, summarization, and test-case generation (`GROQ_API_KEY`, `GROQ_RERANK_MODEL`, `GROQ_SUMMARIZATION_MODEL`).
- **Multer** handles Excel file uploads to `uploads/`.
- An in-memory `Map` (`jobs`) tracks long-running embedding batch jobs (auto-pruned hourly) — no persistence/Redis, so job state resets on server restart.
- `validateDbCollectionIndex()` is called before search/embedding routes to confirm the target DB, collection, and Atlas Search index actually exist before querying.

## Frontend (`client/`, CRA on port 3003)

- `App.js` is a single-page shell (MUI `AppBar` + sidebar) that swaps between components in `components/` — no client-side router; navigation is local React state.
- Every panel component hardcodes `API_BASE = 'http://localhost:3001/api'` and talks to the backend via `axios` or `fetch` directly (no shared API client/service layer).

### Component → API mapping

| Frontend Component | Backend Endpoint(s) |
|---|---|
| `components/data/ConvertToJson.js` | `POST /api/upload-excel` |
| `components/data/EmbeddingsStore.js` | `GET /api/files`, `GET /api/jobs/active`, `GET /api/jobs/:jobId`, `POST /api/create-embeddings-batch` |
| `components/processing/QueryPreprocessing.js` | `POST /api/search/preprocess`, `POST /api/search`, `POST /api/search/bm25`, `POST /api/search/hybrid` |
| `components/processing/SummarizationDedup.js` | `POST /api/search` \| `/bm25` \| `/hybrid`, `POST /api/search/deduplicate`, `POST /api/search/summarize` |
| `components/processing/PromptSchemaManager.js` | `GET /api/testcases/latest-id`, `POST /api/test-prompt`, `POST /api/search/preprocess`, `POST /api/search/hybrid`, `POST /api/search/user-stories`, `POST /api/search/rerank`, `POST /api/search/deduplicate`, `POST /api/search/summarize` |
| `components/search/QuerySearch.js` | `GET /api/metadata/distinct`, `POST /api/search` |
| `components/search/BM25Search.js` | `GET /api/metadata/distinct`, `POST /api/search/bm25` |
| `components/search/HybridSearch.js` | `GET /api/metadata/distinct`, `POST /api/search/hybrid` |
| `components/search/RerankingSearch.js` | `GET /api/metadata/distinct`, `POST /api/search/rerank` |
| `components/settings/Settings.js` | `GET /api/env`, `POST /api/env` |

## API Reference (`server/index.js`)

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/jobs/active` | List active embedding jobs |
| GET | `/api/jobs/:jobId` | Get status/progress of one job |
| GET | `/api/metadata/distinct` | Distinct field values for search filters |
| GET | `/api/files` | List files in the data directory |
| POST | `/api/upload-excel` | Upload + convert Excel → JSON (test cases or user stories) |
| POST | `/api/create-embeddings` | Create embeddings for selected files |
| POST | `/api/create-embeddings-batch` | Create embeddings via faster batch scripts |
| GET | `/api/env` | Get environment variables (Settings panel) |
| POST | `/api/env` | Update environment variables |
| POST | `/api/search/preprocess` | Normalize / expand abbreviations & synonyms in a query |
| POST | `/api/search/analyze` | Preview preprocessing effects without applying |
| POST | `/api/search/deduplicate` | Deduplicate search results by similarity |
| POST | `/api/search/summarize` | Summarize search results via Groq AI |
| POST | `/api/test-prompt` | Run a prompt through Groq chat completion |
| POST | `/api/search` | Vector search (Atlas Vector Search) |
| POST | `/api/search/bm25` | BM25 keyword search (Atlas Search) |
| POST | `/api/search/hybrid` | Hybrid (BM25 + vector) search |
| POST | `/api/search/rerank` | Semantic reranking via Groq AI |
| GET | `/api/testcases/latest-id` | Latest test case ID (for new-ID sequencing) |
| POST | `/api/search/user-stories` | Hybrid search over `user_stories`, with impact/regression scoring |

## Running Locally

```bash
npm install        # installs root deps + client deps (postinstall)
npm run dev         # runs server (3001) and client (3003) concurrently
```

Requires a populated `.env` (see `.env.example`) with MongoDB Atlas, Mistral, and Groq credentials.
