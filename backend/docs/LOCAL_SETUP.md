# Local setup — MongoDB replica set

Money-Flow V2 runs every financial write path inside a MongoDB multi-document
transaction (`backend/src/utils/transaction.js`). Transactions require a
**replica set**; a bare `mongod` is a standalone and rejects them.

A **single-node** replica set is enough. Nothing else about the deployment
changes — same port, same database, same connection string.

The server refuses to boot against a standalone (`assertTransactionSupport()`
in `src/server.js`) rather than letting the first real payment be the thing
that discovers the misconfiguration.

---

## Option A — convert the existing MongoDB service (recommended)

This keeps everything on `mongodb://localhost:27017` exactly as it is today.
**Needs an elevated (Administrator) terminal**, because it edits a file under
`C:\Program Files` and restarts a Windows service.

```powershell
# Run PowerShell as Administrator, from the repo root:
.\backend\scripts\enable-replica-set.ps1
```

What it does:

1. Backs up `mongod.cfg` to `mongod.cfg.bak`.
2. Appends
   ```yaml
   replication:
     replSetName: rs0
   ```
3. Restarts the `MongoDB` service.
4. Runs `rs.initiate()` once (idempotent — safe to re-run).

Verify:

```bash
node backend/scripts/check-replica-set.js
# -> replica set: rs0  (transactions supported)
```

### Doing it by hand

1. Open `C:\Program Files\MongoDB\Server\7.0\bin\mongod.cfg` as Administrator.
2. Add at the end (no leading spaces on `replication:`):
   ```yaml
   replication:
     replSetName: rs0
   ```
3. `Restart-Service MongoDB`
4. Initiate the set once:
   ```bash
   node backend/scripts/check-replica-set.js --initiate
   ```

On macOS/Linux the equivalent is `mongod --replSet rs0 --dbpath <path>` then
`mongosh --eval "rs.initiate()"`.

---

## Option B — a second, unprivileged mongod (no Administrator needed)

Runs a separate replica-set-enabled `mongod` on port **27018** with its data
directory under your user profile, leaving the installed service untouched.

```bash
node backend/scripts/start-dev-replset.js
```

Then point the backend at it:

```
MONGODB_URI=mongodb://127.0.0.1:27018/phoenix
```

The script creates the dbPath, starts `mongod --replSet rs0 --port 27018`,
waits for it, and initiates the set. Leave it running in its own terminal;
Ctrl-C stops it.

---

## Tests

Tests do **not** use your local MongoDB. `test/helpers/mongo.js` boots an
in-memory `mongodb-memory-server` **replica set** per test file, so
transactions work with no local setup at all:

```js
const { startMemoryMongo, stopMemoryMongo } = require('./helpers/mongo');

test.before(async () => { await startMemoryMongo(); /* seed */ });
test.after(async () => { await stopMemoryMongo(); });
```

The first run downloads a MongoDB binary into
`node_modules/.cache/mongodb-binaries` (one time, ~100 MB).

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `REPLICA_SET_REQUIRED` on a payment/delivery | standalone mongod | Option A or B above |
| Boot fails with "MongoDB is running as a standalone" | same | same |
| `MongoServerError: not primary` right after `rs.initiate()` | the set is still electing | wait ~2s and retry |
| Memory-server download times out | no network / proxy | set `MONGOMS_DOWNLOAD_URL` or pre-seed the cache |
