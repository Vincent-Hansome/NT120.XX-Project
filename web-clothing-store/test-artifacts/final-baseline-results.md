# Kết quả baseline local — 29/10/2026

**Đã hoàn tất các phần sửa và kiểm chứng trong phạm vi demo local đã thống nhất.**
Checkout mất phản hồi rồi gửi lại cùng mã trả về đơn cũ, giữ nguyên giỏ mới.
Đã vá các dependency có cảnh báo; audit backend/frontend hiện bằng 0.
Migration, backend và frontend đã được áp dụng vào Docker, bốn service healthy.

Kết quả mới: **79 test thường, 19 test MySQL nghiệp vụ, 7 test danh mục, 6 kịch bản
DB availability và 9 kiểm tra recovery/migration đều đạt; 52 file đúng cú pháp.**
Có log và ảnh trình duyệt bên dưới. Backup đã restore thử; dữ liệu cũ và ảnh
được đối chiếu hash trước/sau migration. Bản mã và image có snapshot/manifest
để khôi phục, không tự commit/push và chưa chèn attack chain.

Giới hạn giữ nguyên theo lựa chọn người dùng: lỗi charset khi import seed chưa
sửa; tên/ảnh đơn cũ dùng sản phẩm hiện tại. Chỉ nghiệm thu HTTP local và tải đọc
nhỏ, chưa kết luận production hay mọi tình huống tải/lỗi đều an toàn. Phần chi
tiết kỹ thuật và bảng đối chiếu checklist ở dưới ghi rõ nguồn bằng chứng.

ID: `nt120-local-20261029-v1`. Scope: local HTTP demo on the configured database
name `web-clothing-store`; evidence is a mixture of the user's manual checks and
fresh automated/integration checks listed below. This is not a claim of production
certification, exhaustive security review or absence of all bugs.

## Changes completed in this iteration

- Persisted checkout UUID on orders under UNIQUE(user_id, checkout_key), in the
  same transaction as stock/order/cart updates. User lock serializes concurrent
  intents. Same user/key replays the original 201/orderId/decimal total before
  looking at a potentially changed cart. Different users have separate namespaces.
- Missing key 428; malformed UUID 400. New successful checkout requires new key.
- UI saves pending key in sessionStorage per user/tab before submission; keeps it
  for network/5xx/reload, allows pending replay with empty cart, clears after
  success. Double click is gated. Storage failure/account switch blocks submission.
- Additive migration preserves historical orders as NULL keys and can run twice.
- Runtime dependencies updated: multer 2.5.0, body-parser 2.4.0, qs 6.17.1.
  Backend and frontend npm audit --omit=dev report 0 advisories at this run.

## Fresh automated results

| Suite | Result | Evidence |
|---|---|---|
| Unit/HTTP/UI harness | 79/79 pass | final-unit.txt |
| Real MySQL business | 19/19 pass | final-mysql.txt |
| Category migration | 7/7 pass | final-category-mysql.txt |
| DB availability | 6/6 scenarios pass | final-availability.txt |
| Locks/response loss/migration | All 9 logged checks pass, exit 0 | final-recovery.txt |
| JS/CJS syntax | 52 files pass | validated backend/frontend/database migrations |
| Runtime dependency audits | backend 0, frontend 0 | final-backend-audit.json, final-frontend-audit.json |

Category suite first ran before the restarted test MySQL finished initialization
and received PROTOCOL_CONNECTION_LOST. After mysqladmin ping confirmed readiness,
the full rerun passed. This is recorded rather than treated as an application fix.

Browser Edge on isolated localhost:13430: fixture login, add item, checkout using
new frontend, order MC-00049 with quantity 1/total 12.34 and details rendered.
Proof: idempotency-browser.png. Browser reload/key retention/network failure is
covered by UI harness; actual response loss after commit and changed cart are
covered by HTTP proxy + real MySQL, not described as all-browser automation.

## Deployment and backup

Images rebuilt with npm ci and 0 audit warnings, then backend/frontend recreated
only after backup rehearsal. MySQL/gateway were not recreated. Four main services
healthy, readiness 200; gateway catalog 200 with 8 products and CSP; OPTIONS allows
Idempotency-Key. Critical runtime source/lock SHA-256 hashes match workspace.

