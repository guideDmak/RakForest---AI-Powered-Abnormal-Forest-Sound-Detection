import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const url = new URL(process.env.DATABASE_URL);
const config = {
  host: process.env.ACCOUNT_DATABASE_POOLER_HOST || url.hostname,
  port: 5432,
  user: process.env.ACCOUNT_DATABASE_POOLER_HOST
    ? `${decodeURIComponent(url.username)}.${url.hostname.split(".")[1]}`
    : decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
};
const client = new pg.Client(config);
try {
  await client.connect();
  const concurrent = new pg.Client(config);
  try {
    await concurrent.connect();
    const reservations = await Promise.all([
      client.query("select reserve_employee_code() as code"),
      concurrent.query("select reserve_employee_code() as code"),
    ]);
    const codes = reservations.map((result) => result.rows[0].code);
    codes.forEach((code) => assert.match(code, /^RF-EMP-[0-9]{4,}$/));
    assert.notEqual(codes[0], codes[1]);
  } finally {
    await concurrent.end();
  }
  await client.query("begin");
  const actor = randomUUID(),
    target = randomUUID(),
    station = randomUUID(),
    zone = randomUUID(),
    report = randomUUID();
  await client.query(
    "insert into profiles(id,employee_code,full_name,role,password_hash) values ($1,$2,'Test actor','super_admin','Test123!'),($3,$4,'Test target','field_ranger','Test123!')",
    [actor, "TEST-" + actor, target, "TEST-" + target],
  );
  const run = (kind, id, version = "md5('Test123!')") =>
    client.query(
      `select soft_delete_directory($1,$2,$3,${version}) as result`,
      [kind, id, actor],
    );
  await client.query("savepoint checks");
  try {
    await run("profile", actor);
    assert.fail("Self deletion must fail");
  } catch (e) {
    assert.equal(e.code, "P0001");
    await client.query("rollback to savepoint checks");
  }
  await client.query("savepoint checks");
  try {
    await run("profile", target, "md5('wrong')");
    assert.fail("Stale password must fail");
  } catch (e) {
    assert.equal(e.code, "28000");
    await client.query("rollback to savepoint checks");
  }
  await client.query(
    "insert into forest_zones(id,zone_code,name,responsible_officer_id) values ($1,$2,'Test zone',$3)",
    [zone, "TEST-" + zone, target],
  );
  assert.equal((await run("profile", target)).rows[0].result.blocked, true);
  await client.query(
    "update forest_zones set responsible_officer_id=null where id=$1",
    [zone],
  );
  await client.query(
    "insert into sensor_stations(id,station_code,name,zone_id,lat,lng) values ($1,$2,'Test station',$3,18,98)",
    [station, "TEST-" + station, zone],
  );
  await client.query(
    "insert into reports(id,report_code,source_type,reporter_id,assigned_to,station_id,zone_id,lat,lng,status) values ($1,$2,'station_sensor',$3,$3,$4,$5,18,98,'dispatched')",
    [report, "TEST-" + report, target, station, zone],
  );
  assert.equal((await run("profile", target)).rows[0].result.blocked, true);
  await client.query("update reports set status='closed' where id=$1", [
    report,
  ]);
  assert.equal((await run("profile", target)).rows[0].result.deleted, true);
  assert.equal(
    (await run("profile", target)).rows[0].result.alreadyDeleted,
    true,
  );
  const zoneBlock = (await run("zone", zone)).rows[0].result;
  assert.equal(zoneBlock.blocked, true);
  assert.equal(zoneBlock.items[0].id, station);
  assert.equal(zoneBlock.items[0].kind, "station");
  await client.query("update sensor_stations set zone_id=null where id=$1", [
    station,
  ]);
  assert.equal((await run("station", station)).rows[0].result.deleted, true);
  assert.equal((await run("zone", zone)).rows[0].result.deleted, true);
  assert.equal((await run("zone", zone)).rows[0].result.alreadyDeleted, true);
  const historicalZone = (
    await client.query(
      "select name, deleted_at, deleted_by from forest_zones where id=$1",
      [zone],
    )
  ).rows[0];
  assert.equal(historicalZone.name, "Test zone");
  assert.ok(historicalZone.deleted_at);
  assert.equal(historicalZone.deleted_by, actor);
  await client.query("savepoint zone_refs");
  try {
    await client.query(
      "insert into sensor_stations(station_code,name,zone_id,lat,lng) values ($1,'Test station',$2,18,98)",
      ["TEST-" + randomUUID(), zone],
    );
    assert.fail("Deleted zone cannot accept a new station");
  } catch (e) {
    assert.equal(e.code, "23503");
    await client.query("rollback to savepoint zone_refs");
  }
  const history = (
    await client.query(
      "select reporter_id,assigned_to,station_id,zone_id from reports where id=$1",
      [report],
    )
  ).rows[0];
  assert.deepEqual(history, {
    reporter_id: target,
    assigned_to: target,
    station_id: station,
    zone_id: zone,
  });
  assert.equal(
    (
      await client.query(
        "select count(*)::int as n from audit_logs where target_id in ($1,$2,$3) and action='soft_delete'",
        [target, station, zone],
      )
    ).rows[0].n,
    3,
  );
  await client.query("savepoint refs");
  try {
    await client.query(
      "insert into reports(report_code,source_type,station_id,lat,lng) values ($1,'station_sensor',$2,18,98)",
      ["TEST-" + randomUUID(), station],
    );
    assert.fail("Deleted station cannot accept new reports");
  } catch (e) {
    assert.equal(e.code, "23503");
    await client.query("rollback to savepoint refs");
  }
  await client.query("rollback");
  console.log(
    "PASS: password version, self deletion, zone/task blockers, idempotent deletion, audit and preserved history. All fixtures rolled back.",
  );
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error("Directory DB test failed:", error.code || error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
