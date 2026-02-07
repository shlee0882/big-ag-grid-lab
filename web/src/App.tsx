import { useEffect, useMemo, useState, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import { themeQuartz } from "ag-grid-community";

type UserRow = {
  id: number;
  name: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
};

type ApiRes = {
  rows: UserRow[];
  totalCount: number;
  request: {
    page: number;
    pageSize: number;
    sort: string;
    status: string | null;
    search: string;
  };
  meta: {
    queryTimeMs: number;
    countTimeMs: number;
    countCacheTtlMs: number;
    countFromCache: boolean;
    page: number;
    pageSize: number;
    sort: string;
    status: string | null;
    search: string;
  };
};

export default function App() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "ACTIVE" | "INACTIVE">("");

  const [sort, setSort] = useState("createdAt:desc");
  const [apiResRequest, setApiResRequest] = useState<ApiRes["request"] | null>(null);
  const [meta, setMeta] = useState<ApiRes["meta"] | null>(null);
  const [fetchTotalLog, setFetchTotalLog] = useState<string>("");
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const columnDefs = useMemo<ColDef<UserRow>[]>(
    () => [
      { field: "id", width: 90, pinned: "left" },
      { field: "name", minWidth: 180 },
      { field: "email", minWidth: 240 },
      { field: "status", width: 130 },
      { field: "createdAt", headerName: "Created", minWidth: 220 },
    ],
    []
  );
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);
  
  const defaultColDef = useMemo(
    () => ({
      resizable: true,
      sortable: true,
      filter: false,
      minWidth: 140,
      flex: 1,
    }),
    []
  );

  type QueryState = {
    page: number;
    pageSize: number;
    sort: string;
    search: string;
    status: "" | "ACTIVE" | "INACTIVE";
  };

async function fetchData(q: QueryState) {
  // 이전 요청 취소
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;

  // 최신 요청만 반영
  const myReqId = ++reqIdRef.current;

  const params = new URLSearchParams();
  params.set("page", String(q.page));
  params.set("pageSize", String(q.pageSize));
  params.set("sort", q.sort);

  const searchTrim = q.search.trim();
  if (searchTrim) params.set("search", searchTrim);
  if (q.status) params.set("status", q.status);

  const t0 = performance.now();

  try {
    // promote production test
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
    const res = await fetch(`${API_BASE_URL}/api/users?${params.toString()}`, {
      signal: controller.signal,
    });
    const json: ApiRes = await res.json();
    const t1 = performance.now();

    if (myReqId !== reqIdRef.current) return; // 최신만 반영

      setRows(json.rows);
      setTotalCount(json.totalCount);
      setApiResRequest(json.request);
      setMeta({ ...json.meta, queryTimeMs: json.meta.queryTimeMs, countTimeMs: json.meta.countTimeMs });

      setFetchTotalLog(`${(t1 - t0).toFixed(1)}`);
      // 개발용 로그
      console.log(`fetch total ${(t1 - t0).toFixed(1)}ms`, json.meta);
    } catch (e: any) {
      // 취소는 정상 동작
      if (e?.name === "AbortError") return;
      console.error(e);
    }
  }

  const DEBOUNCE_MS = 350;
  useEffect(() => {
    const t = setTimeout(() => {
      fetchData({ page, pageSize, sort, search, status });
    }, DEBOUNCE_MS);

    return () => clearTimeout(t);
    // pageSize는 고정이면 빼도 되는데 지금은 포함
  }, [page, pageSize, sort, search, status]);

  return (
    <div style={{ padding: 16, width: "100%", boxSizing: "border-box" }}>
      <h2>Big Grid Lab (AG Grid + Express + SQLite)</h2>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          width: "90%",
        }}
      >
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="search name/email"
          style={{ padding: 8, width: 220 }}
        />
        {/* <button
          onClick={() => {
            setPage(1);
            fetchData();
          }}
          style={{ padding: "8px 12px" }}
        >
          Search
        </button> */}
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as any);
            setPage(1);
          }}
          style={{ padding: 8 }}
        >
          <option value="">ALL</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="INACTIVE">INACTIVE</option>
        </select>

        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          style={{ padding: 8 }}
        >
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={500}>500</option>
          <option value={2000}>2,000</option>
          <option value={1000}>1,000</option>
          <option value={10000}>10,000</option>
          <option value={100000}>100,000</option>
          <option value={500000}>500,000</option>
        </select>


      </div>

      <div style={{ padding: 16, width: "100%", boxSizing: "border-box" }}>
        <div style={{ fontSize: 14, opacity: 0.8, marginLeft: "auto" }}>
          {apiResRequest ? `req: ${JSON.stringify(apiResRequest)}` : null}
        </div>
        <div style={{ fontSize: 14, opacity: 0.8, marginLeft: "auto" }}>
          {meta ? (
            <>
              res: total: {totalCount} / queryTimeMs {meta.queryTimeMs}ms / countTimeMs {meta.countTimeMs}ms / countCacheTtlMs {meta.countCacheTtlMs}ms / countFromCache {meta.countFromCache ? "Y" : "N"} / fetchTotalMs {fetchTotalLog}ms
            </>
          ) : null}
        </div>
      </div>
      <div style={{ height: 620, width: "90%" }}>
        <AgGridReact
          // containerStyle={{ width: "60%", height: "100%" }}
          theme={themeQuartz}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          headerHeight={44}
          rowHeight={42}
          animateRows={false}
          rowSelection={undefined}
          suppressMovableColumns={true}
          onSortChanged={(e) => {
            const state = e.api.getColumnState().find((c) => c.sort);
            if (!state?.colId || !state.sort) return;
            setSort(`${state.colId}:${state.sort}`);
            setPage(1);
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 12,
          alignItems: "center",
          width: "90%",
          justifyContent: "center",
        }}
      >
        <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Prev
        </button>
        <span>Page {page}</span>
        <select
          value={page}
          onChange={(e) => setPage(Number(e.target.value))}
          style={{ padding: "6px 8px" }}
        >
          {Array.from({ length: Math.ceil(totalPages / 100) }, (_, idx) => (idx + 1) * 100).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          disabled={page * pageSize >= totalCount}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