Backup folder (private, outside Git):
`D:\Project\NT120\web-clothing-store-backups\checkout-2026-10-29T05-31-28-357Z`.
Backup restored into a separate tmpfs MySQL, migration rehearsed twice, all original
columns/row counts/hashes matched before and after. Original uploads matched hashes.
Same additive migration then applied to live DB; original data/links/images matched.
No live order fixture created. Verification JSON and SQL checksum are in backup.
Old backend/frontend image IDs and docker.env retained privately for recovery.
See idempotency-deployment.txt and database/migrations/README.md.

Baseline artifacts are stored in that same protected backup folder:
`baseline-source.zip` (source, locks, config examples, final evidence and manifest)
and `baseline-images.tar` (backend/frontend image exports), each with `.sha256`.
Runtime credentials and SQL/uploads are separate private backup files, excluded
from the source ZIP. `final-baseline-manifest.json` records exact file hashes,
running image IDs, base digest, git HEAD and uncommitted-workspace status.
To recover, verify checksums, extract ZIP to a new folder, load images with
`docker load -i baseline-images.tar`, restore SQL/uploads into a separate stack,
apply checkout migration if restoring the pre-migration SQL, and verify readiness,
data and browser flows before any cutover. Do not overwrite the running DB or
reuse fixed container names blindly when staging a separate stack.

## Checklist disposition

| Original section | Disposition |
|---|---|
| 1. Version/environment | Runtime source/lockfiles verified; test DB/ports isolated; source snapshot manifest accompanies baseline. Working tree remains uncommitted. |
| 2. Cart/concurrency | Tested bounds/ownership/parallel adds/updates and cart vs checkout. Real lock timeout/deadlock and bounded queue/disconnect recovery verified. |
| 3. Checkout/money | Exact money, constraints, rollback, last-item race, same-cart race and same-key response-loss replay verified. |
| 4. Admin revisions | User manually confirmed stale/no-op/missing/invalid revision; automated stale checkout race and UI draft retention passed. Same account in two sessions was used for manual race. |
| 5. CRUD/upload | User confirmed 404, duplicates after migration, sold-product 409, valid/fake/oversized images, invalid fields and cleanup 400/409; 404/DB-failure cleanup also tested automatically. |
| 6. Auth/authorization | User confirmed signup/login/logout/password revocation, 401/403, order/cart ownership, CSRF and origin. Automated regressions passed. |
| 7. Errors/UI | User confirmed 400/413/401/403/409/422/429, offline/recovery and escaped text; 500 UI simulated, real server failures covered separately. |
| 8. Independent checks | Fresh suites above; source hash/version and evidence retained. |
| 9. Docker/recovery | User verified restart preservation, 11-image restore/SHA, 6-table counts/checksums/orphans and application writes after restore. Fresh init schema/index/connection checked; DB availability fixes deployed; small load 100 requests/10 concurrent passed both proxy and gateway. |
| 10. Baseline artifact | Source/lockfiles/config examples/evidence manifest and recoverable data backup retained. No commit/push; not an attack-chain build. |

## Accepted limitations and boundaries

- User explicitly deferred seed-import charset fix. Vietnamese entry through web
  was manually confirmed correct. Fresh seed display can still be mojibake.
- User chose current product name/image in old orders; immutable product snapshots
  are not required for this baseline.
- SQL scripts use the fixed configured DB name. Arbitrary DB_NAME changes are not
  supported by fresh init. Local HTTP profile tested; HTTPS/production not certified.
- Readiness probes SELECT 1, not every schema migration. Per-command deadlines
  are not a total deadline for an arbitrarily large multi-statement request.
- HTTP response loss after commit tested; no wire-level fault injection of MySQL
  COMMIT ACK. Persistent key resolves committed outcomes when the client retains it.
- Pending intent is per browser tab/sessionStorage, not a cross-device order token.
  Clearing storage or starting a new tab creates a different intent. Before any
  successful commit, retry still operates on the then-current cart; it is not an
  immutable price quote/cart snapshot.
- Small read-load test only (100 requests, 10 concurrent); no long soak or checkout
  throughput SLA, off-host/PITR disaster recovery or full automated browser matrix.
- Source baseline has no intentionally inserted vulnerabilities. Any later attack
  chain must use a separate lab copy/data, preserving this recovery baseline.

Historical reports below/elsewhere remain evidence of prior failures; this result
supersedes the missing-idempotency/advisory findings for the newly deployed version.
