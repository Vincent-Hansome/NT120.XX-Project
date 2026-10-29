# Baseline regression tests

## Checkout recovery and real locks (29/10/2026)

`npm.cmd run test:recovery:mysql` creates/stops a separate disposable MySQL with
an automatically assigned loopback port. No application DB/credentials are used.
It tests real server lock-wait timeout and InnoDB deadlock through the checkout
HTTP handler, compares cart/orders/items/stock and retries after releasing locks.
The scheduling observer wraps the real query only to detect when checkout has
requested a lock; it neither replaces SQL nor fabricates MySQL errors.

An HTTP proxy drops the response after the backend commits and sends 201. Retry
with the same Idempotency-Key returns the original 201/order/total, even if the
cart was refilled; the new cart remains intact. A new key creates a new checkout.
The suite also rehearses the additive migration twice on a legacy table with
historical orders. All checks now exit 0; the pre-fix exit-2 finding is historical.
A lost HTTP response after commit is tested, not loss of the MySQL COMMIT ACK
itself. See test-artifacts/final-baseline-results.md.

## Database availability regressions (29/10/2026)

`npm.cmd test` includes deadline/queue cancellation, socket disposal, transaction
command deadlines and the real `test-db.js` process failure exit code.

Run `npm.cmd run test:availability:mysql` with Docker available for six integration
checks. The runner creates its own uniquely named `nt120-availability-*` MySQL 8
container with tmpfs storage and an automatically assigned loopback port, imports
only table definitions into `availability_test`, and pauses/stops only that
container. It needs no application credentials and stops the test container in
finally. Do not substitute an application container/database. It tests readiness,
CLI success/failure, paused/stopped DB responses, full pool/expired write waiters,
and rollback after a query timeout. It does not reset the existing baseline or
category test database.

Defaults: 10 active connections, 50 queued acquisitions, 1000 ms acquisition
deadline, 2000 ms socket connect timeout, 3000 ms per query/transaction command.
Readiness uses a 1000 ms query deadline plus the acquisition deadline. Expired
queued work is removed; late-acquired and query-timed-out sockets are destroyed.
Timeouts do not automatically retry writes. Checkout now uses the persisted
idempotency key described below to resolve ambiguous outcomes on a later retry.

`GET /` remains process liveness. `GET /ready` probes the DB with `SELECT 1` and
returns 200/503, no-store, without internal details. It does not validate all
schema migrations. Compose backend healthcheck now uses `/ready` with an HTTP
timeout. Rebuild the backend to update an existing container.

`node test-db.js` loads backend/.env without overriding injected environment,
always closes the pool, and exits 0 on success, 1 on connection/configuration or
cleanup failure. It deliberately omits internal connection details from output.

Category migration / duplicate-name regressions (28/10/2026):
`npm.cmd run test:categories:mysql`. Uses only the dedicated MySQL server on
`127.0.0.1:13317` and a fresh `nt120_category_test_*` database per run; never drops
or resets an existing database. This suite changes `read_only` on that dedicated
test server, so run it separately from backup/migration rehearsals. See
[migration, verified backup and recovery procedure](../../database/migrations/README.md).

Run from `web-clothing-store/backend` with Node.js 24 and installed dependencies:

```powershell
npm.cmd test
```

This runs authentication/authorization/CSRF/upload regressions, HTTP error handling,
frontend event tests in a small DOM harness, and transaction resource lifecycle tests.
The MySQL suite is deliberately excluded from this command unless `RUN_MYSQL_TESTS=1`.

## Real MySQL, isolated from the running stack

The integration runner uses only `127.0.0.1:13316`, database `nt120_baseline_test`,
and the test credentials below. It overrides environment variables and never loads
the application's `.env`. Do not point it at an application database.

Create a new test container if the name is unused:

```powershell
docker run -d --name nt120-baseline-mysql-20261026 --label nt120.purpose=baseline-tests --tmpfs /var/lib/mysql -p 127.0.0.1:13316:3306 -e MYSQL_ROOT_PASSWORD=isolated-root-test-only -e MYSQL_DATABASE=nt120_baseline_test -e MYSQL_USER=baseline_test -e MYSQL_PASSWORD=isolated-app-test-only mysql:8.0 --log-bin-trust-function-creators=1
```

For the test container already created during this review, start it if stopped,
wait until `mysqladmin ping` succeeds, then enable fixture triggers in that container:

```powershell
docker start nt120-baseline-mysql-20261026
docker exec nt120-baseline-mysql-20261026 mysqladmin ping -h 127.0.0.1 -u baseline_test --password=isolated-app-test-only --silent
docker exec nt120-baseline-mysql-20261026 mysql -u root --password=isolated-root-test-only -e 'SET GLOBAL log_bin_trust_function_creators = 1'
npm.cmd run test:mysql
```

These are public, disposable test credentials, unrelated to the application.
The container has no volume mounts. Its tmpfs is temporary; stopping the container
discards its fixture database. Do not run these commands against `webapp_db`.
No test drops/resets a database or imports production records. Fixtures have fresh
users/products per case. Conditional triggers reject only fixture IDs/names to
exercise actual server failures after partial writes. They remain in this temporary
database until the container stops. Uploads go to a unique temporary directory;
only files created by that test are removed.

The concurrency gates pause actual MySQL transactions after acquiring locks and
wait until the competing transaction has submitted its lock query. They do not
replace SQL, locks, constraints, commit, or rollback with mocks.

## Optional browser smoke test

With the isolated MySQL container ready and its schema created by the suite:

```powershell
node test/serve-ui.cjs
```

Open `http://localhost:13330`. The helper prints fresh test accounts and products.
Backend binds only `127.0.0.1:13331`; frontend binds only `127.0.0.1:13330`.
It uses separate temporary uploads and does not restart or overwrite the stack
on ports 3000/3001. Stop the helper when finished.

## API contract changes

- POST /api/orders requires an Idempotency-Key UUID v4 (428 missing, 400 invalid).
  Same user/key replays the same 201 response before reading the current cart;
  new intents use a new key. Key and order are written in one transaction with
  UNIQUE(user_id, checkout_key); historical orders may keep NULL keys. No expiry
  or background deletion of keys is introduced.
- Checkout UI stores the pending key in sessionStorage scoped by user and browser
  tab; network/5xx failures and reload preserve it, success clears it. It can
  resolve pending checkout with an empty cart. Storage failure prevents sending
  an untracked checkout. Clearing browser storage or opening a different tab
  loses this pending intent, so it does not claim cross-device retry tracking.

- Product GET/list includes an opaque `revision` derived from current product
  content, including stock. PUT must echo it: missing revision is 428, malformed
  revision is 400, stale revision is 409. Comparison and write hold the same row
  lock. A no-op update succeeds. No schema migration is required.
- Checkout returns `total` as a two-decimal string. The maximum is 99999999.99
  (`DECIMAL(10,2)`); larger orders return 422 and preserve cart/stock.
- Stock conflicts are 409; missing catalog/cart objects are 404.
- A purchased product cannot be deleted (409); order history is retained.
- Password change clears the auth cookie, revokes prior token versions, and returns
  `reauthenticate: true`. Frontend redirects to the login notice.
- Invalid JSON is 400, JSON over the existing 100 KiB parser limit is 413, and
  internal errors remain generic 500 responses.

Browser evidence and final test logs are in `../../test-artifacts/baseline/`.
